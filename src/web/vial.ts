// VIA + Vial protocol, as spoken by vial-qmk (checked against the official Vial GUI).
import { HidTransport } from "./hid";
import { registry } from "./keycodes";
import {
    decodeMacroBuffer,
    emptyNames,
    encodeMacroBuffer,
    TOTEM_COLS,
    TOTEM_ROWS,
    type AltRepeat,
    type Combo,
    type KeyboardData,
    type KeyOverride,
    type MacroAction,
    type TapDance,
} from "./model";
import { QMK_SETTINGS_WIDTH } from "./qmk-settings";

// VIA commands
const VIA_GET_PROTOCOL_VERSION = 0x01;
const VIA_GET_KEYBOARD_VALUE = 0x02;
const VIA_SET_KEYCODE = 0x05;
const VIA_MACRO_GET_COUNT = 0x0c;
const VIA_MACRO_GET_BUFFER_SIZE = 0x0d;
const VIA_MACRO_GET_BUFFER = 0x0e;
const VIA_MACRO_SET_BUFFER = 0x0f;
const VIA_GET_LAYER_COUNT = 0x11;
const VIA_KEYMAP_GET_BUFFER = 0x12;
const VIA_SWITCH_MATRIX_STATE = 0x03;
const VIA_UNHANDLED = 0xff;
// Vial commands (after the 0xFE prefix)
const VIAL = 0xfe;
const VIAL_GET_KEYBOARD_ID = 0x00;
const VIAL_GET_UNLOCK_STATUS = 0x05;
const VIAL_UNLOCK_START = 0x06;
const VIAL_UNLOCK_POLL = 0x07;
const VIAL_LOCK = 0x08;
const VIAL_QMK_SETTINGS_QUERY = 0x09;
const VIAL_QMK_SETTINGS_GET = 0x0a;
const VIAL_QMK_SETTINGS_SET = 0x0b;
const VIAL_DYNAMIC_ENTRY_OP = 0x0d;
const DYN_GET_COUNTS = 0x00;
const DYN_TD_GET = 0x01,
    DYN_TD_SET = 0x02,
    DYN_COMBO_GET = 0x03,
    DYN_COMBO_SET = 0x04,
    DYN_KO_GET = 0x05,
    DYN_KO_SET = 0x06,
    DYN_AR_GET = 0x07,
    DYN_AR_SET = 0x08;

const CHUNK = 28; // bytes of keymap/macro buffer per packet

// The TOTEM's Vial UID (VIAL_KEYBOARD_UID in its keymap config.h), little-endian.
export const TOTEM_UID = 0x77eeedeefe3637cbn;

export class NotVialError extends Error {}
/** Vial before protocol 6 numbers keycodes differently (pre-2023 QMK); not supported. */
export class OldVialError extends Error {}
/** An unlock was started and never finished; the board ignores most commands until it is. */
export class UnlockPendingError extends Error {
    constructor(readonly keys: [number, number][]) {
        super("An unlock is still in progress on the keyboard.");
    }
}

const le16 = (d: Uint8Array, o: number) => d[o] | (d[o + 1] << 8);
const be16 = (d: Uint8Array, o: number) => (d[o] << 8) | d[o + 1];
const u16le = (v: number) => [v & 0xff, (v >> 8) & 0xff];

export interface UnlockStatus {
    unlocked: boolean;
    inProgress: boolean;
    keys: [number, number][];
}

export class Vial {
    constructor(readonly t: HidTransport) {}

    private async via(cmd: number, args: number[] = []): Promise<Uint8Array> {
        const d = await this.t.request([cmd, ...args]);
        if (d[0] === VIA_UNHANDLED && cmd !== VIA_UNHANDLED) throw new Error(`Keyboard does not support VIA command 0x${cmd.toString(16)}`);
        return d;
    }
    private vial(cmd: number, args: number[] = []): Promise<Uint8Array> {
        return this.t.request([VIAL, cmd, ...args]);
    }

    async identify(): Promise<{ via: number; vial: number; uid: bigint }> {
        const v = await this.via(VIA_GET_PROTOCOL_VERSION);
        const via = be16(v, 1);
        const id = await this.vial(VIAL_GET_KEYBOARD_ID);
        // A board without Vial echoes the request (0xFE 0x00) or answers 0xFF.
        if ((id[0] === VIAL && id[1] === VIAL_GET_KEYBOARD_ID) || id[0] === VIA_UNHANDLED) throw new NotVialError("This keyboard does not run Vial firmware.");
        const vial = id[0] | (id[1] << 8) | (id[2] << 16) | (id[3] << 24);
        let uid = 0n;
        for (let i = 7; i >= 0; i--) uid = (uid << 8n) | BigInt(id[4 + i]);
        return { via, vial, uid };
    }

    /** Read everything the editor needs. `progress` gets 0..1. */
    async load(progress: (f: number, what: string) => void = () => {}): Promise<KeyboardData> {
        progress(0, "Identifying keyboard");
        const { via, vial, uid } = await this.identify();
        if (vial < 6) throw new OldVialError(`This TOTEM runs an old Vial firmware (protocol ${vial}, like the prebuilt one in the TOTEM repo) that numbers keycodes the pre-2023 way. Flash the firmware from the firmware/ folder of the download to use this editor.`);
        const lock = await this.unlockStatus();
        if (lock.inProgress) throw new UnlockPendingError(lock.keys);
        const layers = (await this.via(VIA_GET_LAYER_COUNT))[1];
        const macroCount = (await this.via(VIA_MACRO_GET_COUNT))[1];
        const macroBufferSize = be16(await this.via(VIA_MACRO_GET_BUFFER_SIZE), 1);

        let tdCount = 0,
            comboCount = 0,
            koCount = 0,
            arCount = 0;
        const features = new Set<string>();
        if (vial >= 4) {
            const n = await this.vial(VIAL_DYNAMIC_ENTRY_OP, [DYN_GET_COUNTS]);
            [tdCount, comboCount, koCount, arCount] = [n[0], n[1], n[2], n[3]];
            if (n[31] & 1) features.add("caps_word");
            if (n[31] & 2) features.add("layer_lock");
        }
        if (vial >= 5) features.add("persistent_default_layer");
        if (arCount) features.add("repeat_key");
        registry.rebuild({ layers, macroCount, tapDanceCount: tdCount, features });

        const rows = TOTEM_ROWS,
            cols = TOTEM_COLS;
        const total = layers * rows * cols * 2;
        const work = total / CHUNK + macroBufferSize / CHUNK + tdCount + comboCount + koCount + arCount + 20;
        let done = 0;
        const tick = (what: string) => progress(Math.min(1, ++done / work), what);

        // Keymap
        const raw: number[] = [];
        for (let off = 0; off < total; off += CHUNK) {
            const sz = Math.min(CHUNK, total - off);
            const d = await this.via(VIA_KEYMAP_GET_BUFFER, [off >> 8, off & 0xff, sz]);
            raw.push(...d.slice(4, 4 + sz));
            tick("Reading keymap");
        }
        const keymap: number[][] = [];
        for (let l = 0; l < layers; l++) {
            const layer: number[] = [];
            for (let i = 0; i < rows * cols; i++) {
                const o = (l * rows * cols + i) * 2;
                layer.push((raw[o] << 8) | raw[o + 1]);
            }
            keymap.push(layer);
        }

        // Macros
        const mbuf: number[] = [];
        for (let off = 0; off < macroBufferSize; off += CHUNK) {
            const sz = Math.min(CHUNK, macroBufferSize - off);
            const d = await this.via(VIA_MACRO_GET_BUFFER, [off >> 8, off & 0xff, sz]);
            mbuf.push(...d.slice(4, 4 + sz));
            tick("Reading macros");
            if (mbuf.filter((b) => b === 0).length > macroCount) break;
        }
        const macros = decodeMacroBuffer(mbuf, macroCount);

        // Dynamic entries
        const entry = async (op: number, i: number) => {
            const d = await this.vial(VIAL_DYNAMIC_ENTRY_OP, [op, i]);
            if (d[0] !== 0) throw new Error(`Keyboard refused to read entry ${i} (op ${op})`);
            return d.subarray(1);
        };
        const tapDances: TapDance[] = [];
        for (let i = 0; i < tdCount; i++) {
            const e = await entry(DYN_TD_GET, i);
            tapDances.push({ onTap: le16(e, 0), onHold: le16(e, 2), onDoubleTap: le16(e, 4), onTapHold: le16(e, 6), term: le16(e, 8) });
            tick("Reading tap dances");
        }
        const combos: Combo[] = [];
        for (let i = 0; i < comboCount; i++) {
            const e = await entry(DYN_COMBO_GET, i);
            combos.push({ keys: [le16(e, 0), le16(e, 2), le16(e, 4), le16(e, 6)], output: le16(e, 8) });
            tick("Reading combos");
        }
        const overrides: KeyOverride[] = [];
        for (let i = 0; i < koCount; i++) {
            const e = await entry(DYN_KO_GET, i);
            overrides.push({ trigger: le16(e, 0), replacement: le16(e, 2), layers: le16(e, 4), triggerMods: e[6], negativeMods: e[7], suppressedMods: e[8], options: e[9] });
            tick("Reading key overrides");
        }
        const altRepeats: AltRepeat[] = [];
        for (let i = 0; i < arCount; i++) {
            const e = await entry(DYN_AR_GET, i);
            altRepeats.push({ keycode: le16(e, 0), altKeycode: le16(e, 2), allowedMods: e[4], options: e[5] });
            tick("Reading alt-repeat keys");
        }

        // QMK settings
        const settings = new Map<number, number>();
        if (vial >= 4) {
            const supported: number[] = [];
            let cur = 0;
            for (let guard = 0; guard < 64; guard++) {
                // The board lists (up to 16) setting ids greater than `cur`, padded with 0xFFFF.
                const d = await this.vial(VIAL_QMK_SETTINGS_QUERY, u16le(cur));
                let last = cur,
                    ended = false;
                for (let o = 0; o < 32; o += 2) {
                    const q = le16(d, o);
                    if (q === 0xffff) {
                        ended = true;
                        break;
                    }
                    supported.push(q);
                    last = q;
                }
                if (ended || last <= cur) break;
                cur = last;
            }
            for (const qsid of supported) {
                const width = QMK_SETTINGS_WIDTH[qsid];
                if (!width) continue;
                const d = await this.vial(VIAL_QMK_SETTINGS_GET, u16le(qsid));
                if (d[0] !== 0) continue;
                let v = 0;
                for (let b = width - 1; b >= 0; b--) v = v * 256 + d[1 + b];
                settings.set(qsid, v);
                tick("Reading settings");
            }
        }
        progress(1, "Done");
        return {
            name: this.t.productName || "TOTEM",
            uid,
            viaProtocol: via,
            vialProtocol: vial,
            rows,
            cols,
            layers,
            keymap,
            macroCount,
            macroBufferSize,
            macros,
            tapDances,
            combos,
            overrides,
            altRepeats,
            features,
            settings,
            names: emptyNames(),
        };
    }

    // ---- writes

    async setKey(layer: number, row: number, col: number, code: number) {
        await this.via(VIA_SET_KEYCODE, [layer, row, col, code >> 8, code & 0xff]);
    }

    async setTapDance(i: number, t: TapDance) {
        await this.dynSet(DYN_TD_SET, i, [...u16le(t.onTap), ...u16le(t.onHold), ...u16le(t.onDoubleTap), ...u16le(t.onTapHold), ...u16le(t.term)]);
    }
    async setCombo(i: number, c: Combo) {
        await this.dynSet(DYN_COMBO_SET, i, [...c.keys.flatMap(u16le), ...u16le(c.output)]);
    }
    async setOverride(i: number, o: KeyOverride) {
        await this.dynSet(DYN_KO_SET, i, [...u16le(o.trigger), ...u16le(o.replacement), ...u16le(o.layers), o.triggerMods, o.negativeMods, o.suppressedMods, o.options]);
    }
    async setAltRepeat(i: number, a: AltRepeat) {
        await this.dynSet(DYN_AR_SET, i, [...u16le(a.keycode), ...u16le(a.altKeycode), a.allowedMods, a.options]);
    }
    private async dynSet(op: number, i: number, payload: number[]) {
        const d = await this.vial(VIAL_DYNAMIC_ENTRY_OP, [op, i, ...payload]);
        if (d[0] !== 0) throw new Error(`Keyboard refused the change (status ${d[0]})`);
    }

    /** Write all macros. The keyboard must be unlocked first. Returns the bytes used. */
    async setMacros(macros: MacroAction[][], vialProtocol: number, bufferSize: number): Promise<number> {
        const buf = encodeMacroBuffer(macros, vialProtocol);
        if (buf.length > bufferSize) throw new Error(`Macros need ${buf.length} bytes but the keyboard only has ${bufferSize}`);
        for (let off = 0; off < buf.length; off += CHUNK) {
            const chunk = buf.slice(off, off + CHUNK);
            await this.via(VIA_MACRO_SET_BUFFER, [off >> 8, off & 0xff, chunk.length, ...chunk]);
        }
        return buf.length;
    }

    async setSetting(qsid: number, value: number) {
        const width = QMK_SETTINGS_WIDTH[qsid] ?? 1;
        const bytes: number[] = [];
        let v = value;
        for (let b = 0; b < width; b++) {
            bytes.push(v & 0xff);
            v = Math.floor(v / 256);
        }
        const d = await this.vial(VIAL_QMK_SETTINGS_SET, [...u16le(qsid), ...bytes]);
        if (d[0] !== 0) throw new Error(`Keyboard refused setting ${qsid}`);
    }

    // ---- unlock (needed for macros, QK_BOOT and the key tester)

    async unlockStatus(): Promise<UnlockStatus> {
        const d = await this.vial(VIAL_GET_UNLOCK_STATUS);
        const keys: [number, number][] = [];
        for (let i = 0; i < 15; i++) {
            const r = d[2 + i * 2],
                c = d[3 + i * 2];
            if (r !== 255 && c !== 255) keys.push([r, c]);
        }
        return { unlocked: d[0] === 1, inProgress: d[1] === 1, keys };
    }
    async unlockStart() {
        await this.vial(VIAL_UNLOCK_START);
    }
    async unlockPoll(): Promise<{ unlocked: boolean; counter: number }> {
        const d = await this.vial(VIAL_UNLOCK_POLL);
        return { unlocked: d[0] === 1, counter: d[2] };
    }
    async lock() {
        await this.vial(VIAL_LOCK);
    }

    /** Which keys are held right now. Needs an unlocked keyboard. */
    async matrix(rows: number, cols: number): Promise<boolean[]> {
        const d = await this.t.request([VIA_GET_KEYBOARD_VALUE, VIA_SWITCH_MATRIX_STATE], { timeout: 300, retries: 1 });
        if (d[0] !== VIA_GET_KEYBOARD_VALUE || d[1] !== VIA_SWITCH_MATRIX_STATE) throw new Error("Matrix state not available");
        const bytesPerRow = Math.ceil(cols / 8);
        const out: boolean[] = [];
        for (let r = 0; r < rows; r++) {
            let bits = 0;
            for (let b = 0; b < bytesPerRow; b++) bits = (bits << 8) | d[2 + r * bytesPerRow + b];
            for (let c = 0; c < cols; c++) out.push(((bits >> c) & 1) === 1);
        }
        return out;
    }
}

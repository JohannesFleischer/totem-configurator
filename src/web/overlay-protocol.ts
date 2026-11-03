// The overlay report of this project's TOTEM firmware (firmware/overlay_report.c): a
// read-only Raw HID command that says which layer is on, which modifiers are held and,
// while the keyboard is unlocked, which keys are held. Requests and replies are tagged,
// so the overlay and the editor can use the keyboard at the same time.
//
//   request  [0] 0xF0  [1..4] "TKOV"  [5] what  [6] client tag  [7] 0  [8..] arguments
//   reply    the same, [7] = report version, answer from [8]
import { HidTransport, isTagged } from "./hid";

const CMD = 0xf0;
const MAGIC = [0x54, 0x4b, 0x4f, 0x56]; // "TKOV"
const STATE = 0x01,
    INFO = 0x02,
    KEYMAP = 0x03,
    KEYMAP_SUM = 0x04;
const KEYMAP_CHUNK = 20;

/** The firmware has no overlay report (an older build): it answers 0xFF. */
export class NoOverlayReport extends Error {
    constructor() {
        super("This firmware doesn't report the layer you're on.");
    }
}
/** The keyboard didn't handle the request (Vial ignores it while an unlock is in progress). */
export class OverlayBusy extends Error {}

export interface LiveState {
    layerState: number; // bit n = layer n is on
    defaultLayerState: number;
    mods: number; // HID modifier bits: 1 LCtl, 2 LSft, 4 LAlt, 8 LGui, 16.. right ones
    capsLock: boolean;
    capsWord: boolean;
    unlocked: boolean;
    held: boolean[] | null; // per matrix position; only while the keyboard is unlocked
}

export interface BoardInfo {
    layers: number;
    macros: number;
    rows: number;
    cols: number;
    tapDances: number;
    combos: number;
    overrides: number;
    altRepeats: number;
    featureBits: number; // bit 0 Caps Word, bit 1 Layer Lock (as Vial reports them)
    uid: bigint;
    vialProtocol: number;
}

const u32 = (d: Uint8Array, o: number) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;

/** The layer QMK looks keys up in first: the highest one that's on. */
export function topLayer(s: Pick<LiveState, "layerState" | "defaultLayerState">): number {
    const all = (s.layerState | s.defaultLayerState) >>> 0;
    return all ? 31 - Math.clz32(all) : 0;
}

/** The default (base) layer. */
export function baseLayer(s: Pick<LiveState, "defaultLayerState">): number {
    return s.defaultLayerState ? 31 - Math.clz32(s.defaultLayerState >>> 0) : 0;
}

export class OverlayClient {
    private readonly tag = 1 + Math.floor(Math.random() * 254);
    constructor(readonly t: HidTransport) {}

    private async ask(what: number, args: number[] = [], timeout = 400, retries = 1): Promise<Uint8Array> {
        const d = await this.t.request([CMD, ...MAGIC, what, this.tag, 0, ...args], {
            timeout,
            retries,
            accept: (r) => isTagged(r) && r[5] === what && r[6] === this.tag,
        });
        if (d[0] === 0xff) throw new NoOverlayReport();
        if (d[7] === 0) throw new OverlayBusy("The keyboard is busy (an unlock is in progress).");
        return d;
    }

    async state(cols = 5): Promise<LiveState> {
        const d = await this.ask(STATE, [], 300, 0);
        const flags = d[17];
        let held: boolean[] | null = null;
        if (flags & 8) {
            held = [];
            for (let r = 0; r < 8; r++) for (let c = 0; c < cols; c++) held.push(!!(d[18 + r] & (1 << c)));
        }
        return {
            layerState: u32(d, 8),
            defaultLayerState: u32(d, 12),
            mods: d[16],
            capsLock: !!(flags & 1),
            capsWord: !!(flags & 2),
            unlocked: !!(flags & 4),
            held,
        };
    }

    async info(): Promise<BoardInfo> {
        const d = await this.ask(INFO);
        let uid = 0n;
        for (let i = 7; i >= 0; i--) uid = (uid << 8n) | BigInt(d[17 + i]);
        return {
            layers: d[8],
            macros: d[9],
            rows: d[10],
            cols: d[11],
            tapDances: d[12],
            combos: d[13],
            overrides: d[14],
            altRepeats: d[15],
            featureBits: d[16],
            uid,
            vialProtocol: u32(d, 25),
        };
    }

    /** The whole keymap, as keycodes per layer. */
    async keymap(layers: number, keysPerLayer: number): Promise<number[][]> {
        const total = layers * keysPerLayer * 2;
        const raw: number[] = [];
        for (let off = 0; off < total; off += KEYMAP_CHUNK) {
            const size = Math.min(KEYMAP_CHUNK, total - off);
            const d = await this.ask(KEYMAP, [off >> 8, off & 0xff, size]);
            raw.push(...d.slice(11, 11 + size));
        }
        return Array.from({ length: layers }, (_, l) => Array.from({ length: keysPerLayer }, (_, i) => (raw[(l * keysPerLayer + i) * 2] << 8) | raw[(l * keysPerLayer + i) * 2 + 1]));
    }

    /** A checksum of the whole keymap: it changes when a key is changed (by any program). */
    async keymapSum(): Promise<number> {
        const d = await this.ask(KEYMAP_SUM);
        return (d[8] << 8) | d[9] | (((d[10] << 8) | d[11]) << 16);
    }

    // ---- Vial's unlock, for the held keys. These are plain Vial commands (any Vial firmware),
    // so the editor sees their replies too. Vial only fills in the first bytes of the reply and
    // leaves the rest of the request as it was, so a random tag at [10..15] marks ours.

    private async vialTagged(cmd: number, timeout = 500): Promise<Uint8Array> {
        const tag = Array.from({ length: 6 }, () => Math.floor(Math.random() * 256));
        return this.t.request([0xfe, cmd, 0, 0, 0, 0, 0, 0, 0, 0, ...tag], {
            timeout,
            retries: 2,
            accept: (r) => !isTagged(r) && tag.every((b, i) => r[10 + i] === b),
        });
    }

    /** The keys to hold for an unlock (Vial clears the whole reply for this one, so it's checked by shape). */
    async unlockKeys(): Promise<[number, number][]> {
        const d = await this.t.request([0xfe, 0x05], { timeout: 500, retries: 2, accept: (r) => !isTagged(r) && r[0] <= 1 && r[1] <= 1 && r[31] === 0xff });
        const keys: [number, number][] = [];
        for (let i = 0; i < 15; i++) if (d[2 + i * 2] !== 0xff && d[3 + i * 2] !== 0xff) keys.push([d[2 + i * 2], d[3 + i * 2]]);
        return keys;
    }

    /** Start an unlock: the keyboard then waits until the unlock keys are held for a few seconds. */
    async unlockStart() {
        await this.vialTagged(0x06);
    }

    /** How far the unlock is: `counter` counts down to 0 while the keys are held. */
    async unlockPoll(): Promise<{ unlocked: boolean; inProgress: boolean; counter: number }> {
        const d = await this.vialTagged(0x07);
        return { unlocked: d[0] === 1, inProgress: d[1] === 1, counter: d[2] };
    }

    /** Lock the keyboard again (held keys are hidden again). */
    async lock() {
        await this.vialTagged(0x08);
    }

    /** Whether the firmware has the overlay report. */
    async supported(): Promise<boolean> {
        try {
            await this.ask(STATE, [], 300, 1);
            return true;
        } catch (e) {
            if (e instanceof OverlayBusy) return true;
            return false;
        }
    }
}

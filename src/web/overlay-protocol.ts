// The overlay report of this project's TOTEM firmware (firmware/overlay_report.c): a
// Raw HID command that says which layer is on, which modifiers are held and, while the
// keyboard is unlocked, which keys are held. Since report version 3 it also reads and sets
// the layer lights (firmware/layer_lights.c). Requests and replies are tagged, so the
// overlay and the editor can use the keyboard at the same time.
//
//   request  [0] 0xF0  [1..4] "TKOV"  [5] what  [6] client tag  [7] 0  [8..] arguments
//   reply    the same, [7] = report version, answer from [8]
import { HidTransport, isTagged } from "./hid";

const CMD = 0xf0;
const MAGIC = [0x54, 0x4b, 0x4f, 0x56]; // "TKOV"
const STATE = 0x01,
    INFO = 0x02,
    KEYMAP = 0x03,
    KEYMAP_SUM = 0x04,
    LIGHTS = 0x05,
    LIGHT_SET = 0x06,
    LIGHTS_SAVE = 0x07,
    LIGHT_OPTS = 0x08,
    LIGHT_OPT = 0x09;
const KEYMAP_CHUNK = 20;
const LIGHTS_PER_REPLY = 7;
/** The report version that has the layer lights. */
export const LIGHTS_VERSION = 3;
/** What the firmware starts with (firmware/layer_lights.c): the base layer dark. */
export const DEFAULT_BRIGHTNESS = 48;

export type Rgb = [number, number, number];
/** How a layer's light behaves: steady, breathing in its colour, or going round the colour wheel. */
export const EFFECTS = ["Steady", "Breathe", "Rainbow"] as const;
export const DEFAULT_SPEED = 128;
/** Per layer a colour (black: off) and an effect; how bright the LEDs are (0-255), how fast effects run (0-255), and after how many seconds without a key press they go dark (0: never). */
export interface Lights {
    brightness: number;
    colors: Rgb[];
    effects: number[];
    speed: number;
    timeout: number;
}
export const DEFAULT_LIGHTS: Rgb[] = [
    [0, 0, 0],
    [255, 255, 255],
    [0, 90, 255],
    [0, 255, 60],
    [255, 0, 180],
    [255, 130, 0],
    [140, 0, 255],
    [0, 220, 220],
    [255, 210, 0],
    [255, 0, 0],
    [120, 255, 0],
    [0, 170, 255],
    [255, 80, 80],
    [90, 90, 255],
    [0, 255, 160],
    [255, 170, 110],
];

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

    /** The firmware's report version: 1 = layer and keymap, 2 = also the layer lights. */
    async version(): Promise<number> {
        return (await this.ask(STATE, [], 400, 1))[7];
    }

    /** The layer light colours and brightness kept on the keyboard. */
    async lights(): Promise<Lights> {
        const colors: Rgb[] = [];
        let count = 1,
            brightness = 0;
        for (let first = 0; first < count; first += LIGHTS_PER_REPLY) {
            const d = await this.ask(LIGHTS, [first]);
            count = d[8];
            brightness = d[9];
            for (let i = 0; i < LIGHTS_PER_REPLY && first + i < count; i++) colors.push([d[11 + i * 3], d[12 + i * 3], d[13 + i * 3]]);
        }
        const o = await this.ask(LIGHT_OPTS);
        return { brightness, colors, timeout: o[8] | (o[9] << 8), speed: o[10], effects: Array.from(o.slice(11, 11 + count)) };
    }

    private async option(args: number[], what: string) {
        const d = await this.ask(LIGHT_OPT, args);
        if (!d[12]) throw new Error(`The keyboard refused ${what}.`);
    }
    /** Seconds without a key press until the LEDs go dark (0: never; up to 65535). Not kept until saveLights(). */
    setLightTimeout(seconds: number) {
        return this.option([0, seconds & 0xff, (seconds >> 8) & 0xff], "the timeout");
    }
    /** How fast the effects run, 0-255. */
    setLightSpeed(speed: number) {
        return this.option([1, speed], "the speed");
    }
    /** A layer's effect (index into EFFECTS); the LEDs show it for a moment. */
    setLightEffect(layer: number, effect: number) {
        return this.option([2, layer, effect], "the effect");
    }

    /** A layer's colour: the LEDs show it for a moment, whatever the layer. Not kept until saveLights(). */
    async setLight(layer: number, rgb: Rgb) {
        const d = await this.ask(LIGHT_SET, [layer, ...rgb]);
        if (!d[12]) throw new Error(`The keyboard has no light for layer ${layer}.`);
    }

    /** How bright the LEDs are (0-255). Not kept until saveLights(). */
    async setBrightness(value: number) {
        await this.ask(LIGHT_SET, [0xff, value]);
    }

    /** Keep the colours and brightness on the keyboard (its EEPROM). */
    async saveLights() {
        await this.ask(LIGHTS_SAVE, [], 800);
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

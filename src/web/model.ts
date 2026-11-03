// The keyboard's configuration as plain data, plus Vial macro encoding and .vil files.
import { deserialize, serialize } from "./keycodes";

export interface TapDance {
    onTap: number;
    onHold: number;
    onDoubleTap: number;
    onTapHold: number;
    term: number;
}
export interface Combo {
    keys: [number, number, number, number];
    output: number;
}
export interface KeyOverride {
    trigger: number;
    replacement: number;
    layers: number; // bitmask
    triggerMods: number; // 8-bit masks: LCtl LSft LAlt LGui RCtl RSft RAlt RGui
    negativeMods: number;
    suppressedMods: number;
    options: number;
}
export interface AltRepeat {
    keycode: number;
    altKeycode: number;
    allowedMods: number;
    options: number;
}
export type MacroAction =
    | { type: "text"; text: string }
    | { type: "tap" | "down" | "up"; keys: number[] }
    | { type: "delay"; ms: number };

export interface KeyboardData {
    name: string;
    uid: bigint | null;
    viaProtocol: number;
    vialProtocol: number;
    rows: number;
    cols: number;
    layers: number;
    keymap: number[][]; // [layer][row * cols + col]
    macroCount: number;
    macroBufferSize: number;
    macros: MacroAction[][];
    tapDances: TapDance[];
    combos: Combo[];
    overrides: KeyOverride[];
    altRepeats: AltRepeat[];
    features: Set<string>;
    settings: Map<number, number>;
    names: Names;
}

/**
 * Names for layers, macros, tap dances, combos and overrides. Vial firmware can't store
 * them, so they live in the .vil file (keybard's "cosmetic" block) and in the browser.
 * Keys are indices as strings.
 */
export interface Names {
    layer: Record<string, string>;
    macros: Record<string, string>;
    tapdances: Record<string, string>;
    combos: Record<string, string>;
    overrides: Record<string, string>;
}
export type NameKind = keyof Names;
export const NAME_KINDS: NameKind[] = ["layer", "macros", "tapdances", "combos", "overrides"];
export const MAX_NAME = 24;

export function emptyNames(): Names {
    return { layer: {}, macros: {}, tapdances: {}, combos: {}, overrides: {} };
}

/** Clean names read from a file or storage: strings only, trimmed, within the table sizes. */
export function sanitizeNames(raw: unknown, kb: Pick<KeyboardData, "layers" | "macroCount" | "tapDances" | "combos" | "overrides">): Names {
    const out = emptyNames();
    const limits: Record<NameKind, number> = { layer: kb.layers, macros: kb.macroCount, tapdances: kb.tapDances.length, combos: kb.combos.length, overrides: kb.overrides.length };
    if (!raw || typeof raw !== "object") return out;
    for (const kind of NAME_KINDS) {
        const table = (raw as Record<string, unknown>)[kind];
        if (!table || typeof table !== "object") continue;
        for (const [k, v] of Object.entries(table as Record<string, unknown>)) {
            const i = Number(k);
            const name = typeof v === "string" ? v.trim().slice(0, MAX_NAME) : "";
            if (Number.isInteger(i) && i >= 0 && i < limits[kind] && name) out[kind][String(i)] = name;
        }
    }
    return out;
}

/** Only the non-empty tables, as stored in files. */
export function compactNames(n: Names): Partial<Names> {
    return Object.fromEntries(NAME_KINDS.filter((k) => Object.keys(n[k]).length).map((k) => [k, { ...n[k] }]));
}

export const KO_OPTIONS: [number, string, string][] = [
    [1 << 7, "Enabled", "Turn this override on"],
    [1 << 0, "Activate when the trigger key is pressed down", "activation_trigger_down"],
    [1 << 1, "Activate when a necessary modifier is pressed down", "activation_required_mod_down"],
    [1 << 2, "Activate when a negative modifier is released", "activation_negative_mod_up"],
    [1 << 3, "Any one trigger modifier is enough (instead of all of them)", "one_mod"],
    // QMK's meaning of bits 4 and 5 (Vial's GUI shows these two labels the other way round).
    [1 << 4, "Don't register the trigger key again after the override is deactivated", "no_reregister_trigger"],
    [1 << 5, "Don't deactivate when another key is pressed down", "no_unregister_on_other_key_down"],
];
// Defaults Vial uses for a new override: enabled + the three activation options.
export const KO_DEFAULT_OPTIONS = (1 << 7) | 0b111;

export function emptyTapDance(): TapDance {
    return { onTap: 0, onHold: 0, onDoubleTap: 0, onTapHold: 0, term: 200 };
}
export function emptyCombo(): Combo {
    return { keys: [0, 0, 0, 0], output: 0 };
}
export function emptyOverride(): KeyOverride {
    return { trigger: 0, replacement: 0, layers: 0xffff, triggerMods: 0, negativeMods: 0, suppressedMods: 0, options: KO_DEFAULT_OPTIONS };
}

export function isTapDanceUsed(t: TapDance) {
    return !!(t.onTap || t.onHold || t.onDoubleTap || t.onTapHold);
}
export function isComboUsed(c: Combo) {
    return !!(c.output || c.keys.some((k) => k));
}
export function isOverrideUsed(o: KeyOverride) {
    return !!(o.trigger || o.replacement);
}

// ---------------------------------------------------------------------------
// Macros (Vial protocol >= 2 encoding)

const SS_QMK_PREFIX = 1;
const SS_TAP = 1,
    SS_DOWN = 2,
    SS_UP = 3,
    SS_DELAY = 4,
    EXT_TAP = 5,
    EXT_DOWN = 6,
    EXT_UP = 7;

export function encodeMacro(actions: MacroAction[], vialProtocol: number): number[] {
    const out: number[] = [];
    for (const a of actions) {
        if (a.type === "text") {
            // QMK's send_string only knows ASCII; anything else (and NUL/prefix bytes) is dropped.
            for (const ch of a.text) {
                const c = ch.charCodeAt(0);
                if ((c >= 0x20 && c < 0x7f) || c === 9 || c === 10) out.push(c);
            }
        } else if (a.type === "delay") {
            if (vialProtocol < 2) continue;
            const ms = Math.max(0, Math.min(a.ms, 255 * 255 - 1));
            out.push(SS_QMK_PREFIX, SS_DELAY, (ms % 255) + 1, Math.floor(ms / 255) + 1);
        } else {
            for (let kc of a.keys) {
                if (vialProtocol >= 2) out.push(SS_QMK_PREFIX);
                const big = kc >= 256;
                const prefix = { tap: [SS_TAP, EXT_TAP], down: [SS_DOWN, EXT_DOWN], up: [SS_UP, EXT_UP] }[a.type][big ? 1 : 0];
                out.push(prefix);
                if (!big) out.push(kc);
                else {
                    // see decode_keycode() in Vial's QMK: codes with a zero low byte are sent as 0xFFxx
                    if (kc % 256 === 0) kc = 0xff00 | (kc >> 8);
                    out.push(kc & 0xff, kc >> 8);
                }
            }
        }
    }
    return out;
}

export function decodeMacro(data: number[]): MacroAction[] {
    const out: MacroAction[] = [];
    const push = (type: "tap" | "down" | "up", kc: number) => {
        const last = out[out.length - 1];
        if (last && last.type === type) last.keys.push(kc);
        else out.push({ type, keys: [kc] });
    };
    let text: number[] = [];
    const flushText = () => {
        if (text.length) out.push({ type: "text", text: new TextDecoder().decode(new Uint8Array(text)) });
        text = [];
    };
    let i = 0;
    while (i < data.length) {
        if (data[i] === SS_QMK_PREFIX) {
            flushText();
            const act = data[i + 1];
            if (act === undefined) break;
            if (act === SS_TAP || act === SS_DOWN || act === SS_UP) {
                if (i + 2 >= data.length) break;
                push(act === SS_TAP ? "tap" : act === SS_DOWN ? "down" : "up", data[i + 2]);
                i += 3;
            } else if (act === EXT_TAP || act === EXT_DOWN || act === EXT_UP) {
                if (i + 3 >= data.length) break;
                let kc = data[i + 2] | (data[i + 3] << 8);
                if (kc > 0xff00) kc = (kc & 0xff) << 8;
                push(act === EXT_TAP ? "tap" : act === EXT_DOWN ? "down" : "up", kc);
                i += 4;
            } else if (act === SS_DELAY) {
                if (i + 3 >= data.length) break;
                out.push({ type: "delay", ms: data[i + 2] - 1 + (data[i + 3] - 1) * 255 });
                i += 4;
            } else i += 2; // malformed, skip like Vial does
        } else {
            text.push(data[i]);
            i++;
        }
    }
    flushText();
    return out;
}

/** Split the macro buffer into `count` macros (NUL separated). */
export function decodeMacroBuffer(buf: number[], count: number): MacroAction[][] {
    const macros: number[][] = [[]];
    for (const b of buf) {
        if (b === 0) {
            if (macros.length >= count) break;
            macros.push([]);
        } else macros[macros.length - 1].push(b);
    }
    while (macros.length < count) macros.push([]);
    return macros.slice(0, count).map(decodeMacro);
}

export function encodeMacroBuffer(macros: MacroAction[][], vialProtocol: number): number[] {
    const out: number[] = [];
    for (const m of macros) out.push(...encodeMacro(m, vialProtocol), 0);
    return out;
}

// ---------------------------------------------------------------------------
// .vil (Vial layout file) — the same JSON the Vial GUI saves.

interface VilFile {
    version: number;
    uid: number | string;
    layout: (string | number)[][][];
    encoder_layout?: unknown[];
    layout_options?: number;
    macro?: unknown[][];
    vial_protocol?: number;
    via_protocol?: number;
    tap_dance?: unknown[][];
    combo?: unknown[][];
    key_override?: Record<string, number | string>[];
    alt_repeat_key?: Record<string, number | string>[];
    settings?: Record<string, number>;
    cosmetic?: Partial<Names> & Record<string, unknown>; // keybard's names block; Vial ignores it
}

function macroToVil(m: MacroAction[]): unknown[] {
    return m.map((a) => {
        if (a.type === "text") return ["text", a.text];
        if (a.type === "delay") return ["delay", a.ms];
        return [a.type, ...a.keys.map(serialize)];
    });
}

function macroFromVil(m: unknown[]): MacroAction[] {
    const out: MacroAction[] = [];
    for (const raw of m) {
        if (!Array.isArray(raw)) continue;
        const [tag, ...rest] = raw;
        if (tag === "text") out.push({ type: "text", text: String(rest[0] ?? "") });
        else if (tag === "delay") out.push({ type: "delay", ms: Number(rest[0]) || 0 });
        else if (tag === "tap" || tag === "down" || tag === "up") out.push({ type: tag, keys: rest.map((k) => deserialize(k as string)) });
    }
    return out;
}

export function toVil(kb: KeyboardData): string {
    const layout = kb.keymap.map((layer) => {
        const rows: (string | number)[][] = [];
        for (let r = 0; r < kb.rows; r++) {
            const row: (string | number)[] = [];
            for (let c = 0; c < kb.cols; c++) {
                const present = TOTEM_PRESENT.has(r * kb.cols + c);
                row.push(present ? serialize(layer[r * kb.cols + c]) : -1);
            }
            rows.push(row);
        }
        return rows;
    });
    const data: VilFile = {
        version: 1,
        uid: kb.uid !== null ? (kb.uid <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(kb.uid) : kb.uid.toString()) : 0,
        layout,
        encoder_layout: kb.keymap.map(() => []),
        layout_options: -1,
        macro: kb.macros.map(macroToVil),
        vial_protocol: kb.vialProtocol,
        via_protocol: kb.viaProtocol,
        tap_dance: kb.tapDances.map((t) => [serialize(t.onTap), serialize(t.onHold), serialize(t.onDoubleTap), serialize(t.onTapHold), t.term]),
        combo: kb.combos.map((c) => [...c.keys.map(serialize), serialize(c.output)]),
        key_override: kb.overrides.map((o) => ({
            trigger: serialize(o.trigger),
            replacement: serialize(o.replacement),
            layers: o.layers,
            trigger_mods: o.triggerMods,
            negative_mod_mask: o.negativeMods,
            suppressed_mods: o.suppressedMods,
            options: o.options,
        })),
        alt_repeat_key: kb.altRepeats.map((a) => ({
            keycode: serialize(a.keycode),
            alt_keycode: serialize(a.altKeycode),
            allowed_mods: a.allowedMods,
            options: a.options,
        })),
        settings: Object.fromEntries([...kb.settings].map(([k, v]) => [String(k), v])),
    };
    const names = compactNames(kb.names);
    if (Object.keys(names).length) data.cosmetic = names;
    // Vial writes big integers for the uid; keep a bigint uid unquoted.
    return JSON.stringify(data, null, 2).replace(/"uid": "(\d+)"/, '"uid": $1');
}

/** Apply a .vil file onto `base` (which fixes the table sizes). Returns a new KeyboardData. */
export function fromVil(text: string, base: KeyboardData): KeyboardData {
    // Big uids don't survive JSON.parse as numbers; quote them first.
    const json = JSON.parse(text.replace(/"uid"\s*:\s*(\d{16,})/, '"uid": "$1"')) as VilFile;
    if (!Array.isArray(json.layout)) throw new Error("This is not a Vial layout (.vil) file");
    const kb = cloneData(base);
    if (json.uid !== undefined && json.uid !== 0) {
        try {
            kb.uid = BigInt(json.uid);
        } catch {
            /* keep */
        }
    }
    json.layout.forEach((layer, l) => {
        if (l >= kb.layers) return;
        layer.forEach((row, r) =>
            row.forEach((v, c) => {
                if (r < kb.rows && c < kb.cols && v !== -1 && TOTEM_PRESENT.has(r * kb.cols + c)) kb.keymap[l][r * kb.cols + c] = deserialize(v);
            }),
        );
    });
    if (Array.isArray(json.macro)) {
        kb.macros = kb.macros.map((m, i) => (Array.isArray(json.macro![i]) ? macroFromVil(json.macro![i]) : []));
    }
    (json.tap_dance ?? []).forEach((t, i) => {
        if (i >= kb.tapDances.length || !Array.isArray(t)) return;
        kb.tapDances[i] = {
            onTap: deserialize(t[0] as string),
            onHold: deserialize(t[1] as string),
            onDoubleTap: deserialize(t[2] as string),
            onTapHold: deserialize(t[3] as string),
            term: Number(t[4]) || 0,
        };
    });
    (json.combo ?? []).forEach((c, i) => {
        if (i >= kb.combos.length || !Array.isArray(c)) return;
        kb.combos[i] = { keys: [0, 1, 2, 3].map((k) => deserialize(c[k] as string)) as Combo["keys"], output: deserialize(c[4] as string) };
    });
    (json.key_override ?? []).forEach((o, i) => {
        if (i >= kb.overrides.length) return;
        kb.overrides[i] = {
            trigger: deserialize(o.trigger),
            replacement: deserialize(o.replacement),
            layers: Number(o.layers) || 0,
            triggerMods: Number(o.trigger_mods) || 0,
            negativeMods: Number(o.negative_mod_mask) || 0,
            suppressedMods: Number(o.suppressed_mods) || 0,
            options: Number(o.options) || 0,
        };
    });
    (json.alt_repeat_key ?? []).forEach((a, i) => {
        if (i >= kb.altRepeats.length) return;
        kb.altRepeats[i] = { keycode: deserialize(a.keycode), altKeycode: deserialize(a.alt_keycode), allowedMods: Number(a.allowed_mods) || 0, options: Number(a.options) || 0 };
    });
    for (const [k, v] of Object.entries(json.settings ?? {})) kb.settings.set(Number(k), Number(v));
    // A file without names (e.g. saved by Vial) keeps the names we already have.
    if (json.cosmetic) kb.names = sanitizeNames(json.cosmetic, kb);
    return kb;
}

export function cloneData(kb: KeyboardData): KeyboardData {
    return {
        ...kb,
        keymap: kb.keymap.map((l) => [...l]),
        macros: kb.macros.map((m) => m.map((a) => (a.type === "tap" || a.type === "down" || a.type === "up" ? { ...a, keys: [...a.keys] } : { ...a }))),
        tapDances: kb.tapDances.map((t) => ({ ...t })),
        combos: kb.combos.map((c) => ({ keys: [...c.keys] as Combo["keys"], output: c.output })),
        overrides: kb.overrides.map((o) => ({ ...o })),
        altRepeats: kb.altRepeats.map((a) => ({ ...a })),
        features: new Set(kb.features),
        settings: new Map(kb.settings),
        names: sanitizeNames(kb.names, kb),
    };
}

// Matrix positions that exist on the TOTEM (38 of the 8x5 matrix).
import { TOTEM_KEYS } from "./totem-geometry";
export const TOTEM_ROWS = 8;
export const TOTEM_COLS = 5;
export const TOTEM_PRESENT = new Set(TOTEM_KEYS.map((k) => k.row * TOTEM_COLS + k.col));

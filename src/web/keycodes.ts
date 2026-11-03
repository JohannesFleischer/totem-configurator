// Keycodes: names, labels and numbers exactly as Vial (protocol 6) uses them, so that
// .vil files round-trip with the Vial GUI. Data lives in keycodes-data.ts (generated).
import { GROUPS, V6, type KcRow } from "./keycodes-data";
import { activeLayout, charFor, hasAltGr, typedBy } from "./hostlayout";

export interface KeycodeDef {
    id: string; // Vial qmk_id, e.g. "KC_A", "LCTL(kc)", "MO(1)"
    code: number;
    label: string; // may contain "\n"
    tooltip?: string;
    aliases: string[];
    masked: boolean; // takes an inner basic keycode: "LCTL(kc)"
    feature?: string; // only shown when the board reports this feature
    group: string;
}

export const KC_NO = 0x0000;
export const KC_TRNS = 0x0001;
export const QK_BOOT = V6.QK_BOOT;

export const QK = {
    MODS: 0x0100, // 0x0100-0x1FFF: mods + basic key
    MOD_TAP: V6.QK_MOD_TAP, // 0x2000-0x3FFF
    LAYER_TAP: V6.QK_LAYER_TAP, // 0x4000-0x4FFF
    LAYER_MOD: V6.QK_LAYER_MOD, // 0x5000-0x51FF
    TO: V6.QK_TO,
    MO: V6.QK_MOMENTARY,
    DF: V6.QK_DEF_LAYER,
    TG: V6.QK_TOGGLE_LAYER,
    OSL: V6.QK_ONE_SHOT_LAYER,
    OSM: V6.QK_ONE_SHOT_MOD,
    TT: V6.QK_LAYER_TAP_TOGGLE,
    PDF: V6.QK_PERSISTENT_DEF_LAYER,
    TD: V6.QK_TAP_DANCE,
    MACRO: V6.QK_MACRO,
    KB: V6.QK_KB,
};

// 5-bit QMK mod numbers (MOD_LCTL ...). Bit 4 means "right hand".
export const MOD = { CTL: 1, SFT: 2, ALT: 4, GUI: 8, RIGHT: 0x10 };

export interface BoardCaps {
    layers: number;
    macroCount: number;
    tapDanceCount: number;
    features: Set<string>;
}

const LAYER_FNS: [string, number, string][] = [
    ["MO", QK.MO, "Momentarily turn on layer while held"],
    ["TG", QK.TG, "Toggle layer on or off"],
    ["TO", QK.TO, "Turn on layer, turn off all other layers except the default"],
    ["TT", QK.TT, "Like MO, but tapping it several times toggles the layer on"],
    ["OSL", QK.OSL, "Turn on layer for the next key press only"],
    ["DF", QK.DF, "Set the base (default) layer until replug"],
    ["PDF", QK.PDF, "Persistently set the base (default) layer"],
];

class Registry {
    byId = new Map<string, KeycodeDef>(); // primary ids, with "(kc)" stripped too
    byName = new Map<string, number>(); // every id and alias -> code
    byCode = new Map<number, KeycodeDef>(); // Vial's RAWCODES_MAP (later groups win)
    masked = new Set<number>();
    shiftedByCode = new Map<number, KeycodeDef>();
    groups = new Map<string, KeycodeDef[]>();
    caps: BoardCaps = { layers: 4, macroCount: 16, tapDanceCount: 8, features: new Set() };

    constructor() {
        this.rebuild(this.caps);
    }

    private add(group: string, def: Omit<KeycodeDef, "group">) {
        const d: KeycodeDef = { ...def, group };
        this.groups.get(group)!.push(d);
    }

    private fromRows(group: string, rows: KcRow[]) {
        this.groups.set(group, []);
        for (const [id, code, label, extra] of rows) {
            this.add(group, { id, code, label, tooltip: extra?.t, aliases: extra?.a ?? [], masked: !!extra?.m, feature: extra?.f });
        }
    }

    /** Recreate dynamic keycodes (layers, macros, tap dances) for a board, like Vial's recreate_keyboard_keycodes. */
    rebuild(caps: BoardCaps) {
        this.caps = caps;
        this.groups.clear();
        this.fromRows("special", GROUPS.special);
        this.fromRows("basic", GROUPS.basic);
        this.fromRows("shifted", GROUPS.shifted);
        this.fromRows("iso", GROUPS.iso);

        this.groups.set("layers", []);
        this.add("layers", { id: "QK_LAYER_LOCK", code: V6.QK_LAYER_LOCK, label: "Layer\nLock", tooltip: "Locks the current layer", aliases: ["QK_LLCK"], masked: false, feature: "layer_lock" });
        if (caps.layers >= 4) {
            this.add("layers", { id: "FN_MO13", code: 0x7c77, label: "Fn1\n(Fn3)", aliases: [], masked: false });
            this.add("layers", { id: "FN_MO23", code: 0x7c78, label: "Fn2\n(Fn3)", aliases: [], masked: false });
        }
        for (const [fn, base, tip] of LAYER_FNS) {
            for (let l = 0; l < caps.layers; l++) {
                this.add("layers", { id: `${fn}(${l})`, code: base + l, label: `${fn}(${l})`, tooltip: tip, aliases: [], masked: false, feature: fn === "PDF" ? "persistent_default_layer" : undefined });
            }
        }
        for (let l = 0; l < Math.min(caps.layers, 16); l++) {
            this.add("layers", { id: `LT${l}(kc)`, code: QK.LAYER_TAP | (l << 8), label: `LT ${l}\n(kc)`, tooltip: `kc on tap, layer ${l} while held`, aliases: [], masked: true });
        }

        this.fromRows("boot", GROUPS.boot);
        this.fromRows("modifiers", GROUPS.modifiers);
        this.fromRows("quantum", GROUPS.quantum);
        this.fromRows("backlight", GROUPS.backlight);
        this.fromRows("media", GROUPS.media);

        this.groups.set("tapdance", []);
        for (let i = 0; i < caps.tapDanceCount; i++) {
            this.add("tapdance", { id: `TD(${i})`, code: QK.TD + i, label: `TD(${i})`, tooltip: "Tap dance keycode", aliases: [], masked: false });
        }
        this.fromRows("macro", GROUPS.macro_base);
        const macroBase = this.groups.get("macro")!;
        const macros: KeycodeDef[] = [];
        for (let i = 0; i < caps.macroCount; i++) {
            macros.push({ id: `M${i}`, code: QK.MACRO + i, label: `M${i}`, aliases: [], masked: false, group: "macro" });
        }
        this.groups.set("macro", [...macros, ...macroBase]);

        this.groups.set("user", []);
        for (let i = 0; i < 16; i++) {
            const id = `USER${String(i).padStart(2, "0")}`;
            this.add("user", { id, code: QK.KB + i, label: `User ${i}`, tooltip: `User keycode ${i}`, aliases: [], masked: false });
        }
        this.groups.set("hidden", []);
        for (let i = 0; i < 256; i++) {
            this.add("hidden", { id: `TD(${i})`, code: QK.TD + i, label: `TD(${i})`, aliases: [], masked: false });
        }

        // Vial's masked set: every "(kc)" keycode, LT0..LT15 included, whatever the layer count.
        this.masked.clear();
        for (const d of this.groups.get("modifiers")!) if (d.masked) this.masked.add(d.code);
        for (let l = 0; l < 16; l++) this.masked.add(QK.LAYER_TAP | (l << 8));

        this.byId.clear();
        this.byName.clear();
        this.byCode.clear();
        const order = ["special", "basic", "shifted", "iso", "layers", "boot", "modifiers", "quantum", "backlight", "media", "tapdance", "macro", "user", "hidden"];
        for (const g of order) {
            for (const d of this.groups.get(g)!) {
                const bare = d.id.replace("(kc)", "");
                this.byId.set(d.id, d);
                this.byId.set(bare, d);
                for (const n of [d.id, bare, ...d.aliases, ...d.aliases.map((a) => a.replace("(kc)", ""))]) {
                    if (!this.byName.has(n)) this.byName.set(n, d.code);
                }
                this.byCode.set(d.code, d);
            }
        }
        // Names Vial resolves even when the board has fewer layers/macros (e.g. in .vil files).
        for (let l = 0; l < 32; l++) for (const [fn, base] of LAYER_FNS) if (!this.byName.has(`${fn}(${l})`)) this.byName.set(`${fn}(${l})`, base + l);
        for (let i = 0; i < 256; i++) if (!this.byName.has(`M${i}`)) this.byName.set(`M${i}`, QK.MACRO + i);
        for (let i = 0; i < 64; i++) {
            const id = `USER${String(i).padStart(2, "0")}`;
            if (!this.byName.has(id)) this.byName.set(id, QK.KB + i);
        }
        for (const [k, v] of Object.entries(V6)) if (k.startsWith("MOD_")) this.byName.set(k, v);

        this.shiftedByCode.clear();
        for (const d of this.groups.get("shifted")!) this.shiftedByCode.set(d.code, d);
    }

    isVisible(d: KeycodeDef) {
        return !d.feature || this.caps.features.has(d.feature);
    }
}

export const registry = new Registry();

// ---------------------------------------------------------------------------
// Code -> Vial name (Keycode.serialize)

export function serialize(code: number): string {
    if (!registry.masked.has(code & 0xff00)) {
        const d = registry.byCode.get(code);
        if (d) return d.id;
    } else {
        const outer = registry.byCode.get(code & 0xff00);
        const inner = registry.byCode.get(code & 0x00ff);
        if (outer && inner) return outer.id.replace("kc", inner.id);
    }
    return "0x" + code.toString(16);
}

// ---------------------------------------------------------------------------
// Name / QMK expression -> code (Keycode.deserialize + AnyKeycode)

const r = (k: string) => V6[k];
const mt = (mod: number, kc: number) => r("QK_MOD_TAP") | ((mod & 0x1f) << 8) | (kc & 0xff);
const M = { LCTL: 1, LSFT: 2, LALT: 4, LGUI: 8, RCTL: 0x11, RSFT: 0x12, RALT: 0x14, RGUI: 0x18 };
const modWrap = (...qk: string[]) => (kc: number) => qk.reduce((acc, k) => acc | r(k), kc);

const FUNCTIONS: Record<string, (...a: number[]) => number> = {
    LCTL: modWrap("QK_LCTL"), LSFT: modWrap("QK_LSFT"), LALT: modWrap("QK_LALT"), LGUI: modWrap("QK_LGUI"),
    RCTL: modWrap("QK_RCTL"), RSFT: modWrap("QK_RSFT"), RALT: modWrap("QK_RALT"), RGUI: modWrap("QK_RGUI"),
    C_S: modWrap("QK_LCTL", "QK_LSFT"), HYPR: modWrap("QK_LCTL", "QK_LSFT", "QK_LALT", "QK_LGUI"),
    MEH: modWrap("QK_LCTL", "QK_LSFT", "QK_LALT"), LCAG: modWrap("QK_LCTL", "QK_LALT", "QK_LGUI"),
    SGUI: modWrap("QK_LGUI", "QK_LSFT"), LCA: modWrap("QK_LCTL", "QK_LALT"), LSA: modWrap("QK_LSFT", "QK_LALT"),
    LAG: modWrap("QK_LALT", "QK_LGUI"), RSA: modWrap("QK_RSFT", "QK_RALT"), RCS: modWrap("QK_RCTL", "QK_RSFT"),
    LCG: modWrap("QK_LCTL", "QK_LGUI"), RCG: modWrap("QK_RCTL", "QK_RGUI"),
    LT: (layer, kc) => r("QK_LAYER_TAP") | ((layer & 0xf) << 8) | (kc & 0xff),
    TO: (l) => r("QK_TO") | (l & 0x1f),
    MO: (l) => r("QK_MOMENTARY") | (l & 0x1f),
    DF: (l) => r("QK_DEF_LAYER") | (l & 0x1f),
    PDF: (l) => r("QK_PERSISTENT_DEF_LAYER") | (l & 0x1f),
    TG: (l) => r("QK_TOGGLE_LAYER") | (l & 0x1f),
    OSL: (l) => r("QK_ONE_SHOT_LAYER") | (l & 0x1f),
    TT: (l) => r("QK_LAYER_TAP_TOGGLE") | (l & 0x1f),
    LM: (layer, mod) => r("QK_LAYER_MOD") | ((layer & 0xf) << r("QMK_LM_SHIFT")) | (mod & r("QMK_LM_MASK")),
    OSM: (mod) => r("QK_ONE_SHOT_MOD") | (mod & 0x1f),
    MT: mt,
    TD: (n) => r("QK_TAP_DANCE") | (n & 0xff),
    LCTL_T: (kc) => mt(M.LCTL, kc), RCTL_T: (kc) => mt(M.RCTL, kc), LSFT_T: (kc) => mt(M.LSFT, kc), RSFT_T: (kc) => mt(M.RSFT, kc),
    LALT_T: (kc) => mt(M.LALT, kc), RALT_T: (kc) => mt(M.RALT, kc), LGUI_T: (kc) => mt(M.LGUI, kc), RGUI_T: (kc) => mt(M.RGUI, kc),
    C_S_T: (kc) => mt(M.LCTL | M.LSFT, kc), MEH_T: (kc) => mt(M.LCTL | M.LSFT | M.LALT, kc),
    LCAG_T: (kc) => mt(M.LCTL | M.LALT | M.LGUI, kc), RCAG_T: (kc) => mt(M.RCTL | M.RALT | M.RGUI, kc),
    HYPR_T: (kc) => mt(M.LCTL | M.LSFT | M.LALT | M.LGUI, kc), SGUI_T: (kc) => mt(M.LGUI | M.LSFT, kc),
    LCA_T: (kc) => mt(M.LCTL | M.LALT, kc), LSA_T: (kc) => mt(M.LSFT | M.LALT, kc), LAG_T: (kc) => mt(M.LALT | M.LGUI, kc),
    RSA_T: (kc) => mt(M.RSFT | M.RALT, kc), RCS_T: (kc) => mt(M.RCTL | M.RSFT, kc), LCG_T: (kc) => mt(M.LCTL | M.LGUI, kc),
    RCG_T: (kc) => mt(M.RCTL | M.RGUI, kc),
};
const FN_ALIASES: Record<string, string> = {
    LOPT: "LALT", LCMD: "LGUI", LWIN: "LGUI", ALGR: "RALT", ROPT: "RALT", RCMD: "RGUI", RWIN: "RGUI",
    SCMD: "SGUI", SWIN: "SGUI", LSG: "SGUI", SAGR: "RSA", C: "LCTL", S: "LSFT", A: "LALT", G: "LGUI", LCS: "C_S",
    CTL_T: "LCTL_T", SFT_T: "LSFT_T", LOPT_T: "LALT_T", ROPT_T: "RALT_T", ALGR_T: "RALT_T", ALT_T: "LALT_T", OPT_T: "LALT_T",
    LCMD_T: "LGUI_T", LWIN_T: "LGUI_T", RCMD_T: "RGUI_T", RWIN_T: "RGUI_T", GUI_T: "LGUI_T", CMD_T: "LGUI_T", WIN_T: "LGUI_T",
    SCMD_T: "SGUI_T", SWIN_T: "SGUI_T", LSG_T: "SGUI_T", SAGR_T: "RSA_T", ALL_T: "HYPR_T", LCS_T: "C_S_T",
};

class Parser {
    private i = 0;
    constructor(private s: string) {}
    parse(): number {
        const v = this.expr();
        this.ws();
        if (this.i < this.s.length) throw new Error(`Unexpected "${this.s.slice(this.i)}"`);
        return v;
    }
    private ws() {
        while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
    }
    private expr(): number {
        let v = this.term();
        for (;;) {
            this.ws();
            const c = this.s[this.i];
            if (c === "|" || c === "+") {
                this.i++;
                const t = this.term();
                v = c === "|" ? v | t : v + t;
            } else return v;
        }
    }
    private term(): number {
        this.ws();
        const rest = this.s.slice(this.i);
        const num = /^(0x[0-9a-fA-F]+|\d+)/.exec(rest);
        if (num) {
            this.i += num[0].length;
            return Number(num[0]);
        }
        if (this.s[this.i] === "(") {
            this.i++;
            const v = this.expr();
            this.expect(")");
            return v;
        }
        const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
        if (!name) throw new Error(`Unexpected "${rest || "end"}"`);
        this.i += name[0].length;
        this.ws();
        const id = name[0];
        if (this.s[this.i] === "(") {
            // Whole registered names with parentheses first, e.g. "MO(1)", "OSM(MOD_LSFT)", "TD(3)".
            const close = this.s.indexOf(")", this.i);
            if (close > 0) {
                const whole = id + this.s.slice(this.i, close + 1).replace(/\s+/g, "");
                const known = registry.byName.get(whole);
                if (known !== undefined && !/\(.*\(/.test(whole)) {
                    this.i = close + 1;
                    return known;
                }
            }
            this.i++;
            const args: number[] = [];
            this.ws();
            if (this.s[this.i] !== ")") {
                for (;;) {
                    args.push(this.expr());
                    this.ws();
                    if (this.s[this.i] === ",") {
                        this.i++;
                        continue;
                    }
                    break;
                }
            }
            this.expect(")");
            const fnName = FN_ALIASES[id] ?? id;
            const lt = /^LT(\d+)$/.exec(fnName);
            if (lt) return FUNCTIONS.LT(Number(lt[1]), args[0] ?? 0);
            const fn = FUNCTIONS[fnName];
            if (!fn) throw new Error(`Unknown function ${id}()`);
            return fn(...args);
        }
        const v = registry.byName.get(id);
        if (v === undefined) throw new Error(`Unknown keycode ${id}`);
        return v;
    }
    private expect(c: string) {
        this.ws();
        if (this.s[this.i] !== c) throw new Error(`Expected "${c}"`);
        this.i++;
    }
}

/** Parse a Vial/QMK keycode name or expression ("KC_A", "LT(2,KC_SPC)", "0x7e40"). Throws on errors. */
export function parseKeycode(s: string): number {
    const t = s.trim();
    const direct = registry.byName.get(t);
    if (direct !== undefined) return direct;
    const v = new Parser(t).parse();
    if (!Number.isInteger(v) || v < 0 || v > 0xffff) throw new Error("Keycode out of range");
    return v;
}

/** Vial's deserialize: numbers pass through, unknown strings become KC_NO. */
export function deserialize(v: string | number): number {
    if (typeof v === "number") return v;
    try {
        return parseKeycode(v);
    } catch {
        return 0;
    }
}

// ---------------------------------------------------------------------------
// Display

export interface KeyFace {
    header?: string; // dark band on top: "LT1", "LSFT_T", "MO", "TD" ...
    main: string; // centre label (may contain "\n")
    sub?: string; // small secondary label (shifted symbol)
    title: string; // tooltip
    kind: "blank" | "trans" | "basic" | "mod" | "modtap" | "layertap" | "layer" | "osm" | "tapdance" | "macro" | "user" | "other";
    literal?: boolean; // main/sub are characters from the computer's layout: show them as-is (ß, µ)
    layer?: number; // for layer keys
    idx?: number; // tap dance / macro index
}

const MOD_SHORT: [number, string][] = [
    [1, "Ctl"],
    [2, "Sft"],
    [4, "Alt"],
    [8, "Gui"],
];

export function modsText(mod5: number): string {
    const right = mod5 & 0x10 ? "R" : "";
    const names = MOD_SHORT.filter(([b]) => mod5 & b).map(([, n]) => n);
    if (names.length === 4) return right + "Hyper";
    if (names.length === 3 && !(mod5 & 8)) return right + "Meh";
    return names.map((n) => right + n).join("+") || "—";
}

/** Keycap label for a basic keycode: what it types on the computer's layout, else Vial's label. */
function labelOf(code: number): { main: string; sub?: string; literal?: boolean } {
    const c = charFor(code);
    if (c && c.ch) {
        const shifted = charFor(0x0200 | code);
        const sub = shifted?.ch && shifted.ch.toLowerCase() !== c.ch.toLowerCase() ? shifted.ch : undefined;
        return { main: c.ch, sub, literal: true };
    }
    const d = registry.byCode.get(code);
    if (!d) return { main: "0x" + code.toString(16).padStart(4, "0") };
    return splitLabel(d.label);
}

/** "— types “z” on German" for a keycode the layout data covers. */
function typesNote(code: number): string {
    const c = charFor(code);
    const ch = typedBy(code) ?? c?.ch;
    const what = ch ? `“${ch}”${c?.dead ? " (dead key)" : c?.note ? ` (${c.note})` : ""}` : c?.note;
    return what ? ` — types ${what} on ${activeLayout().name}` : "";
}

function splitLabel(label: string): { main: string; sub?: string } {
    const parts = label.split("\n");
    // Shifted pairs like "!\n1": show "1" big, "!" small.
    if (parts.length === 2 && [...parts[0]].length <= 2 && [...parts[1]].length <= 2) return { main: parts[1], sub: parts[0] };
    return { main: label };
}

const innerLiteral = (code: number) => !!charFor(code & 0xff)?.ch;

function innerLabel(code: number): string {
    if (code === 0) return "";
    const l = labelOf(code & 0xff);
    return l.main;
}

// User-given names for layers, macros and tap dances (set by the app; keycodes.ts has no state).
type Namer = (kind: "layer" | "macros" | "tapdances", idx: number) => string | undefined;
let nameOf: Namer = () => undefined;
export function setNamer(fn: Namer) {
    nameOf = fn;
}
const quoted = (n: string | undefined) => (n ? ` “${n}”` : "");

export function describe(code: number): KeyFace {
    const name = serialize(code);
    const d = registry.byCode.get(code);
    const title = d?.tooltip ? `${name}: ${d.tooltip}` : name;

    if (code === KC_NO) return { main: "", title: "KC_NO (blank)", kind: "blank" };
    if (code === KC_TRNS) return { main: "▽", title: "KC_TRNS (transparent: falls through to the layer below)", kind: "trans" };
    if (code === 0xe6 && hasAltGr()) return { main: "AltGr", title: `${title} — AltGr on ${activeLayout().name}`, kind: "basic" };
    if (code < 0x100) return { ...labelOf(code), title: title + typesNote(code), kind: "basic" };
    if (code < 0x2000) {
        // Shift / AltGr combinations that type a character on the computer's layout show that character.
        const typed = charFor(code);
        if (typed && typed.ch) return { main: typed.ch, title: `${name}${typesNote(code)}`, kind: "basic", literal: true };
        const outer = registry.byCode.get(code & 0xff00);
        const header = outer ? outer.id.replace("(kc)", "") : modsText((code >> 8) & 0x1f);
        return { header, main: innerLabel(code), title: title + typesNote(code), kind: "mod", literal: innerLiteral(code) };
    }
    if (code < 0x4000) {
        const outer = registry.byCode.get(code & 0xff00);
        const header = outer ? outer.id.replace("(kc)", "") : modsText((code >> 8) & 0x1f) + "_T";
        return { header, main: innerLabel(code), title: `${title} — ${modsText((code >> 8) & 0x1f)} when held, ${innerLabel(code) || "nothing"} when tapped`, kind: "modtap", literal: innerLiteral(code) };
    }
    if (code < 0x5000) {
        const layer = (code >> 8) & 0xf;
        return { header: `LT${layer}`, main: innerLabel(code), title: `${title} — layer ${layer}${quoted(nameOf("layer", layer))} when held`, kind: "layertap", layer, literal: innerLiteral(code) };
    }
    if (code < 0x5200) {
        const layer = (code >> 5) & 0xf;
        return { header: `LM${layer}`, main: modsText(code & 0x1f), title: `LM(${layer}, ${modsText(code & 0x1f)}) — layer ${layer}${quoted(nameOf("layer", layer))} with mods while held`, kind: "layer", layer };
    }
    const ranges: [number, string][] = [
        [QK.TO, "TO"],
        [QK.MO, "MO"],
        [QK.DF, "DF"],
        [QK.TG, "TG"],
        [QK.OSL, "OSL"],
        [QK.TT, "TT"],
        [QK.PDF, "PDF"],
    ];
    for (const [base, fn] of ranges) {
        if (code >= base && code < base + 0x20) {
            const layer = code - base;
            const n = nameOf("layer", layer);
            const title = `${fn}(${layer})${quoted(n)}${d?.tooltip ? `: ${d.tooltip}` : ""}`;
            // Names are shown exactly as typed (literal), not in keycap capitals: "ß" must not become "SS".
            return n ? { header: `${fn} ${layer}`, main: n, title, kind: "layer", layer, literal: true } : { header: fn, main: String(layer), title, kind: "layer", layer };
        }
    }
    if (code >= QK.OSM && code < QK.OSM + 0x20) {
        return { header: "OSM", main: modsText(code & 0x1f), title, kind: "osm" };
    }
    if (code >= QK.TD && code < QK.TD + 0x100) {
        const i = code - QK.TD,
            n = nameOf("tapdances", i);
        return { header: n ? `TD ${i}` : "TD", main: n ?? String(i), title: `TD(${i})${quoted(n)}: tap dance`, kind: "tapdance", idx: i, literal: !!n };
    }
    if (code >= QK.MACRO && code < QK.MACRO + 0x100) {
        const i = code - QK.MACRO,
            n = nameOf("macros", i);
        return { header: n ? `M${i}` : "MACRO", main: n ?? String(i), title: `M${i}${quoted(n)}: macro`, kind: "macro", idx: i, literal: !!n };
    }
    if (code >= QK.KB && code < QK.KB + 0x40) return { main: `USER\n${code - QK.KB}`, title, kind: "user" };
    if (d) return { ...splitLabel(d.label), title, kind: "other" };
    return { main: "0x" + code.toString(16).padStart(4, "0"), title: `Keycode 0x${code.toString(16).padStart(4, "0")} (not known to Vial)`, kind: "other" };
}

export function isBasic(code: number) {
    return code < 0x100;
}

// ---------------------------------------------------------------------------
// Physical keyboard -> keycode ("typing assigns keys")

const CODE_TO_KC: Record<string, string> = {
    Escape: "KC_ESCAPE", Backquote: "KC_GRAVE", Minus: "KC_MINUS", Equal: "KC_EQUAL", Backspace: "KC_BSPACE",
    Tab: "KC_TAB", BracketLeft: "KC_LBRACKET", BracketRight: "KC_RBRACKET", Backslash: "KC_BSLASH", CapsLock: "KC_CAPSLOCK",
    Semicolon: "KC_SCOLON", Quote: "KC_QUOTE", Enter: "KC_ENTER", Comma: "KC_COMMA", Period: "KC_DOT", Slash: "KC_SLASH",
    Space: "KC_SPACE", ShiftLeft: "KC_LSHIFT", ShiftRight: "KC_RSHIFT", ControlLeft: "KC_LCTRL", ControlRight: "KC_RCTRL",
    AltLeft: "KC_LALT", AltRight: "KC_RALT", MetaLeft: "KC_LGUI", MetaRight: "KC_RGUI", ContextMenu: "KC_APPLICATION",
    Insert: "KC_INSERT", Delete: "KC_DELETE", Home: "KC_HOME", End: "KC_END", PageUp: "KC_PGUP", PageDown: "KC_PGDOWN",
    ArrowUp: "KC_UP", ArrowDown: "KC_DOWN", ArrowLeft: "KC_LEFT", ArrowRight: "KC_RIGHT", PrintScreen: "KC_PSCREEN",
    ScrollLock: "KC_SCROLLLOCK", Pause: "KC_PAUSE", NumLock: "KC_NUMLOCK", NumpadDivide: "KC_KP_SLASH",
    NumpadMultiply: "KC_KP_ASTERISK", NumpadSubtract: "KC_KP_MINUS", NumpadAdd: "KC_KP_PLUS", NumpadEnter: "KC_KP_ENTER",
    NumpadDecimal: "KC_KP_DOT", NumpadEqual: "KC_KP_EQUAL", IntlBackslash: "KC_NONUS_BSLASH", IntlRo: "KC_RO", IntlYen: "KC_JYEN",
};

export function keycodeFromEvent(ev: KeyboardEvent): number | null {
    const c = ev.code;
    let id: string | undefined = CODE_TO_KC[c];
    if (!id) {
        let m: RegExpExecArray | null;
        if ((m = /^Key([A-Z])$/.exec(c))) id = "KC_" + m[1];
        else if ((m = /^Digit(\d)$/.exec(c))) id = "KC_" + m[1];
        else if ((m = /^F(\d{1,2})$/.exec(c))) id = "KC_F" + m[1];
        else if ((m = /^Numpad(\d)$/.exec(c))) id = "KC_KP_" + m[1];
    }
    if (!id) return null;
    const v = registry.byName.get(id);
    return v === undefined ? null : v;
}

export const MODIFIER_KEYCODES = new Set(["KC_LCTRL", "KC_LSHIFT", "KC_LALT", "KC_LGUI", "KC_RCTRL", "KC_RSHIFT", "KC_RALT", "KC_RGUI"].map((n) => registry.byName.get(n)!));

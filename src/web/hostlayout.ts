// The computer's keyboard layout. A keyboard sends key positions, not characters: the
// computer turns KC_Y into "z" on a German layout. This module knows what each keycode
// types on each layout (QMK's keycode extras data), detects the computer's layout, and
// converts text into the keycodes that type it.
import { HOST_LAYOUTS } from "./hostlayouts-data";

export interface HostLayout {
    id: string;
    name: string;
    mac: boolean;
    iso: boolean;
    raw: Map<number, string>; // keycode -> QMK label ("´ (dead)", "@", "Z", ...)
}

export interface CharInfo {
    ch: string; // what to show on a keycap ("" if it's not a printable character)
    dead: boolean; // a dead key: waits for the next key (´ + e = é)
    note?: string; // description from the data ("non-breaking space", "dead", ...)
}

const BY_ID = new Map<string, HostLayout>();
for (const d of HOST_LAYOUTS) {
    const raw = new Map<number, string>();
    for (const line of d.keys.split("\n")) {
        const tab = line.indexOf("\t");
        raw.set(parseInt(line.slice(0, tab), 16), line.slice(tab + 1));
    }
    BY_ID.set(d.id, { id: d.id, name: d.name, mac: d.mac, iso: d.iso, raw });
}
export const LAYOUT_LIST: HostLayout[] = [...BY_ID.values()];
export const US = BY_ID.get("us")!;

export function layoutById(id: string): HostLayout | undefined {
    return id === detectedSynthetic?.id ? detectedSynthetic : BY_ID.get(id);
}

let active: HostLayout = US;
export function setActiveLayout(l: HostLayout) {
    active = l;
}
export function activeLayout(): HostLayout {
    return active;
}

// ---------------------------------------------------------------- characters

const parsed = new WeakMap<HostLayout, Map<number, CharInfo | null>>();

function parseLabel(raw: string): CharInfo | null {
    let ch = raw;
    let note: string | undefined;
    const m = /^(.*?) \((.+)\)$/s.exec(raw);
    if (m) {
        ch = m[1];
        note = m[2];
    } else if (/^\(.+\)$/.test(raw) && raw.length > 2) {
        ch = "";
        note = raw.slice(1, -1);
    }
    const dead = !!note && /^dead/.test(note);
    // Long descriptions ("Zenkaku ↔ Hankaku ↔ Kanji") and invisible characters aren't keycap text.
    if ([...ch].length > 2 || !ch.trim() || /^[​-‏­  ]+$/.test(ch)) {
        return note || raw.trim() ? { ch: "", dead, note: note ?? raw } : null;
    }
    return { ch, dead, note };
}

function table(l: HostLayout): Map<number, CharInfo | null> {
    let t = parsed.get(l);
    if (!t) {
        t = new Map();
        for (const [code, raw] of l.raw) t.set(code, parseLabel(raw));
        parsed.set(l, t);
    }
    return t;
}

const SHIFT = 0x0200;
const ALTGR = 0x1400;

/** Normalize the modifiers of a keycode so equivalent spellings find the same entry. */
function candidates(code: number): number[] {
    const kc = code & 0xff;
    const mods = (code >> 8) & 0x1f;
    const out = [code];
    if (mods === 0x12) out.push(SHIFT | kc); // RSFT == LSFT for typing
    if (mods === 0x16) out.push(SHIFT | ALTGR | kc);
    // On Windows and Linux the US "\" key (0x31) and the ISO "#" key (0x32) are the same key.
    for (const c of [...out]) if ((c & 0xff) === 0x31) out.push((c & 0xff00) | 0x32);
    return out;
}

/** What `code` types on layout `l` (default: the active layout), or null if it's not in the data. */
export function charFor(code: number, l: HostLayout = active): CharInfo | null {
    if (code > 0x1fff) return null;
    const t = table(l);
    for (const c of candidates(code)) {
        const v = t.get(c);
        if (v !== undefined) return v;
    }
    return null;
}

const isLetter = (s: string) => s.length > 0 && s.toLowerCase() !== s.toUpperCase();

/**
 * The text produced by pressing `code` on layout `l`: letters come out lowercase without
 * Shift and uppercase with it. Returns null for dead keys and keys the data doesn't cover.
 */
export function typedBy(code: number, l: HostLayout = active): string | null {
    const kc = code & 0xff;
    const mods = (code >> 8) & 0x1f;
    if (code <= 0xff || mods === 0x02 || mods === 0x12) {
        const special: Record<number, string> = { 0x28: "\n", 0x2b: "\t", 0x2c: " " };
        if (special[kc] !== undefined && code <= 0xff) return special[kc];
    }
    const exact = charFor(code, l);
    if (exact) return exact.dead || !exact.ch ? null : code <= 0xff && isLetter(exact.ch) && [...exact.ch].length === 1 ? exact.ch.toLowerCase() : exact.ch;
    if (mods === 0x02 || mods === 0x12) {
        const base = charFor(kc, l);
        if (base && !base.dead && isLetter(base.ch) && [...base.ch].length === 1) return base.ch.toUpperCase();
    }
    return null;
}

/** The shortest keycode that types `ch` on layout `l` (fewest modifiers), or null. */
export function keycodeFor(ch: string, l: HostLayout = active): number | null {
    return inverse(l).get(ch) ?? null;
}

const inverses = new WeakMap<HostLayout, Map<string, number>>();
function inverse(l: HostLayout): Map<string, number> {
    let inv = inverses.get(l);
    if (inv) return inv;
    inv = new Map();
    const cost = (code: number) => {
        const m = (code >> 8) & 0x1f;
        return m === 0 ? 0 : m === 0x02 ? 1 : m === 0x14 || m === 0x04 ? 2 : 3;
    };
    const codes = [0x28, 0x2b, 0x2c, ...l.raw.keys()];
    for (const kc of l.raw.keys()) if (kc <= 0xff) codes.push(SHIFT | kc);
    codes.sort((a, b) => cost(a) - cost(b) || a - b);
    for (const code of codes) {
        const t = typedBy(code, l);
        if (t && !inv.has(t)) inv.set(t, code);
    }
    inverses.set(l, inv);
    return inv;
}

/** Whether the layout types extra characters with AltGr (so the right Alt key is "AltGr"). */
export function hasAltGr(l: HostLayout = active): boolean {
    for (const c of l.raw.keys()) if (c >> 8 === 0x14) return true;
    return false;
}

/** Which characters a key set by `level` modifiers belongs to, for grouping in the picker. */
export function levelName(code: number, l: HostLayout = active): string {
    const m = (code >> 8) & 0x1f;
    if (m === 0) return "Base";
    if (m === 0x02) return "Shift";
    if (m === 0x14) return "AltGr";
    if (m === 0x04) return l.mac ? "Option" : "Alt";
    if (m === 0x16) return "Shift + AltGr";
    if (m === 0x06) return l.mac ? "Shift + Option" : "Shift + Alt";
    return "Other";
}

/** Every character the layout can type with modifiers, as [keycode, info] (no plain keys). */
export function symbolsOf(l: HostLayout = active): [number, CharInfo][] {
    const out: [number, CharInfo][] = [];
    for (const [code] of l.raw) {
        if (code <= 0xff) continue;
        const c = charFor(code, l);
        if (c && c.ch) out.push([code, c]);
    }
    return out;
}

// ---------------------------------------------------------------- macros

/**
 * QMK types macro text as if the computer had a US layout (send_string). Returns what the
 * text really comes out as on layout `l`; "�" marks characters that come out as nothing.
 */
export function textAsTyped(text: string, l: HostLayout = active): string {
    if (l === US) return text;
    let out = "";
    for (const ch of text) {
        const code = keycodeFor(ch, US);
        if (code === null) {
            out += ch === "\r" ? "" : "�";
            continue;
        }
        out += typedBy(code, l) ?? "�";
    }
    return out;
}

/** Keycodes that type `text` on layout `l`, or the characters that can't be typed. */
export function textToKeycodes(text: string, l: HostLayout = active): { codes: number[]; missing: string[] } {
    const codes: number[] = [];
    const missing: string[] = [];
    for (const ch of text.replace(/\r/g, "")) {
        const code = keycodeFor(ch, l);
        if (code === null) {
            if (!missing.includes(ch)) missing.push(ch);
        } else codes.push(code);
    }
    return { codes, missing };
}

// ---------------------------------------------------------------- detection

// KeyboardEvent.code -> HID keycode, for the writing keys
const CODE_HID: Record<string, number> = {
    Minus: 0x2d, Equal: 0x2e, BracketLeft: 0x2f, BracketRight: 0x30, Backslash: 0x31, Semicolon: 0x33, Quote: 0x34,
    Backquote: 0x35, Comma: 0x36, Period: 0x37, Slash: 0x38, IntlBackslash: 0x64, IntlRo: 0x87, IntlYen: 0x89,
};
for (let i = 0; i < 26; i++) CODE_HID["Key" + String.fromCharCode(65 + i)] = 0x04 + i;
for (let i = 1; i <= 9; i++) CODE_HID["Digit" + i] = 0x1e + i - 1;
CODE_HID.Digit0 = 0x27;

export interface Detection {
    layout: HostLayout | null; // null: nothing detected
    how: "system" | "language" | "none";
    detail: string;
}

let detectedSynthetic: HostLayout | null = null;
const isMacPlatform = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");

/** Guess from the browser language (used when the system layout can't be read). */
export function guessFromLanguage(lang: string, mac = isMacPlatform()): HostLayout | null {
    const l = lang.toLowerCase();
    const [base, region = ""] = l.split("-");
    const pick = (): string | null => {
        if (base === "de") return region === "ch" ? "swiss_de" : "german";
        if (base === "fr") return region === "ca" ? "canadian_french" : region === "ch" ? "swiss_fr" : region === "be" ? "belgian" : "french";
        if (base === "nl") return region === "be" ? "belgian" : "us";
        if (base === "es") return region === "es" || !region ? "spanish" : "spanish_latin_america";
        if (base === "pt") return region === "br" ? "brazilian_abnt2" : "portuguese";
        if (base === "en") return region === "gb" ? "uk" : region === "ie" ? "irish" : "us";
        if (base === "sr") return /latn/.test(l) ? "serbian_latin" : "serbian";
        const simple: Record<string, string> = {
            it: "italian", da: "danish", sv: "swedish", fi: "finnish", nb: "norwegian", nn: "norwegian", no: "norwegian", is: "icelandic",
            et: "estonian", lv: "latvian", lt: "lithuanian_qwerty", pl: "polish", cs: "czech", sk: "slovak", hu: "hungarian", hr: "croatian",
            sl: "slovenian", ro: "romanian", tr: "turkish_q", ru: "russian", uk: "ukrainian", el: "greek", he: "hebrew", fa: "farsi",
            ja: "japanese", ko: "korean",
        };
        return simple[base] ?? null;
    };
    const id = pick();
    if (!id) return null;
    if (mac) {
        const macVariant = BY_ID.get(id + "_mac_iso") ?? (id === "german" ? BY_ID.get("german_mac_iso") : undefined);
        if (macVariant) return macVariant;
    }
    return BY_ID.get(id) ?? null;
}

/** Match a system layout map (KeyboardEvent.code -> character) against the known layouts. */
export function matchLayoutMap(map: Map<string, string>, lang = "", mac = isMacPlatform()): Detection {
    const norm = (s: string) => s.toLowerCase();
    let best: HostLayout[] = [];
    let bestScore = -1;
    let compared = 0;
    for (const l of LAYOUT_LIST) {
        let score = 0;
        let n = 0;
        for (const [code, ch] of map) {
            const hid = CODE_HID[code];
            if (hid === undefined || [...ch].length !== 1) continue;
            const c = charFor(hid, l);
            if (!c || !c.ch) continue;
            n++;
            if (norm(c.ch) === norm(ch)) score++;
        }
        if (score > bestScore) {
            bestScore = score;
            best = [l];
            compared = n;
        } else if (score === bestScore) best.push(l);
    }
    const keys = [...map.keys()].filter((c) => CODE_HID[c] !== undefined).length;
    if (!keys) return { layout: null, how: "none", detail: "The browser reported an empty keyboard layout." };
    if (bestScore >= Math.max(10, compared * 0.85)) {
        const fromLang = guessFromLanguage(lang, mac);
        const pick =
            (fromLang && best.find((l) => l === fromLang)) ??
            best.find((l) => l.mac === mac) ??
            best[0];
        return { layout: pick, how: "system", detail: `Detected from this computer's keyboard layout (${bestScore} of ${compared} keys match).` };
    }
    // An unknown layout: show at least what each key types without modifiers.
    const raw = new Map<number, string>();
    for (const [code, ch] of map) {
        const hid = CODE_HID[code];
        if (hid !== undefined && ch) raw.set(hid, ch.length === 1 ? ch.toUpperCase() : ch);
    }
    detectedSynthetic = { id: "system", name: "This computer's layout", mac, iso: raw.has(0x64), raw };
    parsed.delete(detectedSynthetic);
    return { layout: detectedSynthetic, how: "system", detail: "This computer's layout isn't in the list; showing what each key types without modifiers." };
}

interface KeyboardApi {
    getLayoutMap(): Promise<Map<string, string>>;
}

/** Detect the computer's layout: the system layout map (Chromium) first, then the browser language. */
export async function detectLayout(): Promise<Detection> {
    const lang = typeof navigator !== "undefined" ? navigator.language || "" : "";
    const kb = (typeof navigator !== "undefined" ? (navigator as unknown as { keyboard?: KeyboardApi }).keyboard : undefined) ?? null;
    if (kb?.getLayoutMap) {
        try {
            const map = await kb.getLayoutMap();
            const d = matchLayoutMap(new Map(map), lang);
            if (d.layout) return d;
        } catch {
            /* not allowed here (e.g. in a frame) */
        }
    }
    const g = lang ? guessFromLanguage(lang) : null;
    if (g) return { layout: g, how: "language", detail: `Guessed from the browser language (${lang}). The keyboard layout itself couldn't be read here.` };
    return { layout: null, how: "none", detail: "Couldn't detect the keyboard layout; using English (US)." };
}

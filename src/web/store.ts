// App state and the actions that change it (and the keyboard).
import { HidTransport } from "./hid";
import { activeLayout, detectLayout, layoutById, setActiveLayout, US, type Detection, type HostLayout } from "./hostlayout";
import { QK_BOOT, registry, serialize, setNamer } from "./keycodes";
import {
    emptyCombo,
    emptyNames,
    MAX_NAME,
    sanitizeNames,
    type NameKind,
    type Names,
    type AltRepeat,
    emptyOverride,
    emptyTapDance,
    isOverrideUsed,
    KO_DEFAULT_OPTIONS,
    fromVil,
    TOTEM_COLS,
    TOTEM_ROWS,
    toVil,
    type Combo,
    type KeyboardData,
    type KeyOverride,
    type MacroAction,
    type TapDance,
} from "./model";
import { demoKeyboard, DEFAULT_UNLOCK_KEYS, LAYOUT_ORDER } from "./totem";
import { NotVialError, OldVialError, TOTEM_UID, UnlockPendingError, Vial } from "./vial";
import { OverlayClient } from "./overlay-protocol";

export type PanelId = "keys" | "special" | "layers" | "tapdance" | "macros" | "combos" | "overrides" | "settings" | "tester" | "overlay" | "about";
export type TdSlot = "onTap" | "onHold" | "onDoubleTap" | "onTapHold";
export type Target =
    | { kind: "key"; layer: number; row: number; col: number }
    | { kind: "td"; idx: number; slot: TdSlot }
    | { kind: "combo"; idx: number; slot: number } // 0-3 inputs, 4 output
    | { kind: "ko"; idx: number; slot: "trigger" | "replacement" }
    | { kind: "macro"; idx: number; action: number; key: number }; // key === keys.length appends
export type Editing = { kind: "tapdance" | "macros" | "combos" | "overrides"; idx: number } | null;
export type KeySize = "auto" | "normal" | "medium" | "small";
export type Wrap = "none" | "mod" | "modtap" | "layertap";

export interface Prefs {
    keySize: KeySize;
    typingAssigns: boolean;
    advanceAfterTyping: boolean;
    hostLayout: string; // "auto" or a layout id: what the computer turns keycodes into
}

const PREFS_KEY = "totem-keybard:prefs";
function loadPrefs(): Prefs {
    const def: Prefs = { keySize: "auto", typingAssigns: true, advanceAfterTyping: false, hostLayout: "auto" };
    try {
        return { ...def, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
    } catch {
        return def;
    }
}

export const state = {
    kb: null as KeyboardData | null,
    source: null as "device" | "file" | "demo" | null,
    fileName: "",
    connected: false,
    layer: 0,
    target: null as Target | null,
    panel: null as PanelId | null,
    editing: null as Editing,
    prefs: loadPrefs(),
    // wrapping applied to basic keys picked from the pickers
    wrap: "none" as Wrap,
    wrapMods: 0, // 4-bit: Ctl Sft Alt Gui
    wrapRight: false,
    wrapLayer: 1,
    busy: null as null | { text: string; progress: number },
    unlocked: false,
    macrosDirty: false,
    offlineDirty: false, // edits to a file/demo layout that haven't been saved
    tester: { running: false, pressed: [] as boolean[], seen: [] as boolean[] },
    hoverCode: null as number | null,
    detected: null as Detection | null, // the computer's layout, as far as it could be detected
    // More selected keys (matrix positions on the current layer) besides the key target;
    // see selectedKeys().
    selection: [] as number[],
    multiSelect: false, // "Select multiple": plain clicks add and remove keys
    lock: null as null | { code: number | null }, // "Lock key": each click on the TOTEM puts `code` on that key
    swapFrom: null as null | { layer: number; pos: number }, // "Swap": waiting for the second key
    flash: null as null | { layer: number; keys: number[] }, // keys that just changed, briefly highlighted
    overlaySupport: null as boolean | null, // does the connected firmware report the live layer? (null: not checked)
};

// ---------------------------------------------------------------------------
// Re-rendering: UI modules register renderers per region; changes invalidate regions.

type Region = "all" | "board" | "panel" | "nav" | "top" | "overlay";
const renderers = new Map<Region, () => void>();
const dirty = new Set<Region>();
let scheduled = false;
export function onRender(region: Region, fn: () => void) {
    renderers.set(region, fn);
}
export function invalidate(...regions: Region[]) {
    for (const r of regions.length ? regions : (["all"] as Region[])) dirty.add(r);
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
        scheduled = false;
        const all = dirty.has("all");
        const list = [...dirty];
        dirty.clear();
        const called = new Set<() => void>();
        for (const [region, fn] of renderers) {
            if ((all || list.includes(region)) && !called.has(fn)) {
                called.add(fn);
                fn();
            }
        }
    });
}

export function savePrefs(p: Partial<Prefs>) {
    Object.assign(state.prefs, p);
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs));
    } catch {
        /* private mode */
    }
    invalidate("all");
}

// ---------------------------------------------------------------------------
// The computer's keyboard layout (labels only; nothing on the keyboard changes)

/** The layout the "Automatic" choice stands for. */
export function autoLayout(): HostLayout {
    return state.detected?.layout ?? US;
}

function applyHostLayout() {
    const id = state.prefs.hostLayout;
    const l = id === "auto" ? autoLayout() : (layoutById(id) ?? US);
    if (l !== activeLayout()) {
        setActiveLayout(l);
        invalidate("all");
    }
}

/** Prefs changed in another window of the app (the overlay follows the editor's layout choice). */
export function reloadPrefs() {
    state.prefs = loadPrefs();
    applyHostLayout();
    invalidate("all");
}

export function setHostLayout(id: string) {
    savePrefs({ hostLayout: id });
    applyHostLayout();
}

/** (Re)detect the computer's layout; it can change while the page is open. */
export async function redetectLayout() {
    const d = await detectLayout();
    const changed = d.layout?.id !== state.detected?.layout?.id || d.how !== state.detected?.how;
    state.detected = d;
    if (changed) invalidate("panel");
    applyHostLayout();
}
applyHostLayout();

// ---------------------------------------------------------------------------
// Firmware features

/** Mouse keycodes: cursor, buttons 1-8, wheel, acceleration (KC_MS_U .. KC_ACL2). */
export const isMouseKeycode = (code: number) => code >= 0xcd && code <= 0xdf;

/**
 * Whether the connected firmware has mouse keys: Vial lists its mouse key settings
 * (ids 9-17) only when they are compiled in. null = can't tell (offline, or a firmware
 * without QMK settings).
 */
export function mouseKeysSupported(): boolean | null {
    const kb = state.kb;
    if (!kb || !state.connected || !kb.settings.size) return null;
    for (let q = 9; q <= 17; q++) if (kb.settings.has(q)) return true;
    return false;
}

// ---------------------------------------------------------------------------
// Notifications and dialogs (implemented by the UI)

export const ui = {
    toast: (_msg: string, _kind: "info" | "error" | "ok" = "info", _id?: string) => {},
    confirm: async (_title: string, _body: string, _ok = "OK"): Promise<boolean> => true,
    unlock: async (_keys: [number, number][]): Promise<boolean> => false,
};

function fail(e: unknown) {
    console.error(e);
    ui.toast(e instanceof Error ? e.message : String(e), "error");
}

// ---------------------------------------------------------------------------
// Connection

export const transport = new HidTransport();
export const vial = new Vial(transport);

transport.onDisconnect = () => {
    state.connected = false;
    state.unlocked = false;
    state.tester.running = false;
    if (state.source === "device") ui.toast("Keyboard disconnected. You can keep editing offline and save a .vil file.", "info");
    state.source = state.kb ? "file" : null;
    state.fileName = state.fileName || "unsaved-layout.vil";
    invalidate("all");
};

async function withBusy<T>(text: string, fn: (progress: (f: number, t?: string) => void) => Promise<T>): Promise<T> {
    state.busy = { text, progress: 0 };
    invalidate("overlay");
    try {
        return await fn((f, t) => {
            state.busy = { text: t ?? text, progress: f };
            invalidate("overlay");
        });
    } finally {
        state.busy = null;
        invalidate("overlay");
    }
}

export async function connect(reconnect = false) {
    try {
        const ok = reconnect ? await transport.reconnect() : await transport.connect();
        if (!ok) return;
    } catch (e) {
        if ((e as Error)?.name === "NotFoundError") return; // chooser cancelled
        if (reconnect) return console.warn("Automatic reconnect failed:", e); // stay quiet on page load
        return fail(e);
    }
    // An offline layout with unsaved edits can be written to the keyboard after connecting.
    const offline = state.kb && state.source !== "device" && state.offlineDirty ? toVil(state.kb) : null;
    try {
        let kb;
        try {
            kb = await withBusy("Reading your keyboard", (p) => vial.load(p));
        } catch (e) {
            if (!(e instanceof UnlockPendingError)) throw e;
            // A previous session started an unlock; the board only listens again once it's done.
            if (!(await ui.unlock(e.keys.length ? e.keys : DEFAULT_UNLOCK_KEYS))) throw new Error("Unlock not finished; unplug and replug the keyboard to reset it.");
            kb = await withBusy("Reading your keyboard", (p) => vial.load(p));
        }
        if (kb.uid !== TOTEM_UID && !/totem/i.test(transport.productName)) {
            const go = await ui.confirm(
                "This doesn't look like a TOTEM",
                `“${transport.productName || "This keyboard"}” runs Vial, but it isn't a TOTEM. This editor only knows the TOTEM's 38-key layout (8×5 matrix), so keys may show in the wrong places. Continue anyway?`,
                "Continue",
            );
            if (!go) {
                await transport.close();
                return;
            }
        }
        kb.names = loadNames(kb);
        state.kb = kb;
        state.source = "device";
        state.connected = true;
        state.unlocked = false;
        state.layer = Math.min(state.layer, kb.layers - 1);
        state.target = null;
        state.editing = null;
        try {
            state.unlocked = (await vial.unlockStatus()).unlocked;
        } catch {
            /* old firmware */
        }
        if (!state.panel) state.panel = "keys";
        const offlineName = state.fileName;
        state.offlineDirty = false;
        resetHistory();
        invalidate("all");
        if (offline) {
            const go = await ui.confirm(
                "Write your edited layout to the keyboard?",
                `You changed “${offlineName}” while offline. Write it to the TOTEM now, or keep what's on the keyboard? (The editor now shows the keyboard's own layout.)`,
                "Write to keyboard",
            );
            if (go) {
                await uploadAll(fromVil(offline, kb), `Write ${offlineName} to the keyboard`);
                ui.toast("Wrote your layout to the keyboard", "ok");
            }
        }
    } catch (e) {
        if (!state.connected) await transport.close();
        if (e instanceof NotVialError) ui.toast("This keyboard doesn't run Vial firmware. Flash a current TOTEM Vial firmware first (firmware/ folder in the download).", "error");
        else if (e instanceof OldVialError) ui.toast(e.message, "error");
        else fail(e);
        invalidate("all");
    }
}

// ---------------------------------------------------------------------------
// Names (layers, macros, tap dances, combos, overrides). Vial can't keep them on the
// keyboard, so for a connected TOTEM they're remembered in this browser, per keyboard UID,
// and they always travel in saved .vil files.

const namesKey = (kb: KeyboardData) => `totem-keybard:names:${kb.uid ?? "none"}`;

function loadNames(kb: KeyboardData) {
    try {
        return sanitizeNames(JSON.parse(localStorage.getItem(namesKey(kb)) ?? "null"), kb);
    } catch {
        return emptyNames();
    }
}

function storeNames(kb: KeyboardData) {
    if (state.source !== "device") return;
    try {
        localStorage.setItem(namesKey(kb), JSON.stringify(kb.names));
    } catch {
        /* storage blocked: names still go into saved files */
    }
}

setNamer((kind, idx) => state.kb?.names[kind][String(idx)]);

export function nameOf(kind: NameKind, idx: number): string | undefined {
    return state.kb?.names[kind][String(idx)];
}

export async function disconnect() {
    await transport.close();
    state.connected = false;
    state.unlocked = false;
    state.tester.running = false;
    state.source = state.kb ? "file" : null;
    state.fileName = state.fileName || "unsaved-layout.vil";
    invalidate("all");
}

export function loadDemo() {
    state.kb = demoKeyboard();
    state.offlineDirty = false;
    state.source = "demo";
    state.fileName = "totem-demo.vil";
    state.layer = 0;
    state.target = null;
    state.editing = null;
    state.panel = "keys";
    resetHistory();
    invalidate("all");
}

export async function closeLayout() {
    if (state.offlineDirty && !(await ui.confirm("Close without saving?", "You have changes that aren't saved to a .vil file yet.", "Close anyway"))) return;
    state.offlineDirty = false;
    state.kb = null;
    state.source = null;
    state.target = null;
    state.editing = null;
    state.panel = null;
    resetHistory();
    invalidate("all");
}

// ---------------------------------------------------------------------------
// Files

/** An empty TOTEM with table sizes taken from a .vil file. */
function blankFromVil(text: string): KeyboardData {
    const j = JSON.parse(text.replace(/"uid"\s*:\s*(\d{16,})/, '"uid": "$1"'));
    const layers = Array.isArray(j.layout) ? j.layout.length : 4;
    const td = Array.isArray(j.tap_dance) ? j.tap_dance.length : 0;
    const macros = Array.isArray(j.macro) ? j.macro.length : 0;
    const features = new Set<string>(["caps_word", "persistent_default_layer"]);
    if (Array.isArray(j.alt_repeat_key) && j.alt_repeat_key.length) features.add("repeat_key");
    registry.rebuild({ layers, macroCount: macros, tapDanceCount: td, features });
    return {
        name: "TOTEM",
        uid: null,
        viaProtocol: Number(j.via_protocol) || 9,
        vialProtocol: Number(j.vial_protocol) || 6,
        rows: TOTEM_ROWS,
        cols: TOTEM_COLS,
        layers,
        keymap: Array.from({ length: layers }, () => new Array(TOTEM_ROWS * TOTEM_COLS).fill(0)),
        macroCount: macros,
        macroBufferSize: 4096,
        macros: Array.from({ length: macros }, () => []),
        tapDances: Array.from({ length: td }, emptyTapDance),
        combos: Array.from({ length: Array.isArray(j.combo) ? j.combo.length : 0 }, emptyCombo),
        overrides: Array.from({ length: Array.isArray(j.key_override) ? j.key_override.length : 0 }, emptyOverride),
        altRepeats: Array.from({ length: Array.isArray(j.alt_repeat_key) ? j.alt_repeat_key.length : 0 }, () => ({ keycode: 0, altKeycode: 0, allowedMods: 0, options: 0 })),
        features,
        settings: new Map(),
        names: emptyNames(),
    };
}

export async function openFile(file: File) {
    let text: string;
    try {
        text = await file.text();
        if (file.size > 1024 * 1024) throw new Error("That file is too big to be a layout (over 1 MB).");
    } catch (e) {
        return fail(e);
    }
    try {
        if (state.connected && state.kb) {
            const next = fromVil(text, state.kb);
            const go = await ui.confirm("Write this layout to your TOTEM?", `“${file.name}” will replace the keymap, macros, tap dances, combos, overrides and settings on the connected keyboard.`, "Write to keyboard");
            if (!go) return;
            await uploadAll(next, `Write ${file.name} to the keyboard`);
            ui.toast(`Wrote ${file.name} to the keyboard`, "ok");
        } else {
            const base = blankFromVil(text);
            state.kb = fromVil(text, base);
            state.kb.name = "TOTEM";
            state.offlineDirty = false;
            state.source = "file";
            state.fileName = file.name;
            state.layer = 0;
            state.target = null;
            state.editing = null;
            state.panel = state.panel ?? "keys";
            resetHistory();
            invalidate("all");
        }
    } catch (e) {
        fail(e);
    }
}

export function saveFile() {
    const kb = state.kb;
    if (!kb) return;
    const blob = new Blob([toVil(kb)], { type: "application/json" });
    const a = document.createElement("a");
    const base = state.source === "device" ? `totem-${new Date().toISOString().slice(0, 10)}.vil` : state.fileName || "totem-layout.vil";
    a.href = URL.createObjectURL(blob);
    a.download = base.endsWith(".vil") ? base : base + ".vil";
    state.offlineDirty = false;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Write a whole layout to the connected keyboard, sending only what differs (one undo step). */
async function uploadAll(next: KeyboardData, label: string) {
    const cur = state.kb!;
    const changes: Change[] = [];
    for (let l = 0; l < cur.layers; l++)
        for (let i = 0; i < cur.rows * cur.cols; i++) changes.push({ t: "key", layer: l, i, from: cur.keymap[l][i], to: next.keymap[l][i] });
    cur.tapDances.forEach((t, i) => changes.push({ t: "td", idx: i, from: { ...t }, to: { ...next.tapDances[i] } }));
    cur.combos.forEach((c, i) => changes.push({ t: "combo", idx: i, from: cloneCombo(c), to: cloneCombo(next.combos[i]) }));
    cur.overrides.forEach((o, i) => changes.push({ t: "ko", idx: i, from: { ...o }, to: { ...next.overrides[i] } }));
    cur.altRepeats.forEach((a, i) => changes.push({ t: "ar", idx: i, from: { ...a }, to: { ...next.altRepeats[i] } }));
    for (const [q, v] of next.settings) if (cur.settings.has(q)) changes.push({ t: "setting", qsid: q, from: cur.settings.get(q)!, to: v });
    changes.push({ t: "macros", from: deep(macrosBase), to: deep(next.macros) });
    changes.push({ t: "names", from: deep(namesBase), to: deep(next.names) });
    const macrosChange = JSON.stringify(next.macros) !== JSON.stringify(macrosOnDevice);
    if (macrosChange && !(await ensureUnlocked())) throw new Error("The keyboard must be unlocked to write macros.");
    await withBusy("Writing to keyboard", async (p) => {
        await commit(label, changes, (f) => p(f * 0.95));
        if (macrosChange) {
            await vial.setMacros(cur.macros, cur.vialProtocol, cur.macroBufferSize);
            macrosOnDevice = deep(cur.macros);
        }
        p(1);
    });
    refreshMacrosDirty();
    invalidate("all");
}

// ---------------------------------------------------------------------------
// Unlock

export async function ensureUnlocked(): Promise<boolean> {
    if (!state.connected) return true;
    try {
        const st = await vial.unlockStatus();
        if (st.unlocked) {
            state.unlocked = true;
            return true;
        }
        const ok = await ui.unlock(st.keys.length ? st.keys : DEFAULT_UNLOCK_KEYS);
        state.unlocked = ok;
        invalidate("all");
        return ok;
    } catch (e) {
        fail(e);
        return false;
    }
}

export async function lockKeyboard() {
    try {
        await vial.lock();
        state.unlocked = false;
        state.tester.running = false;
        invalidate("all");
        ui.toast("Keyboard locked", "ok");
    } catch (e) {
        fail(e);
    }
}

// ---------------------------------------------------------------------------
// Editing

const idx = (row: number, col: number) => row * TOTEM_COLS + col;

export function keyAt(layer: number, row: number, col: number): number {
    return state.kb?.keymap[layer]?.[idx(row, col)] ?? 0;
}

export function selectTarget(t: Target | null) {
    state.target = t;
    state.selection = [];
    // Picking a slot in an editor ends the board modes (their clicks would go to the slot).
    if (t && t.kind !== "key") stopModes();
    invalidate("board", "panel");
}

export function sameTarget(a: Target | null, b: Target | null): boolean {
    return !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
}

/** The keycode currently stored at the target. */
export function targetCode(t: Target | null): number | null {
    const kb = state.kb;
    if (!t || !kb) return null;
    switch (t.kind) {
        case "key":
            return keyAt(t.layer, t.row, t.col);
        case "td":
            return kb.tapDances[t.idx]?.[t.slot] ?? null;
        case "combo":
            return t.slot === 4 ? kb.combos[t.idx]?.output : kb.combos[t.idx]?.keys[t.slot];
        case "ko":
            return kb.overrides[t.idx]?.[t.slot] ?? null;
        case "macro": {
            const a = kb.macros[t.idx]?.[t.action];
            return a && "keys" in a ? (a.keys[t.key] ?? null) : null;
        }
    }
}

/** Apply a wrap (mods / mod-tap / layer-tap) chosen in the picker to a basic keycode. */
export function wrapCode(code: number): number {
    if (state.wrap === "none" || code > 0xff) return code;
    const mods = state.wrapMods | (state.wrapRight && state.wrapMods ? 0x10 : 0);
    if (state.wrap === "mod") return mods ? (mods << 8) | code : code;
    if (state.wrap === "modtap") return mods ? 0x2000 | (mods << 8) | code : code;
    return 0x4000 | ((state.wrapLayer & 0xf) << 8) | code;
}

const TD_SLOT_NAMES: Record<TdSlot, string> = { onTap: "tap", onHold: "hold", onDoubleTap: "double tap", onTapHold: "tap-hold" };
const titled = (kind: NameKind, i: number, base: string) => {
    const n = state.kb?.names[kind][String(i)];
    return n ? `${base} “${n}”` : base;
};

/** Put a keycode on the current target (and on the keyboard, when connected). */
export async function assign(code: number, how: "picker" | "typing" | "board" = "picker") {
    // "Lock key": picking or typing a key changes what clicks on the TOTEM put on keys.
    if (state.lock && how !== "board") {
        setLockCode(code);
        return;
    }
    const t = state.target;
    const kb = state.kb;
    if (!t || !kb) {
        ui.toast("Select a key on the TOTEM first", "info");
        return;
    }
    switch (t.kind) {
        case "key": {
            const keys = selectedKeys();
            if (keys.length > 1) {
                // several keys selected: all of them get the key, as one undo step
                await commit(
                    `${serialize(code)} on ${keys.length} keys (${titled("layer", t.layer, `layer ${t.layer}`)})`,
                    keys.map((i): Change => ({ t: "key", layer: t.layer, i, from: kb.keymap[t.layer][i], to: code })),
                );
                flashKeys(t.layer, keys);
                break;
            }
            const i = idx(t.row, t.col);
            const from = kb.keymap[t.layer][i];
            await commit(`${serialize(from)} → ${serialize(code)} on ${titled("layer", t.layer, `layer ${t.layer}`)}`, [{ t: "key", layer: t.layer, i, from, to: code }]);
            if (how === "typing" && state.prefs.advanceAfterTyping) advanceTarget();
            break;
        }
        case "td": {
            const from = kb.tapDances[t.idx];
            await commit(`${titled("tapdances", t.idx, `Tap dance ${t.idx}`)}: ${TD_SLOT_NAMES[t.slot]} → ${serialize(code)}`, [{ t: "td", idx: t.idx, from: { ...from }, to: { ...from, [t.slot]: code } }]);
            break;
        }
        case "combo": {
            const from = kb.combos[t.idx];
            const to: Combo = { keys: [...from.keys] as Combo["keys"], output: from.output };
            if (t.slot === 4) to.output = code;
            else to.keys[t.slot] = code;
            await commit(`${titled("combos", t.idx, `Combo ${t.idx}`)}: ${t.slot === 4 ? "output" : `key ${t.slot + 1}`} → ${serialize(code)}`, [{ t: "combo", idx: t.idx, from: cloneCombo(from), to }]);
            if (t.slot < 3 && how === "board" && sameTarget(state.target, t)) selectTarget({ ...t, slot: t.slot + 1 });
            break;
        }
        case "ko": {
            const from = kb.overrides[t.idx];
            await commit(`${titled("overrides", t.idx, `Override ${t.idx}`)}: ${t.slot} → ${serialize(code)}`, [{ t: "ko", idx: t.idx, from: { ...from }, to: { ...overrideView(t.idx), [t.slot]: code } }]);
            break;
        }
        case "macro": {
            const next = deep(kb.macros);
            const a = next[t.idx]?.[t.action];
            if (!a || !("keys" in a)) break;
            a.keys[t.key] = code;
            await commitMacros(`${titled("macros", t.idx, `Macro ${t.idx}`)}: key → ${serialize(code)}`, next);
            // keep adding keys to this action
            if (sameTarget(state.target, t)) selectTarget({ ...t, key: Math.min(t.key + 1, a.keys.length) });
            break;
        }
    }
}

/** Move the key target to the next key in TOTEM order (left to right, top to bottom). */
export function advanceTarget() {
    const t = state.target;
    if (!t || t.kind !== "key") return;
    const i = LAYOUT_ORDER.findIndex(([r, c]) => r === t.row && c === t.col);
    const [row, col] = LAYOUT_ORDER[(i + 1) % LAYOUT_ORDER.length];
    selectTarget({ kind: "key", layer: t.layer, row, col });
}

// ---------------------------------------------------------------------------
// Several keys at once: multi-select, swap, "Lock key"

const posTarget = (layer: number, pos: number): Target => ({ kind: "key", layer, row: Math.floor(pos / TOTEM_COLS), col: pos % TOTEM_COLS });

/**
 * Matrix positions (row * cols + col) of the selected keys: the key target (last) plus any
 * keys added to it with Ctrl/⌘/Shift-click, "Select multiple" or a box.
 */
export function selectedKeys(): number[] {
    const t = state.target;
    if (!t || t.kind !== "key") return [];
    const p = idx(t.row, t.col);
    return [...state.selection.filter((q) => q !== p), p];
}

/** Select exactly these keys on a layer (the last one shows in the info box). */
export function setKeySelection(layer: number, keys: number[]) {
    const list = [...new Set(keys)];
    const last = list.pop();
    state.layer = layer;
    state.target = last === undefined ? null : posTarget(layer, last);
    state.selection = list;
    state.swapFrom = null;
    invalidate("board", "panel");
}

/** Add a key to the selection, or take it out again. */
export function toggleKey(layer: number, row: number, col: number) {
    const p = idx(row, col);
    const keys = state.target?.kind === "key" && state.target.layer === layer ? selectedKeys() : [];
    setKeySelection(layer, keys.includes(p) ? keys.filter((q) => q !== p) : [...keys, p]);
}

export function setMultiSelect(on: boolean) {
    state.multiSelect = on;
    invalidate("board");
}

let flashTimer: ReturnType<typeof setTimeout> | undefined;
/** Briefly highlight keys that just changed. */
export function flashKeys(layer: number, keys: number[]) {
    state.flash = { layer, keys };
    invalidate("board");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
        state.flash = null;
        invalidate("board");
    }, 650);
}

type KeyRef = { layer: number; i: number };
const keyName = (k: KeyRef) => serialize(state.kb!.keymap[k.layer][k.i]);

/**
 * Swap two keys (on the same or different layers), or with `copy` put the first key's
 * keycode on the second one too. One undo step.
 */
export async function swapKeys(a: KeyRef, b: KeyRef, copy = false): Promise<boolean> {
    const kb = state.kb;
    if (!kb || (a.layer === b.layer && a.i === b.i)) return false;
    const ca = kb.keymap[a.layer][a.i],
        cb = kb.keymap[b.layer][b.i];
    if (ca === cb) {
        ui.toast(`Both keys are already ${serialize(ca)}`, "info", "swap");
        return false;
    }
    const where = a.layer === b.layer ? titled("layer", a.layer, `layer ${a.layer}`) : `layers ${a.layer} and ${b.layer}`;
    const ok = copy
        ? await commit(`Copy ${keyName(a)} onto ${keyName(b)} (${titled("layer", b.layer, `layer ${b.layer}`)})`, [{ t: "key", layer: b.layer, i: b.i, from: cb, to: ca }])
        : await commit(`Swap ${keyName(a)} ↔ ${keyName(b)} (${where})`, [
              { t: "key", layer: a.layer, i: a.i, from: ca, to: cb },
              { t: "key", layer: b.layer, i: b.i, from: cb, to: ca },
          ]);
    if (ok) flashKeys(state.layer, [a, b].filter((k) => k.layer === state.layer).map((k) => k.i));
    return ok;
}

/**
 * The Swap button: two selected keys are swapped right away; with one, the next key you
 * click (on any layer) is swapped with it.
 */
export async function startSwap() {
    const t = state.target;
    const keys = selectedKeys();
    if (!t || t.kind !== "key") return;
    if (keys.length === 2) {
        await swapKeys({ layer: t.layer, i: keys[0] }, { layer: t.layer, i: keys[1] });
        return;
    }
    if (keys.length !== 1) return;
    state.lock = null;
    state.swapFrom = { layer: t.layer, pos: keys[0] };
    invalidate("board", "panel");
}

/** Swap mode: the second key was clicked. Clicking the first key again cancels. */
export async function finishSwap(layer: number, row: number, col: number) {
    const from = state.swapFrom;
    state.swapFrom = null;
    invalidate("board");
    if (!from) return;
    const p = idx(row, col);
    if (from.layer === layer && from.pos === p) return;
    if (await swapKeys({ layer: from.layer, i: from.pos }, { layer, i: p })) setKeySelection(layer, [p]);
}

/** Start "Lock key": every click on the TOTEM puts `code` on that key until it's stopped. */
export function startLock(code: number | null) {
    state.lock = { code };
    state.swapFrom = null;
    state.target = null;
    state.selection = [];
    invalidate("board", "panel");
}

export function setLockCode(code: number) {
    if (!state.lock) return;
    state.lock.code = code;
    invalidate("board", "panel");
}

/** "Lock key": a key on the TOTEM was clicked. */
export async function lockApply(layer: number, row: number, col: number) {
    const kb = state.kb;
    const code = state.lock?.code;
    if (!kb || code === undefined) return;
    const i = idx(row, col);
    if (code === null) {
        // nothing locked yet: the first key clicked is the one to copy
        setLockCode(kb.keymap[layer][i]);
        flashKeys(layer, [i]);
        return;
    }
    const from = kb.keymap[layer][i];
    await commit(`${serialize(from)} → ${serialize(code)} on ${titled("layer", layer, `layer ${layer}`)}`, [{ t: "key", layer, i, from, to: code }]);
    flashKeys(layer, [i]);
}

/** End "Lock key" and swap mode. */
export function stopModes() {
    if (!state.lock && !state.swapFrom) return;
    state.lock = null;
    state.swapFrom = null;
    invalidate("board", "panel");
}

/** Esc: end a mode, then clear the selection, then turn off "Select multiple". */
export function escape(): boolean {
    if (state.lock || state.swapFrom) {
        stopModes();
        return true;
    }
    if (state.target) {
        selectTarget(null);
        return true;
    }
    if (state.multiSelect) {
        setMultiSelect(false);
        return true;
    }
    return false;
}

/** An override as the editor shows it: a never-used slot starts from Vial's defaults. */
export function overrideView(i: number): KeyOverride {
    const kb = state.kb!;
    const o = kb.overrides[i];
    return !isOverrideUsed(o) && o.options === 0 ? { ...o, options: KO_DEFAULT_OPTIONS, layers: (1 << Math.min(16, kb.layers)) - 1 } : o;
}

export function updateTapDance(i: number, td: TapDance, what = "") {
    return commit(`${titled("tapdances", i, `Tap dance ${i}`)}${what ? ": " + what : ""}`, [{ t: "td", idx: i, from: { ...state.kb!.tapDances[i] }, to: { ...td } }]);
}
export function updateCombo(i: number, c: Combo, what = "") {
    return commit(`${titled("combos", i, `Combo ${i}`)}${what ? ": " + what : ""}`, [{ t: "combo", idx: i, from: cloneCombo(state.kb!.combos[i]), to: cloneCombo(c) }]);
}
export function updateOverride(i: number, o: KeyOverride, what = "") {
    return commit(`${titled("overrides", i, `Override ${i}`)}${what ? ": " + what : ""}`, [{ t: "ko", idx: i, from: { ...state.kb!.overrides[i] }, to: { ...o } }]);
}
export function updateSetting(qsid: number, value: number, label = `Setting ${qsid} → ${value}`) {
    return commit(label, [{ t: "setting", qsid, from: state.kb!.settings.get(qsid) ?? 0, to: value }]);
}

// ---- macros: the editor may change state.kb.macros in place while you type; the
// "before" side of a macro edit is the last committed snapshot.

/** Replace one macro (records an undo step). */
export function setMacro(i: number, actions: MacroAction[], what = "edit") {
    const next = deep(state.kb!.macros);
    next[i] = deep(actions);
    return commitMacros(`${titled("macros", i, `Macro ${i}`)}: ${what}`, next);
}

/** Record in-place edits (typed text, delays) of macro `i` as one undo step. */
export function commitMacroEdit(i: number, what = "edit") {
    return commitMacros(`${titled("macros", i, `Macro ${i}`)}: ${what}`, state.kb!.macros);
}

/** Note an in-place macro edit that hasn't been committed yet (typing). */
export function macroTyping() {
    state.macrosDirty = state.connected;
    if (!state.connected) state.offlineDirty = true;
}

function commitMacros(label: string, next: MacroAction[][]) {
    return commit(label, [{ t: "macros", from: deep(macrosBase), to: deep(next) }]);
}

export async function writeMacros(): Promise<boolean> {
    const kb = state.kb!;
    if (!state.connected) {
        refreshMacrosDirty();
        invalidate("panel");
        return true;
    }
    if (!(await ensureUnlocked())) return false;
    try {
        await withBusy("Writing macros", () => vial.setMacros(kb.macros, kb.vialProtocol, kb.macroBufferSize));
        macrosOnDevice = deep(kb.macros);
        refreshMacrosDirty();
        invalidate("panel");
        ui.toast("Macros saved to the keyboard", "ok");
        return true;
    } catch (e) {
        fail(e);
        return false;
    }
}

/** Throw away macro edits that aren't on the keyboard yet (undoable). */
export function revertMacros() {
    return commitMacros("Discard unsaved macro changes", macrosOnDevice);
}

// ---------------------------------------------------------------------------
// Undo / redo. Every edit is a list of changes with before ("from") and after ("to")
// values. Applying a side updates the editor at once and then the keyboard, in order.

export type Change =
    | { t: "key"; layer: number; i: number; from: number; to: number }
    | { t: "td"; idx: number; from: TapDance; to: TapDance }
    | { t: "combo"; idx: number; from: Combo; to: Combo }
    | { t: "ko"; idx: number; from: KeyOverride; to: KeyOverride }
    | { t: "ar"; idx: number; from: AltRepeat; to: AltRepeat }
    | { t: "setting"; qsid: number; from: number; to: number }
    | { t: "macros"; from: MacroAction[][]; to: MacroAction[][] }
    | { t: "names"; from: Names; to: Names };
interface Edit {
    label: string;
    changes: Change[];
}

const MAX_HISTORY = 300;
const history = { undo: [] as Edit[], redo: [] as Edit[] };
let macrosBase: MacroAction[][] = []; // last committed macros
let macrosOnDevice: MacroAction[][] = []; // what the connected keyboard has
let namesBase: Names = emptyNames(); // last committed names

function deep<T>(v: T): T {
    return JSON.parse(JSON.stringify(v));
}
function cloneCombo(c: Combo): Combo {
    return { keys: [...c.keys] as Combo["keys"], output: c.output };
}

/** Whether the connected firmware has the overlay report (firmware/overlay_report.c). */
let checkingOverlay = false;
export async function checkOverlaySupport() {
    if (!state.connected || checkingOverlay) return;
    checkingOverlay = true;
    try {
        state.overlaySupport = await new OverlayClient(transport).supported();
    } finally {
        checkingOverlay = false;
    }
    invalidate("panel");
}

/** Start a fresh history (and selection) for newly loaded data. */
function resetHistory() {
    history.undo = [];
    history.redo = [];
    state.selection = [];
    state.lock = null;
    state.swapFrom = null;
    state.flash = null;
    state.overlaySupport = null;
    macrosBase = deep(state.kb?.macros ?? []);
    macrosOnDevice = state.connected ? deep(state.kb?.macros ?? []) : [];
    namesBase = deep(state.kb?.names ?? emptyNames());
    refreshMacrosDirty();
}

function refreshMacrosDirty() {
    state.macrosDirty = !!state.kb && state.connected && JSON.stringify(state.kb.macros) !== JSON.stringify(macrosOnDevice);
}

export const undoLabel = () => history.undo[history.undo.length - 1]?.label ?? null;
export const redoLabel = () => history.redo[history.redo.length - 1]?.label ?? null;

const hasBoot = (c: Change, dir: "from" | "to"): boolean => {
    switch (c.t) {
        case "key":
            return c[dir] === QK_BOOT;
        case "td": {
            const t = c[dir];
            return [t.onTap, t.onHold, t.onDoubleTap, t.onTapHold].includes(QK_BOOT);
        }
        case "combo":
            return c[dir].output === QK_BOOT;
        case "ko":
            return c[dir].replacement === QK_BOOT;
        case "ar":
            return c[dir].keycode === QK_BOOT || c[dir].altKeycode === QK_BOOT;
        default:
            return false;
    }
};

function setLocal(c: Change, dir: "from" | "to") {
    const kb = state.kb!;
    switch (c.t) {
        case "key":
            kb.keymap[c.layer][c.i] = c[dir];
            break;
        case "td":
            kb.tapDances[c.idx] = { ...c[dir] };
            break;
        case "combo":
            kb.combos[c.idx] = cloneCombo(c[dir]);
            break;
        case "ko":
            kb.overrides[c.idx] = { ...c[dir] };
            break;
        case "ar":
            kb.altRepeats[c.idx] = { ...c[dir] };
            break;
        case "setting":
            kb.settings.set(c.qsid, c[dir]);
            break;
        case "macros":
            kb.macros = deep(c[dir]);
            macrosBase = deep(c[dir]);
            break;
        case "names":
            kb.names = deep(c[dir]);
            namesBase = deep(c[dir]);
            storeNames(kb);
            break;
    }
}

async function writeDevice(c: Change, dir: "from" | "to") {
    switch (c.t) {
        case "key":
            return vial.setKey(c.layer, Math.floor(c.i / TOTEM_COLS), c.i % TOTEM_COLS, c[dir]);
        case "td":
            return vial.setTapDance(c.idx, c[dir]);
        case "combo":
            return vial.setCombo(c.idx, c[dir]);
        case "ko":
            return vial.setOverride(c.idx, c[dir]);
        case "ar":
            return vial.setAltRepeat(c.idx, c[dir]);
        case "setting":
            return vial.setSetting(c.qsid, c[dir]);
        // macros are saved with "Save to keyboard"; names live in files and this browser
    }
}

/** Apply one side of a set of changes: the editor at once, then the keyboard. */
async function applyChanges(changes: Change[], dir: "from" | "to", progress?: (f: number) => void): Promise<boolean> {
    if (state.connected && changes.some((c) => hasBoot(c, dir)) && !(await ensureUnlocked())) return false;
    const list = dir === "to" ? changes : [...changes].reverse();
    for (const c of list) setLocal(c, dir);
    if (!state.connected) state.offlineDirty = true;
    refreshMacrosDirty();
    invalidate("all");
    if (!state.connected) return true;
    let n = 0;
    try {
        for (const c of list) {
            await writeDevice(c, dir);
            progress?.(++n / list.length);
        }
    } catch (e) {
        fail(e);
    }
    return true;
}

/** Make an edit: apply it and remember it for undo. Returns false if nothing changed. */
async function commit(label: string, changes: Change[], progress?: (f: number) => void): Promise<boolean> {
    const real = changes.filter((c) => JSON.stringify(c.from) !== JSON.stringify(c.to));
    if (!real.length || !state.kb) return false;
    if (!(await applyChanges(real, "to", progress))) return false;
    history.undo.push({ label, changes: real });
    if (history.undo.length > MAX_HISTORY) history.undo.shift();
    history.redo = [];
    invalidate("all");
    return true;
}

let historyQueue: Promise<unknown> = Promise.resolve();
export function undo() {
    historyQueue = historyQueue.then(() => step("undo"));
    return historyQueue;
}
export function redo() {
    historyQueue = historyQueue.then(() => step("redo"));
    return historyQueue;
}

async function step(which: "undo" | "redo") {
    if (!state.kb || state.busy) return;
    const src = which === "undo" ? history.undo : history.redo;
    const dst = which === "undo" ? history.redo : history.undo;
    const e = src.pop();
    if (!e) return;
    const ok = await applyChanges(e.changes, which === "undo" ? "from" : "to");
    if (!ok) {
        src.push(e);
        return;
    }
    dst.push(e);
    // Show where the change happened: go to the layer and highlight the keys (and select a
    // single changed key, unless "Lock key" is on).
    const keys = e.changes.filter((c): c is Extract<Change, { t: "key" }> => c.t === "key");
    if (keys.length && keys.length === e.changes.length && keys.length <= 38) {
        // stay on the current layer if it changed (a swap across layers), else go to the change
        const layer = keys.some((k) => k.layer === state.layer) ? state.layer : keys[keys.length - 1].layer;
        const here = keys.filter((k) => k.layer === layer).map((k) => k.i);
        state.layer = layer;
        if (state.target?.kind === "key") state.target = { ...state.target, layer }; // a selection follows the layer
        if (keys.length === 1 && !state.lock) {
            state.target = posTarget(layer, here[0]);
            state.selection = [];
            state.swapFrom = null;
        }
        flashKeys(layer, here);
    }
    ui.toast(`${which === "undo" ? "Undone" : "Redone"}: ${e.label}`, "info", "history");
    invalidate("all");
}

// ---- names

const NAME_LABELS: Record<NameKind, string> = { layer: "layer", macros: "macro", tapdances: "tap dance", combos: "combo", overrides: "override" };

/**
 * Rename (or, with an empty name, un-name) an item. While typing (`live`), the name only
 * shows up around the app; leaving the field records it (and makes it undoable).
 */
export function rename(kind: NameKind, i: number, name: string, live = false) {
    const kb = state.kb;
    if (!kb) return;
    const clean = live ? name.replace(/\s+/g, " ").slice(0, MAX_NAME) : name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
    if (live) {
        if (clean.trim()) kb.names[kind][String(i)] = clean.trim();
        else delete kb.names[kind][String(i)];
        invalidate("board", "nav");
        return;
    }
    const to = deep(namesBase);
    if (clean) to[kind][String(i)] = clean;
    else delete to[kind][String(i)];
    const label = clean ? `Name ${NAME_LABELS[kind]} ${i} “${clean}”` : `Clear the name of ${NAME_LABELS[kind]} ${i}`;
    // the live edits already touched kb.names; commit from the last recorded names
    kb.names = deep(namesBase);
    commit(label, [{ t: "names", from: deep(namesBase), to }]).then((changed) => {
        if (!changed) invalidate("all");
    });
}

// ---------------------------------------------------------------------------
// Key tester

export async function startTester() {
    if (!state.connected || !state.kb) return;
    if (!(await ensureUnlocked())) return;
    stopModes();
    const n = state.kb.rows * state.kb.cols;
    state.tester = { running: true, pressed: new Array(n).fill(false), seen: new Array(n).fill(false) };
    invalidate("board", "panel");
    while (state.tester.running && state.connected && state.panel === "tester") {
        try {
            const m = await vial.matrix(state.kb.rows, state.kb.cols);
            let changed = false,
                newlySeen = false;
            m.forEach((p, i) => {
                if (state.tester.pressed[i] !== p) changed = true;
                state.tester.pressed[i] = p;
                if (p && !state.tester.seen[i]) state.tester.seen[i] = newlySeen = true;
            });
            if (newlySeen) invalidate("board", "panel");
            else if (changed) invalidate("board");
        } catch {
            /* skip a beat */
        }
        await new Promise((r) => setTimeout(r, 30));
    }
    state.tester.running = false;
    invalidate("board", "panel");
}

export function stopTester() {
    state.tester.running = false;
    invalidate("board", "panel");
}

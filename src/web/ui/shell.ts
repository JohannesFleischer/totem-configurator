// App shell: navigation, panel, main area (top bar, layers, TOTEM), welcome screen, overlays.
import { HidTransport } from "../hid";
import { describe, keycodeFromEvent, MODIFIER_KEYCODES, serialize } from "../keycodes";
import { TOTEM_COLS } from "../model";
import {
    assign,
    closeLayout,
    connect,
    disconnect,
    escape,
    finishSwap,
    invalidate,
    keyAt,
    loadDemo,
    lockApply,
    nameOf,
    onRender,
    openFile,
    redetectLayout,
    redo,
    redoLabel,
    rename,
    savePrefs,
    saveFile,
    selectedKeys,
    selectTarget,
    setLockCode,
    setMultiSelect,
    startLock,
    startSwap,
    state,
    stopModes,
    stopTester,
    targetCode,
    toggleKey,
    transport,
    ui,
    undo,
    undoLabel,
    vial,
    type PanelId,
} from "../store";
import { layerColor } from "../totem";
import { BOARD_W, MAX_SQUEEZE, renderBoard, slotKey } from "./board";
import { h, icon, ICONS, mount } from "./dom";
import { attachGestures, cancelGesture, gestureClasses } from "./gestures";
import { closeEditor, comboEditor, comboList, macroEditor, macroList, overrideEditor, overrideList, tapDanceEditor, tapDanceList } from "./editors";
import { aboutPanel, overlayPanel, settingsPanel, testerPanel } from "./panels";
import { customKey, layerKeys, macroTdKeys, specialKeys, standardKeys } from "./picker";

// The TOTEM's split shape: three staggered key columns and a thumb key per half.
const LOGO = `<svg viewBox="0 0 27 15.4" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><rect x="0.0" y="1.8" width="3.4" height="9.6" rx="1"/><rect x="4.2" y="0.0" width="3.4" height="9.6" rx="1"/><rect x="8.4" y="0.9" width="3.4" height="9.6" rx="1"/><rect x="7.4" y="12.2" width="4.4" height="3.0" rx="1"/><rect x="23.6" y="1.8" width="3.4" height="9.6" rx="1"/><rect x="19.4" y="0.0" width="3.4" height="9.6" rx="1"/><rect x="15.2" y="0.9" width="3.4" height="9.6" rx="1"/><rect x="15.2" y="12.2" width="4.4" height="3.0" rx="1"/></svg>`;

function logo(): HTMLElement {
    return h("div", { class: "brand" }, h("span", { html: LOGO, style: "display:inline-flex" }), h("div", null, h("div", { class: "word" }, "totem"), h("div", { class: "for" }, "unofficial editor")));
}

const NAV: (null | { id: PanelId; label: string; icon: string })[] = [
    { id: "keys", label: "Standard Keys", icon: ICONS.keyboard },
    { id: "special", label: "Special Keys", icon: ICONS.sparkles },
    { id: "layers", label: "Layer Keys", icon: ICONS.layers },
    null,
    { id: "tapdance", label: "Tap Dances", icon: ICONS.tapdance },
    { id: "macros", label: "Macros", icon: ICONS.macro },
    { id: "combos", label: "Combos", icon: ICONS.combo },
    { id: "overrides", label: "Overrides", icon: ICONS.override },
    null,
    { id: "tester", label: "Key Tester", icon: ICONS.tester },
    { id: "overlay", label: "Overlay", icon: ICONS.overlay },
    { id: "settings", label: "Settings", icon: ICONS.settings },
    { id: "about", label: "About", icon: ICONS.info },
];
const TITLES: Record<PanelId, string> = {
    keys: "Standard Keys",
    special: "Special Keys",
    layers: "Layer Keys",
    tapdance: "Tap Dances",
    macros: "Macros",
    combos: "Combos",
    overrides: "Key Overrides",
    tester: "Key Tester",
    overlay: "Desktop Overlay",
    settings: "Settings",
    about: "About",
};

export function openPanel(id: PanelId | null) {
    if (state.panel === "tester" && id !== "tester") stopTester();
    state.panel = state.panel === id ? null : id;
    state.editing = null;
    if (state.target && state.target.kind !== "key") state.target = null;
    invalidate("all");
}

// ---------------------------------------------------------------- regions

let root: HTMLElement;
const navEl = h("nav", { class: "nav" });
const panelEl = h("aside", { class: "panel" });
const mainEl = h("main", { class: "main" });
const overlayEl = h("div");
const toastsEl = h("div", { class: "toasts" });

function renderNav() {
    const kb = state.kb;
    const counts: Partial<Record<PanelId, string>> = kb
        ? {
              tapdance: String(kb.tapDances.filter((t) => t.onTap || t.onHold || t.onDoubleTap || t.onTapHold).length || ""),
              macros: String(kb.macros.filter((m) => m.length).length || ""),
              combos: String(kb.combos.filter((c) => c.output).length || ""),
              overrides: String(kb.overrides.filter((o) => o.trigger && o.options & 0x80).length || ""),
          }
        : {};
    mount(
        navEl,
        logo(),
        NAV.map((n) =>
            n === null
                ? h("div", { class: "nav-sep" })
                : h(
                      "button",
                      { class: ["nav-item", state.panel === n.id && "on"], title: n.label, onClick: () => openPanel(n.id) },
                      icon(n.icon, 18),
                      h("span", null, n.label),
                      counts[n.id] ? h("span", { class: "count" }, counts[n.id]) : null,
                  ),
        ),
        h("div", { class: "nav-foot" }, "Unofficial editor for the GEIST TOTEM (Vial). Not affiliated with Svalboard or GEIST."),
    );
}

function renderPanel() {
    const p = state.panel;
    panelEl.classList.toggle("hidden", !p || !state.kb);
    if (!p || !state.kb) return;
    const ed = state.editing;
    const kb = state.kb!;
    let title = TITLES[p];
    let body: HTMLElement;
    if (ed && ed.kind === p) {
        const kind = ({ tapdance: "tapdances", macros: "macros", combos: "combos", overrides: "overrides" } as const)[ed.kind];
        title = nameOf(kind, ed.idx) ?? { tapdance: `Tap Dance ${ed.idx}`, macros: `Macro ${ed.idx}`, combos: `Combo ${ed.idx}`, overrides: `Override ${ed.idx}` }[ed.kind];
        body = ed.kind === "tapdance" ? tapDanceEditor(ed.idx) : ed.kind === "macros" ? macroEditor(ed.idx) : ed.kind === "combos" ? comboEditor(ed.idx) : overrideEditor(ed.idx);
    } else {
        body =
            p === "keys"
                ? standardKeys()
                : p === "special"
                  ? h("div", null, specialKeys(), macroTdKeys(), customKey())
                  : p === "layers"
                    ? layerKeys()
                    : p === "tapdance"
                      ? tapDanceList()
                      : p === "macros"
                        ? macroList()
                        : p === "combos"
                          ? comboList()
                          : p === "overrides"
                            ? overrideList()
                            : p === "tester"
                              ? testerPanel()
                              : p === "settings"
                                ? settingsPanel()
                                : p === "overlay"
                                  ? overlayPanel()
                                  : aboutPanel();
    }
    const scroll = panelEl.querySelector(".panel-body")?.scrollTop ?? 0;
    const sameView = panelEl.dataset.view === `${p}:${ed?.kind ?? ""}:${ed?.idx ?? ""}`;
    panelEl.dataset.view = `${p}:${ed?.kind ?? ""}:${ed?.idx ?? ""}`;
    mount(
        panelEl,
        h(
            "div",
            { class: "panel-head" },
            ed && ed.kind === p ? h("button", { class: "icon-btn", title: "Back to the list", onClick: () => closeEditor() }, icon(ICONS.back, 20)) : null,
            h(
                "h2",
                null,
                ed && ed.kind === p
                    ? h("button", { class: "title-btn", title: "Rename", onClick: () => panelEl.querySelector<HTMLInputElement>(".name-row input")?.focus() }, title)
                    : title,
            ),
            h("button", { class: "icon-btn", title: "Close", onClick: () => openPanel(null) }, icon(ICONS.close, 20)),
        ),
        h("div", { class: "panel-body" }, kb ? body : h("div", { class: "notice" }, "Connect your TOTEM or open a layout first.")),
    );
    if (sameView) panelEl.querySelector(".panel-body")!.scrollTop = scroll;
}

/** Key unit in px and how much to close the gap between the halves. */
function sizing(): { unit: number; squeeze: number } {
    const size = state.prefs.keySize;
    const cs = getComputedStyle(mainEl);
    const avail = mainEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 8;
    const fit = (unit: number) => {
        // close the gap between the halves only as far as needed
        const over = (BOARD_W + 0.2) - avail / unit;
        return { unit, squeeze: Math.max(0, Math.min(MAX_SQUEEZE, over)) };
    };
    if (size === "normal") return fit(60);
    if (size === "medium") return fit(48);
    if (size === "small") return fit(36);
    const wide = Math.floor(avail / (BOARD_W + 0.2));
    if (wide >= 56) return { unit: Math.min(64, wide), squeeze: 0 };
    const tight = Math.floor(avail / (BOARD_W - MAX_SQUEEZE + 0.2));
    return fit(Math.max(18, Math.min(56, tight)));
}

function isLayerEmpty(l: number) {
    return state.kb!.keymap[l].every((c) => c === 0 || c === 1);
}

const MOD_KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

function topBar(): HTMLElement {
    const fileInput = h("input", { type: "file", accept: ".vil,.json,application/json", class: "hidden" });
    fileInput.addEventListener("change", () => {
        const f = fileInput.files?.[0];
        if (f) openFile(f);
        fileInput.value = "";
    });
    const live = state.connected;
    const sourceText = live ? `${transport.productName || "TOTEM"} · live` : state.source === "demo" ? "Demo layout · offline" : state.source === "file" ? `${state.fileName} · offline` : "";
    return h(
        "div",
        { class: "topbar" },
        live
            ? h("button", { class: "pill ghost", onClick: () => disconnect(), title: "Disconnect the keyboard" }, icon(ICONS.plug, 16), "Disconnect")
            : h("button", { class: "pill", onClick: () => connect(), disabled: !HidTransport.supported(), title: HidTransport.supported() ? "Connect your TOTEM" : "WebHID needs Chrome, Edge or Opera" }, icon(ICONS.plug, 16), "Connect"),
        h("span", { class: "vsep" }),
        h("button", { class: "icon-btn", title: live ? "Open a .vil layout and write it to the keyboard" : "Open a .vil layout", onClick: () => fileInput.click() }, icon(ICONS.upload, 20)),
        h("button", { class: "icon-btn", title: "Save the layout as a .vil file (works with the Vial app)", onClick: () => saveFile() }, icon(ICONS.download, 20)),
        h("span", { class: "vsep" }),
        h("button", { class: "icon-btn", "aria-label": "Undo", title: undoLabel() ? `Undo: ${undoLabel()}  (${MOD_KEY}Z)` : "Nothing to undo", disabled: !undoLabel(), onClick: () => undo() }, icon(ICONS.undo, 20)),
        h("button", { class: "icon-btn", "aria-label": "Redo", title: redoLabel() ? `Redo: ${redoLabel()}  (${MOD_KEY}Shift+Z)` : "Nothing to redo", disabled: !redoLabel(), onClick: () => redo() }, icon(ICONS.redo, 20)),
        !live ? h("button", { class: "icon-btn", title: "Close this layout", onClick: () => closeLayout() }, icon(ICONS.close, 20)) : null,
        fileInput,
        h("div", { class: "status" }, h("span", { class: ["dot", live && "live"] }), sourceText),
    );
}

function renderMain() {
    const kb = state.kb;
    root.classList.toggle("has-kb", !!kb);
    if (!kb) {
        navEl.classList.add("hidden");
        panelEl.classList.add("hidden");
        mount(mainEl, welcome());
        return;
    }
    navEl.classList.remove("hidden");
    const layer = Math.min(state.layer, kb.layers - 1);
    const lc = layerColor(layer);
    const t = state.target;
    const transmit = !!t && t.kind !== "key";
    const tester = state.panel === "tester" && state.tester.running;
    const lock = tester ? null : state.lock;
    const swap = tester ? null : state.swapFrom;
    const sel = new Set(t && t.kind === "key" && t.layer === layer && !lock ? selectedKeys() : []);
    const flash = state.flash?.layer === layer ? state.flash.keys : [];
    const { unit, squeeze } = sizing();
    const board = renderBoard({
        unit,
        squeeze,
        codeAt: (r, c) => keyAt(layer, r, c),
        color: () => (transmit ? { hex: "#3e3e3e", fg: "#fff" } : lc),
        selected: (r, c) => sel.has(r * TOTEM_COLS + c),
        classFor: (r, c) => {
            const i = r * TOTEM_COLS + c;
            if (tester) return [state.tester.pressed[i] && "pressed", state.tester.seen[i] && "seen"].filter(Boolean) as string[];
            return [flash.includes(i) && "flash", swap?.layer === layer && swap.pos === i && "swap-src", ...gestureClasses(layer, i)].filter(Boolean) as string[];
        },
        transmit,
        onClick: (r, c, ev) => {
            if (tester) return;
            if (lock) {
                // Alt-click takes that key's keycode as the locked key
                if (ev.altKey) setLockCode(keyAt(layer, r, c));
                else lockApply(layer, r, c);
                return;
            }
            if (swap) {
                finishSwap(layer, r, c);
                return;
            }
            if (transmit) {
                assign(keyAt(layer, r, c), "board");
                return;
            }
            if (ev.ctrlKey || ev.metaKey || ev.shiftKey || state.multiSelect) toggleKey(layer, r, c);
            else if (sel.size === 1 && sel.has(r * TOTEM_COLS + c)) selectTarget(null);
            else selectTarget({ kind: "key", layer, row: r, col: c });
            if (state.target && !state.panel) openPanel("keys");
        },
        onHover: (code) => {
            state.hoverCode = code;
            renderInfo();
        },
    });
    const layerTabs = h(
        "div",
        { class: "layerbar" },
        h("span", { class: "lbl", title: "Layers" }, icon(ICONS.layers, 20)),
        Array.from({ length: kb.layers }, (_, l) =>
            h(
                "button",
                {
                    class: ["layer-tab", l === layer && "on", l !== layer && isLayerEmpty(l) && "empty", nameOf("layer", l) && "named"],
                    title: `Layer ${l}${nameOf("layer", l) ? ` “${nameOf("layer", l)}”` : ""}${isLayerEmpty(l) ? " (empty)" : ""} — double-click to rename`,
                    dataset: { layer: String(l) },
                    onClick: () => {
                        state.layer = l;
                        if (state.target?.kind === "key") state.target = { ...state.target, layer: l };
                        invalidate("board", "panel");
                    },
                },
                nameOf("layer", l) ?? String(l),
                h("span", { class: "swatch", style: { background: layerColor(l).hex } }),
            ),
        ),
    );
    const orType = state.prefs.typingAssigns ? " or type it" : "";
    let hint = "";
    if (tester) hint = "Key tester running — press keys on your TOTEM.";
    else if (lock)
        hint =
            lock.code === null
                ? `Pick the key to lock${orType}, or click a key on the TOTEM to copy it.`
                : `Click keys to put ${serialize(lock.code)} on them. Alt-click a key to lock its keycode. Esc stops.`;
    else if (swap) hint = `Click the key to swap with${kb.layers > 1 ? " (any layer)" : ""}. Esc cancels.`;
    else if (transmit) hint = "Click a key on the TOTEM to copy its keycode into the selected slot.";
    else if (!t) hint = state.multiSelect ? "Click keys to select them." : `Click a key to change it. ${MOD_KEY === "⌘" ? "⌘" : "Ctrl"}-click or drag a box to select more.`;
    else if (t.kind === "key" && sel.size > 1) hint = `${sel.size} keys selected — pick a key${orType} to set them all.`;
    else if (t.kind === "key") hint = `Selected ${serialize(keyAt(layer, t.row, t.col))} — pick a new key${orType}. Drag it onto another key to swap.`;
    const title = layerTitle(layer, lc.hex);
    // the tools sit at the end of the title row; replace them in place (the row may be the open name field)
    const tools = editTools(kb.layers);
    const oldTools = title.querySelector(":scope > .edit-tools");
    if (oldTools) oldTools.replaceWith(tools);
    else title.appendChild(tools);
    // Replace children one by one, so an open layer-name field (kept by layerTitle) never
    // leaves the page: moving it would drop its focus and what you've typed.
    patchChildren(
        mainEl,
        topBar(),
        layerTabs,
        title,
        h("div", { class: ["stage", lock && "mode-lock", swap && "mode-swap"] }, board),
        h(
            "div",
            { class: "footer" },
            infoEl,
            h("div", { class: "hint" }, hint),
            h(
                "div",
                { class: "seg", title: "Key size" },
                (["normal", "medium", "small", "auto"] as const).map((s) =>
                    h("button", { class: state.prefs.keySize === s && "on", onClick: () => savePrefs({ keySize: s }) }, s),
                ),
            ),
        ),
    );
    renderInfo();
}

// ---------------------------------------------------------------- multi-select, swap, lock key

function editTools(layers: number): HTMLElement {
    const box = (cls: string, ...kids: (Node | string | null)[]) => h("div", { class: ["edit-tools", cls] }, ...kids);
    if (state.panel === "tester" && state.tester.running) return box("");
    const lock = state.lock;
    if (lock)
        return box(
            "mode",
            icon(ICONS.stamp, 16),
            h("span", { class: "mode-name" }, "Locked"),
            lock.code === null
                ? h("span", { class: "muted small" }, "pick a key")
                : slotKey(lock.code, { small: true, title: `Locked: ${serialize(lock.code)}. Clicks on the TOTEM put it on keys.` }),
            h("button", { class: "pill sm", "aria-label": "Stop locking", title: "Stop (Esc)", onClick: () => stopModes() }, "Stop"),
        );
    const swap = state.swapFrom;
    if (swap) {
        const code = keyAt(swap.layer, Math.floor(swap.pos / TOTEM_COLS), swap.pos % TOTEM_COLS);
        return box(
            "mode",
            icon(ICONS.swap, 16),
            h("span", { class: "mode-name" }, "Swap"),
            slotKey(code, { small: true, title: `${serialize(code)} on layer ${swap.layer}` }),
            h("span", { class: "muted small" }, layers > 1 ? "with… (any layer)" : "with…"),
            h("button", { class: "pill sm ghost", title: "Cancel (Esc)", onClick: () => stopModes() }, "Cancel"),
        );
    }
    const t = state.target;
    const keys = selectedKeys();
    const swapTitle =
        keys.length === 2
            ? "Swap the two selected keys"
            : keys.length === 1
              ? "Swap this key with another: click Swap, then the other key (on any layer). You can also drag a key onto another."
              : "Select one or two keys to swap (or drag a key onto another)";
    return box(
        "",
        keys.length > 1
            ? h(
                  "span",
                  { class: "sel-count" },
                  `${keys.length} selected`,
                  h("button", { class: "icon-btn", "aria-label": "Clear the selection", title: "Clear the selection (Esc)", onClick: () => selectTarget(null) }, icon(ICONS.close, 14)),
              )
            : null,
        h(
            "button",
            {
                class: ["tool", state.multiSelect && "on"],
                "aria-pressed": String(state.multiSelect),
                title: `Select multiple: clicks add keys to the selection or take them out. (Without this: ${MOD_KEY === "⌘" ? "⌘" : "Ctrl"}- or Shift-click, or drag a box around keys.)`,
                onClick: () => setMultiSelect(!state.multiSelect),
            },
            icon(ICONS.multi, 16),
            h("span", null, "Select multiple"),
        ),
        h("button", { class: "tool", disabled: !(keys.length === 1 || keys.length === 2), title: swapTitle, onClick: () => startSwap() }, icon(ICONS.swap, 16), h("span", null, "Swap")),
        h(
            "button",
            {
                class: "tool",
                title: "Lock key: choose a key once, then click keys on the TOTEM to put it on each of them, until you press Esc or Stop.",
                onClick: () => {
                    startLock(t?.kind === "key" ? targetCode(t) : null);
                    if (!state.panel) openPanel("keys");
                },
            },
            icon(ICONS.stamp, 16),
            h("span", null, "Lock key"),
        ),
    );
}

function patchChildren(parent: Element, ...next: HTMLElement[]) {
    const old = [...parent.children];
    if (old.length !== next.length) return mount(parent, ...next);
    next.forEach((n, i) => {
        if (old[i] !== n) old[i].replaceWith(n);
    });
}

// ---------------------------------------------------------------- layer names

let renamingLayer: number | null = null;
let renameNode: HTMLElement | null = null; // the open name field, reused by re-renders

function layerTitle(layer: number, color: string): HTMLElement {
    const ring = h("span", { class: "layer-ring", style: { color, borderColor: color } });
    const name = nameOf("layer", layer);
    const empty = isLayerEmpty(layer) ? h("span", { class: "small muted" }, "(empty)") : null;
    if (renamingLayer === layer && renameNode?.isConnected && renameNode.dataset.layer === String(layer)) return renameNode;
    if (renamingLayer === layer) {
        const inp = h("input", { type: "text", class: "layer-name-input", value: name ?? "", placeholder: `Layer ${layer}`, maxlength: 24, "aria-label": `Name of layer ${layer}` });
        let done = false;
        const finish = (save: boolean) => {
            if (done) return;
            done = true;
            renamingLayer = null;
            renameNode = null;
            if (save) rename("layer", layer, inp.value);
            invalidate("board", "panel");
        };
        inp.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Enter") finish(true);
            if (e.key === "Escape") finish(false);
        });
        inp.addEventListener("blur", () => finish(true));
        queueMicrotask(() => {
            inp.focus();
            inp.select();
        });
        renameNode = h("div", { class: "layer-title", dataset: { layer: String(layer) } }, ring, inp, h("span", { class: "small muted" }, `Layer ${layer} · Enter to save, empty to reset`));
        return renameNode;
    }
    return h(
        "div",
        { class: "layer-title" },
        ring,
        h(
            "button",
            {
                class: "layer-name",
                title: "Rename this layer",
                onClick: (e: Event) => {
                    e.stopPropagation();
                    renamingLayer = layer;
                    // Swap in the name field right away (not on the next frame), so no keystroke is lost.
                    (e.currentTarget as HTMLElement).closest(".layer-title")?.replaceWith(layerTitle(layer, color));
                },
            },
            name ?? `Layer ${layer}`,
            icon(ICONS.edit, 14, "pen"),
        ),
        name ? h("span", { class: "small muted" }, `Layer ${layer}`) : null,
        empty,
    );
}

const infoEl = h("div", { class: "infobox" });
function renderInfo() {
    const code = state.hoverCode ?? targetCode(state.target) ?? state.lock?.code;
    if (code === null || code === undefined) {
        infoEl.classList.add("hidden");
        return;
    }
    infoEl.classList.remove("hidden");
    const f = describe(code);
    mount(infoEl, h("div", null, h("b", { class: "mono" }, serialize(code)), h("span", { class: "muted mono" }, `  0x${code.toString(16).padStart(4, "0")}`)), f.title !== serialize(code) ? h("div", { class: "muted" }, f.title.replace(/^[^:]+: /, "")) : null);
}

function welcome(): HTMLElement {
    const supported = HidTransport.supported();
    const fileInput = h("input", { type: "file", accept: ".vil,.json,application/json", class: "hidden" });
    fileInput.addEventListener("change", () => {
        const f = fileInput.files?.[0];
        if (f) openFile(f);
    });
    const preview = renderBoard({ unit: 30, codeAt: () => 0, color: (r) => ({ hex: r < 4 ? "#099e7c" : "#379cd7", fg: "#fff" }) });
    preview.classList.add("welcome-board");
    preview.style.pointerEvents = "none";
    return h(
        "div",
        { class: "welcome" },
        h(
            "div",
            { class: "welcome-card" },
            logo(),
            preview,
            h("p", null, "Remap your GEIST TOTEM: keys, layers, home row mods, tap dances, macros, combos and overrides. Changes are saved to the keyboard instantly."),
            h(
                "div",
                { class: "welcome-actions" },
                h("button", { class: "pill", onClick: () => connect(), disabled: !supported }, icon(ICONS.plug, 16), "Connect TOTEM"),
                h("button", { class: "pill ghost", onClick: () => fileInput.click() }, icon(ICONS.upload, 16), "Open a .vil layout"),
                h("button", { class: "pill ghost", onClick: () => loadDemo() }, "Explore the demo layout"),
            ),
            fileInput,
            supported
                ? h("p", { class: "small" }, "Needs a current Vial firmware on the TOTEM (see firmware/ in the download, or a vial-qmk build).")
                : h("div", { class: "notice warn", style: "margin-top:12px" }, "This browser can't talk to keyboards (no WebHID). Use Chrome, Edge, Opera or Brave on desktop — you can still open and edit .vil files here."),
        ),
    );
}

// ---------------------------------------------------------------- overlays

function renderOverlay() {
    const b = state.busy;
    if (!b) {
        overlayEl.replaceChildren();
        return;
    }
    mount(
        overlayEl,
        h("div", { class: "overlay" }, h("div", { class: "modal" }, h("h2", null, b.text), h("div", { class: "bar" }, h("div", { style: { width: `${Math.round(b.progress * 100)}%` } })))),
    );
}

/** Show a toast; one with an `id` replaces the previous toast with the same id. */
function toast(msg: string, kind: "info" | "error" | "ok" = "info", id?: string) {
    if (id) toastsEl.querySelector(`[data-id="${id}"]`)?.remove();
    const el = h("div", { class: ["toast", kind], role: "status", dataset: id ? { id } : undefined }, msg);
    toastsEl.appendChild(el);
    setTimeout(() => el.remove(), kind === "error" ? 7000 : id ? 2500 : 3500);
}

function confirmDialog(title: string, body: string, ok = "OK"): Promise<boolean> {
    return new Promise((resolve) => {
        const close = (v: boolean) => {
            wrap.remove();
            resolve(v);
        };
        const wrap = h(
            "div",
            { class: "overlay", onClick: (e: Event) => e.target === wrap && close(false) },
            h(
                "div",
                { class: "modal", role: "dialog" },
                h("h2", null, title),
                h("p", null, body),
                h("div", { class: "actions" }, h("button", { class: "pill ghost", onClick: () => close(false) }, "Cancel"), h("button", { class: "pill", onClick: () => close(true), dataset: { ok: "1" } }, ok)),
            ),
        );
        document.body.appendChild(wrap);
    });
}

/** Vial unlock: hold the highlighted keys until the bar fills. */
function unlockDialog(keys: [number, number][]): Promise<boolean> {
    return new Promise((resolve) => {
        const hold = new Set(keys.map(([r, c]) => r * TOTEM_COLS + c));
        const board = renderBoard({
            unit: 30,
            codeAt: (r, c) => keyAt(0, r, c),
            color: (r, c) => (hold.has(r * TOTEM_COLS + c) ? { hex: "#d8304a", fg: "#fff" } : { hex: "#85929b", fg: "#fff" }),
            classFor: (r, c) => (hold.has(r * TOTEM_COLS + c) ? ["unlock"] : []),
        });
        board.style.pointerEvents = "none";
        const bar = h("div", { style: "width:0%" });
        const status = h("p", { class: "small" }, "Waiting for the keys…");
        let done = false;
        const finish = (v: boolean) => {
            if (done) return;
            done = true;
            wrap.remove();
            resolve(v);
        };
        const wrap = h(
            "div",
            { class: "overlay" },
            h(
                "div",
                { class: "modal wide" },
                h("h2", null, "Unlock your TOTEM"),
                h("p", null, "Vial protects macros, QK_BOOT and the key tester. Press and hold the two highlighted keys on the keyboard until the bar fills up (a few seconds)."),
                h("div", { style: "display:flex;justify-content:center;margin:12px 0" }, board),
                h("div", { class: "bar" }, bar),
                status,
                h("p", { class: "small muted" }, "To cancel, unplug the keyboard. It locks again when you replug it."),
            ),
        );
        document.body.appendChild(wrap);
        let max = 1;
        (async () => {
            try {
                await vial.unlockStart();
                while (!done && transport.device) {
                    const p = await vial.unlockPoll();
                    if (p.unlocked) {
                        bar.style.width = "100%";
                        toast("Keyboard unlocked", "ok");
                        finish(true);
                        return;
                    }
                    max = Math.max(max, p.counter);
                    const frac = max ? (max - p.counter) / max : 0;
                    bar.style.width = `${Math.round(frac * 100)}%`;
                    status.textContent = frac > 0 ? "Keep holding…" : "Waiting for the keys…";
                    await new Promise((r) => setTimeout(r, 150));
                }
                finish(false);
            } catch (e) {
                toast((e as Error).message, "error");
                finish(false);
            }
        })();
    });
}

// ---------------------------------------------------------------- keyboard input

let pendingModifier: number | null = null;
function onKeyDown(ev: KeyboardEvent) {
    const el = ev.target as HTMLElement;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
    if (document.querySelector(".overlay")) return;
    if (ev.key === "Escape") {
        // a drag, then Lock key / swap mode, then the selection, then "Select multiple"
        if (cancelGesture() || escape()) ev.preventDefault();
        pendingModifier = null;
        return;
    }
    // Undo / redo (Ctrl or ⌘ + Z, Shift+Z or Y). These win over "typing assigns keys".
    const k = ev.key.toLowerCase();
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && (k === "z" || k === "y") && state.kb) {
        ev.preventDefault();
        pendingModifier = null;
        if (k === "y" || ev.shiftKey) redo();
        else undo();
        return;
    }
    if (!state.kb || !(state.target || state.lock) || !state.prefs.typingAssigns || (state.panel === "tester" && state.tester.running)) return;
    if (ev.repeat) {
        ev.preventDefault();
        return;
    }
    const code = keycodeFromEvent(ev);
    if (code === null) return;
    ev.preventDefault();
    if (MODIFIER_KEYCODES.has(code)) {
        pendingModifier = code; // assigned on release unless another key comes first
        return;
    }
    pendingModifier = null;
    let mods = 0;
    if (ev.getModifierState?.("AltGraph")) {
        // AltGr (Windows reports it as Ctrl+Alt): RALT, plus Shift if held — e.g. AltGr+Q = @ on German.
        mods = 0x14 | (ev.shiftKey ? 0x02 : 0);
    } else {
        if (ev.ctrlKey) mods |= 1;
        if (ev.shiftKey) mods |= 2;
        if (ev.altKey) mods |= 4;
        if (ev.metaKey) mods |= 8;
    }
    assign(mods && code <= 0xff ? (mods << 8) | code : code, "typing");
}
function onKeyUp(ev: KeyboardEvent) {
    if (pendingModifier === null) return;
    const code = keycodeFromEvent(ev);
    if (code === pendingModifier) assign(code, "typing");
    pendingModifier = null;
}

// ---------------------------------------------------------------- init

export function initShell(container: HTMLElement) {
    root = h("div", { class: "app" }, navEl, panelEl, mainEl);
    mount(container, root, overlayEl, toastsEl);
    ui.toast = toast;
    ui.confirm = confirmDialog;
    ui.unlock = unlockDialog;
    onRender("nav", renderNav);
    onRender("panel", renderPanel);
    onRender("board", renderMain);
    onRender("top", renderMain);
    onRender("overlay", renderOverlay);
    window.addEventListener("beforeunload", (e) => {
        if (state.offlineDirty || state.macrosDirty) e.preventDefault();
    });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    // Holding Ctrl/Shift/Alt to click or drag must not put that modifier on the keys when it's released.
    window.addEventListener("pointerdown", () => (pendingModifier = null), true);
    attachGestures(mainEl);
    let resizeTimer = 0;
    window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => state.prefs.keySize === "auto" && invalidate("board"), 100);
    });
    // Double-click a layer tab to rename it (delegated: tabs are re-rendered on click).
    mainEl.addEventListener("dblclick", (ev) => {
        const tab = (ev.target as HTMLElement).closest<HTMLElement>(".layer-tab");
        if (!tab || !state.kb) return;
        state.layer = Number(tab.dataset.layer);
        renamingLayer = state.layer;
        renderMain(); // now, so the name field is there before the next keystroke
        invalidate("panel");
    });
    // Clicking empty space around the TOTEM clears the selection.
    mainEl.addEventListener("click", (ev) => {
        const t = ev.target as HTMLElement;
        if (!(t === mainEl || t.classList.contains("stage") || t.classList.contains("board"))) return;
        if (state.swapFrom) stopModes();
        else if (state.target?.kind === "key") selectTarget(null);
    });
    invalidate("all");
    // The computer's keyboard layout, for key labels; check again when coming back to the page.
    redetectLayout();
    window.addEventListener("focus", () => redetectLayout());
    // Reconnect silently to a TOTEM this page was allowed to use before.
    if (HidTransport.supported()) connect(true).catch(() => {});
}

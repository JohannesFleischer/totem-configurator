// Tap dance, combo, key override and macro lists + editors.
import { activeLayout, textAsTyped, textToKeycodes } from "../hostlayout";
import { describe } from "../keycodes";
import { encodeMacro, isComboUsed, isOverrideUsed, isTapDanceUsed, KO_OPTIONS, MAX_NAME, type MacroAction, type NameKind } from "../model";
import {
    assign,
    invalidate,
    nameOf,
    rename,
    commitMacroEdit,
    macroTyping,
    overrideView,
    revertMacros,
    sameTarget,
    selectTarget,
    setMacro,
    state,
    stopModes,
    updateCombo,
    updateOverride,
    updateTapDance,
    writeMacros,
    type TdSlot,
} from "../store";
import { pickKey, slotKey } from "./board";
import { h, icon, ICONS } from "./dom";
import { embeddedPicker } from "./picker";

const QK_TD = 0x5700;
const QK_MACRO = 0x7700;

function short(code: number): string {
    const f = describe(code);
    return (f.header ? `${f.header} ` : "") + (f.main.replace(/\n/g, " ") || (code === 0 ? "—" : ""));
}

function openEditor(kind: "tapdance" | "macros" | "combos" | "overrides", idx: number) {
    stopModes(); // board clicks fill the editor's slots now
    state.editing = { kind, idx };
    state.selection = [];
    state.target =
        kind === "tapdance"
            ? { kind: "td", idx, slot: "onTap" }
            : kind === "combos"
              ? { kind: "combo", idx, slot: 0 }
              : kind === "overrides"
                ? { kind: "ko", idx, slot: "trigger" }
                : null;
    invalidate("panel", "board");
}

/** "Name" field at the top of an editor. Names are kept in the .vil file and in this browser. */
function nameField(kind: NameKind, i: number, placeholder: string): HTMLElement {
    const inp = h("input", { type: "text", value: nameOf(kind, i) ?? "", placeholder, maxlength: MAX_NAME, class: "grow", "aria-label": "Name" });
    inp.addEventListener("input", () => rename(kind, i, inp.value, true));
    inp.addEventListener("change", () => rename(kind, i, inp.value));
    inp.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter" || e.key === "Escape") inp.blur();
    });
    return h("div", { class: "row name-row" }, h("label", { class: "muted" }, "Name"), inp);
}

/** List summary with the item's name (if any) first. */
function summary(kind: NameKind, i: number, text: string): HTMLElement {
    const n = nameOf(kind, i);
    return h("span", { class: "sum" }, n ? h("b", { class: "nm" }, n) : null, n ? "  " : null, text);
}

export function closeEditor() {
    state.editing = null;
    if (state.target && state.target.kind !== "key") state.target = null;
    invalidate("panel", "board");
}

function editBtn(onClick: () => void) {
    return h("button", { class: "icon-btn", title: "Edit", onClick: (e: Event) => (e.stopPropagation(), onClick()) }, icon(ICONS.edit, 16));
}

function transmitHelp(what: string) {
    return h(
        "div",
        { class: "help" },
        `Click a slot, then pick its ${what} below, click a key on the TOTEM to copy it, or just type it on your computer keyboard.`,
    );
}

// ---------------------------------------------------------------- tap dance

export function tapDanceList(): HTMLElement {
    const kb = state.kb!;
    if (!kb.tapDances.length) return h("div", { class: "notice" }, "This firmware has no tap dance slots.");
    return h(
        "div",
        null,
        h("p", { class: "small muted" }, "Click a TD key to put it on the selected TOTEM key; use the pencil to edit what it does."),
        h(
            "div",
            { class: "list" },
            kb.tapDances.map((t, i) =>
                h(
                    "div",
                    { class: ["item", !isTapDanceUsed(t) && "unused"], onClick: () => openEditor("tapdance", i) },
                    pickKey(QK_TD + i, { onClick: () => assign(QK_TD + i, "picker"), title: `Assign TD(${i}) to the selected key` }),
                    h("div", { class: "mini" }, [t.onTap, t.onHold, t.onTapHold, t.onDoubleTap].map((c) => slotKey(c, { small: true, onClick: () => openEditor("tapdance", i) }))),
                    summary("tapdances", i, isTapDanceUsed(t) ? `${t.term} ms` : "empty"),
                    editBtn(() => openEditor("tapdance", i)),
                ),
            ),
        ),
    );
}

export function tapDanceEditor(i: number): HTMLElement {
    const kb = state.kb!;
    const t = kb.tapDances[i];
    const slots: [TdSlot, string][] = [
        ["onTap", "Tap"],
        ["onHold", "Hold"],
        ["onTapHold", "Tap-Hold"],
        ["onDoubleTap", "Double-Tap"],
    ];
    const term = h("input", { type: "number", min: 0, max: 10000, value: t.term, style: "width:110px" });
    term.addEventListener("change", () => {
        const ms = Math.max(0, Math.min(10000, Number(term.value) || 0));
        updateTapDance(i, { ...kb.tapDances[i], term: ms }, `tapping term ${ms} ms`);
    });
    term.addEventListener("keydown", (e) => e.stopPropagation());
    return h(
        "div",
        { class: "editor" },
        nameField("tapdances", i, `Tap Dance ${i}`),
        h(
            "div",
            { class: "row" },
            pickKey(QK_TD + i, { onClick: () => assign(QK_TD + i, "picker"), title: "Assign to the selected key" }),
            h("span", { class: "small muted" }, `Put `, h("b", { class: "mono" }, `TD(${i})`), ` on a key to use it.`),
        ),
        slots.map(([slot, label]) =>
            h(
                "div",
                { class: "slot-row" },
                slotKey(t[slot], { on: sameTarget(state.target, { kind: "td", idx: i, slot }), onClick: () => selectTarget({ kind: "td", idx: i, slot }) }),
                h("label", null, label),
                t[slot] ? h("button", { class: "icon-btn", title: "Clear", onClick: () => updateTapDance(i, { ...kb.tapDances[i], [slot]: 0 }, `clear ${label.toLowerCase()}`) }, icon(ICONS.close, 14)) : null,
            ),
        ),
        h("div", { class: "row" }, h("label", { class: "muted" }, "Tapping term"), term, h("span", { class: "muted small" }, "ms")),
        transmitHelp("action"),
        embeddedPicker(),
    );
}

// ---------------------------------------------------------------- combos

export function comboList(): HTMLElement {
    const kb = state.kb!;
    if (!kb.combos.length) return h("div", { class: "notice" }, "This firmware has no combo slots.");
    return h(
        "div",
        null,
        h("p", { class: "small muted" }, "Press the input keys together to send the output. Inputs are keycodes, so they work on every layer where those keycodes are."),
        h(
            "div",
            { class: "list" },
            kb.combos.map((c, i) =>
                h(
                    "div",
                    { class: ["item", !isComboUsed(c) && "unused"], onClick: () => openEditor("combos", i) },
                    h("span", { class: "num" }, String(i)),
                    h("div", { class: "mini" }, c.keys.filter((k, j) => k || j < 2).map((k) => slotKey(k, { small: true })), h("span", { class: "muted" }, "→"), slotKey(c.output, { small: true })),
                    summary("combos", i, isComboUsed(c) ? c.keys.filter(Boolean).map(short).join(" + ") + " → " + short(c.output) : "empty"),
                    editBtn(() => openEditor("combos", i)),
                ),
            ),
        ),
    );
}

export function comboEditor(i: number): HTMLElement {
    const kb = state.kb!;
    const c = kb.combos[i];
    const slot = (s: number, label: string) =>
        h(
            "div",
            { class: "slot-row" },
            slotKey(s === 4 ? c.output : c.keys[s], { on: sameTarget(state.target, { kind: "combo", idx: i, slot: s }), onClick: () => selectTarget({ kind: "combo", idx: i, slot: s }) }),
            h("label", null, label),
            (s === 4 ? c.output : c.keys[s])
                ? h(
                      "button",
                      {
                          class: "icon-btn",
                          title: "Clear",
                          onClick: () => {
                              const n = { keys: [...c.keys] as typeof c.keys, output: c.output };
                              if (s === 4) n.output = 0;
                              else n.keys[s] = 0;
                              updateCombo(i, n, `clear ${label.toLowerCase()}`);
                          },
                      },
                      icon(ICONS.close, 14),
                  )
                : null,
        );
    return h(
        "div",
        { class: "editor" },
        nameField("combos", i, `Combo ${i}`),
        slot(0, "Key 1"),
        slot(1, "Key 2"),
        slot(2, "Key 3 (optional)"),
        slot(3, "Key 4 (optional)"),
        slot(4, "Output"),
        h("div", { class: "help" }, "Tip: with Key 1 selected, click keys on the TOTEM one after another — each click fills the next input. Then pick the output below."),
        embeddedPicker(),
    );
}

// ---------------------------------------------------------------- key overrides

const MOD8: [number, string][] = [
    [0x01, "LCtl"],
    [0x02, "LSft"],
    [0x04, "LAlt"],
    [0x08, "LGui"],
    [0x10, "RCtl"],
    [0x20, "RSft"],
    [0x40, "RAlt"],
    [0x80, "RGui"],
];

function mods8Text(m: number) {
    return MOD8.filter(([b]) => m & b)
        .map(([, n]) => n)
        .join("+");
}

export function overrideList(): HTMLElement {
    const kb = state.kb!;
    if (!kb.overrides.length) return h("div", { class: "notice" }, "This firmware has no key override slots.");
    return h(
        "div",
        null,
        h("p", { class: "small muted" }, "Replace a key + modifiers with something else, e.g. Shift + Backspace → Delete."),
        h(
            "div",
            { class: "list" },
            kb.overrides.map((o, i) =>
                h(
                    "div",
                    { class: ["item", (!isOverrideUsed(o) || !(o.options & 0x80)) && "unused"], onClick: () => openEditor("overrides", i) },
                    h("span", { class: "num" }, String(i)),
                    h("div", { class: "mini" }, slotKey(o.trigger, { small: true }), h("span", { class: "muted" }, "→"), slotKey(o.replacement, { small: true })),
                    summary("overrides", i, isOverrideUsed(o) ? `${o.triggerMods ? mods8Text(o.triggerMods) + " + " : ""}${short(o.trigger)} → ${short(o.replacement)}${o.options & 0x80 ? "" : " (off)"}` : "empty"),
                    editBtn(() => openEditor("overrides", i)),
                ),
            ),
        ),
    );
}

export function overrideEditor(i: number): HTMLElement {
    const kb = state.kb!;
    // A brand-new slot starts from Vial's defaults (only written once you change something).
    const o = overrideView(i);
    const set = (patch: Partial<typeof o>, what: string) => updateOverride(i, { ...o, ...patch }, what);
    const mods = (value: number, onChange: (v: number) => void) =>
        h(
            "div",
            { class: "mods8" },
            MOD8.map(([bit, label]) => h("button", { class: ["chip", "sm", value & bit && "on"], onClick: () => onChange(value ^ bit) }, label)),
        );
    const slot = (s: "trigger" | "replacement", label: string) =>
        h("div", { class: "slot-row" }, slotKey(o[s], { on: sameTarget(state.target, { kind: "ko", idx: i, slot: s }), onClick: () => selectTarget({ kind: "ko", idx: i, slot: s }) }), h("label", null, label));
    return h(
        "div",
        { class: "editor" },
        nameField("overrides", i, `Override ${i}`),
        h("label", { class: "check" }, h("input", { type: "checkbox", checked: !!(o.options & 0x80), onChange: (e: Event) => set({ options: (o.options & ~0x80) | ((e.target as HTMLInputElement).checked ? 0x80 : 0) }, (e.target as HTMLInputElement).checked ? "enable" : "disable") }), h("b", null, "Enabled")),
        slot("trigger", "Trigger key"),
        h("div", null, h("div", { class: "small muted", style: "margin-bottom:4px" }, "Trigger modifiers (must be held)"), mods(o.triggerMods, (v) => set({ triggerMods: v }, "trigger modifiers"))),
        slot("replacement", "Replacement"),
        h("div", null, h("div", { class: "small muted", style: "margin-bottom:4px" }, "Negative modifiers (must NOT be held)"), mods(o.negativeMods, (v) => set({ negativeMods: v }, "negative modifiers"))),
        h("div", null, h("div", { class: "small muted", style: "margin-bottom:4px" }, "Suppressed modifiers (released while active)"), mods(o.suppressedMods, (v) => set({ suppressedMods: v }, "suppressed modifiers"))),
        h(
            "div",
            null,
            h("div", { class: "small muted", style: "margin-bottom:4px" }, "Active on layers"),
            h(
                "div",
                { class: "layers16" },
                Array.from({ length: Math.min(16, kb.layers) }, (_, l) => h("button", { class: ["chip", "sm", o.layers & (1 << l) && "on"], onClick: () => set({ layers: o.layers ^ (1 << l) }, "layers") }, String(l))),
            ),
        ),
        h(
            "details",
            null,
            h("summary", { class: "small muted", style: "cursor:pointer" }, "Options"),
            h(
                "div",
                { class: "checks", style: "margin-top:8px" },
                KO_OPTIONS.filter(([bit]) => bit !== 0x80).map(([bit, label]) =>
                    h("label", null, h("input", { type: "checkbox", checked: !!(o.options & bit), onChange: (e: Event) => set({ options: (o.options & ~bit) | ((e.target as HTMLInputElement).checked ? bit : 0) }, "options") }), label),
                ),
            ),
        ),
        transmitHelp("key"),
        embeddedPicker(),
    );
}

// ---------------------------------------------------------------- macros

function macroSummary(m: MacroAction[]): string {
    return m
        .map((a) => (a.type === "text" ? `“${a.text}”` : a.type === "delay" ? `${a.ms}ms` : `${a.type}(${a.keys.map(short).join(",")})`))
        .join(" ");
}

export function macroList(): HTMLElement {
    const kb = state.kb!;
    if (!kb.macroCount) return h("div", { class: "notice" }, "This firmware has no macros.");
    const used = encodeMacro(kb.macros.flat(), kb.vialProtocol).length + kb.macroCount;
    return h(
        "div",
        null,
        h("p", { class: "small muted" }, "Click an M key to put it on the selected TOTEM key; use the pencil to edit the macro."),
        dirtyBar(),
        h(
            "div",
            { class: "list" },
            kb.macros.map((m, i) =>
                h(
                    "div",
                    { class: ["item", !m.length && "unused"], onClick: () => openEditor("macros", i) },
                    pickKey(QK_MACRO + i, { onClick: () => assign(QK_MACRO + i, "picker"), title: `Assign M${i} to the selected key` }),
                    summary("macros", i, m.length ? macroSummary(m) : "empty"),
                    editBtn(() => openEditor("macros", i)),
                ),
            ),
        ),
        h("p", { class: "small muted" }, `Macro memory: ${used} of ${kb.macroBufferSize} bytes used.`),
    );
}

function dirtyBar(): HTMLElement | null {
    if (!state.macrosDirty || !state.connected) return null;
    return h(
        "div",
        { class: "notice warn row", style: "margin:8px 0" },
        h("span", { class: "grow" }, "Macro changes are not on the keyboard yet."),
        h("button", { class: "pill ghost", onClick: () => revertMacros() }, "Revert"),
        h("button", { class: "pill", onClick: () => writeMacros() }, "Save to keyboard"),
    );
}

export function macroEditor(i: number): HTMLElement {
    const kb = state.kb!;
    const m = kb.macros[i];
    const change = (next: MacroAction[], what = "edit") => setMacro(i, next, what);
    const types: [MacroAction["type"], string][] = [
        ["text", "Text"],
        ["tap", "Tap"],
        ["down", "Down"],
        ["up", "Up"],
        ["delay", "Delay"],
    ];
    const rows = m.map((a, ai) => {
        const typeSel = h(
            "select",
            {
                onChange: (e: Event) => {
                    const t = (e.target as HTMLSelectElement).value as MacroAction["type"];
                    const next = [...m];
                    next[ai] = t === "text" ? { type: "text", text: "" } : t === "delay" ? { type: "delay", ms: 100 } : { type: t, keys: "keys" in a ? a.keys : [] };
                    change(next, `action → ${t}`);
                },
            },
            types.map(([t, l]) => h("option", { value: t, selected: a.type === t }, l)),
        );
        let body: HTMLElement;
        if (a.type === "text") {
            const inp = h("input", { type: "text", value: a.text, placeholder: "Text to type" });
            const warn = h("div", { class: "small layout-fix" });
            // The firmware types macro text as if the computer had a US layout; say what really comes out.
            const check = () => {
                warn.replaceChildren();
                const layout = activeLayout();
                const text = inp.value;
                const nonAscii = /[^\x20-\x7e\n\t]/.test(text);
                const typed = textAsTyped(text.replace(/[^\x20-\x7e\n\t]/g, ""));
                const wrong = typed !== text.replace(/[^\x20-\x7e\n\t]/g, "");
                if (!nonAscii && !wrong) return;
                const { missing } = textToKeycodes(text);
                warn.append(
                    h(
                        "span",
                        null,
                        wrong ? `On ${layout.name} this types “${typed}”. ` : "",
                        nonAscii ? "Macro text can only be plain ASCII; other characters are left out. " : "",
                    ),
                    missing.length
                        ? h("span", { class: "muted" }, `${layout.name} has no key for ${missing.map((c) => `“${c}”`).join(" ")}.`)
                        : h(
                              "button",
                              {
                                  class: "chip sm",
                                  title: `Replace the text with the key presses that type it on ${layout.name}`,
                                  onClick: () => {
                                      const next = m.map((x) => ({ ...x })) as MacroAction[];
                                      next[ai] = { type: "tap", keys: textToKeycodes(inp.value).codes };
                                      change(next, `text → key taps for ${layout.name}`);
                                  },
                              },
                              `Use key taps for ${layout.name}`,
                          ),
                );
            };
            inp.addEventListener("keydown", (e) => e.stopPropagation());
            inp.addEventListener("input", () => {
                (m[ai] as { text: string }).text = inp.value; // live; recorded on change
                macroTyping();
                check();
            });
            inp.addEventListener("change", () => commitMacroEdit(i, "text"));
            check();
            body = h("div", { class: "body", style: "flex-direction:column;align-items:stretch" }, inp, warn);
        } else if (a.type === "delay") {
            const inp = h("input", { type: "number", min: 0, max: 65000, value: a.ms, style: "width:100px" });
            inp.addEventListener("keydown", (e) => e.stopPropagation());
            inp.addEventListener("change", () => {
                (m[ai] as { ms: number }).ms = Math.max(0, Math.min(65000, Number(inp.value) || 0));
                commitMacroEdit(i, "delay");
            });
            body = h("div", { class: "body" }, inp, h("span", { class: "small muted" }, "ms"));
        } else {
            const keys = a.keys;
            body = h(
                "div",
                { class: "body" },
                keys.map((k, ki) => {
                    const t = { kind: "macro" as const, idx: i, action: ai, key: ki };
                    return slotKey(k, { small: true, on: sameTarget(state.target, t), onClick: () => selectTarget(t) });
                }),
                (() => {
                    const t = { kind: "macro" as const, idx: i, action: ai, key: keys.length };
                    return h("button", { class: ["slot", "sm", sameTarget(state.target, t) && "on"], title: "Add a key", onClick: (e: Event) => (e.stopPropagation(), selectTarget(t)) }, h("div", { class: "face" }, "+"));
                })(),
                keys.length
                    ? h(
                          "button",
                          {
                              class: "icon-btn",
                              title: "Remove the last key",
                              onClick: () => {
                                  const next = m.map((x) => ({ ...x })) as MacroAction[];
                                  next[ai] = { type: a.type, keys: keys.slice(0, -1) };
                                  change(next, "remove key");
                              },
                          },
                          icon(ICONS.close, 14),
                      )
                    : null,
            );
        }
        return h(
            "div",
            { class: "action" },
            typeSel,
            body,
            h(
                "div",
                { class: "row", style: "gap:0" },
                h("button", { class: "icon-btn", title: "Move up", disabled: ai === 0, onClick: () => change(swap(m, ai, ai - 1), "move action") }, icon(ICONS.up, 14)),
                h("button", { class: "icon-btn", title: "Delete", onClick: () => change(m.filter((_, j) => j !== ai), "delete action") }, icon(ICONS.trash, 14)),
            ),
        );
    });
    const add = async (a: MacroAction) => {
        const next = [...m, a];
        await change(next, `add ${a.type}`);
        if ("keys" in a) selectTarget({ kind: "macro", idx: i, action: next.length - 1, key: 0 });
    };
    const bytes = encodeMacro(m, kb.vialProtocol).length;
    return h(
        "div",
        { class: "editor" },
        nameField("macros", i, `Macro ${i}`),
        h("div", { class: "row" }, pickKey(QK_MACRO + i, { onClick: () => assign(QK_MACRO + i, "picker"), title: "Assign to the selected key" }), h("span", { class: "small muted" }, `Put `, h("b", { class: "mono" }, `M${i}`), ` on a key to use it. ${bytes} bytes.`)),
        dirtyBar(),
        rows.length ? rows : h("div", { class: "notice" }, "Empty macro. Add text to type, or key presses."),
        h(
            "div",
            { class: "chips" },
            h("button", { class: "chip sm", onClick: () => add({ type: "text", text: "" }) }, "+ Text"),
            h("button", { class: "chip sm", onClick: () => add({ type: "tap", keys: [] }) }, "+ Tap keys"),
            h("button", { class: "chip sm", onClick: () => add({ type: "down", keys: [] }) }, "+ Hold keys"),
            h("button", { class: "chip sm", onClick: () => add({ type: "up", keys: [] }) }, "+ Release keys"),
            h("button", { class: "chip sm", onClick: () => add({ type: "delay", ms: 100 }) }, "+ Delay"),
        ),
        state.connected ? null : h("p", { class: "small muted" }, "Offline: macros are saved in the .vil file."),
        h("div", { class: "help" }, "Tap keys: press and release each key in order. Hold/Release keys: for shortcuts like Ctrl+C use Hold Ctrl, Tap C, Release Ctrl. Saving macros needs the keyboard unlocked once (Vial security)."),
        embeddedPicker(),
    );
}

function swap<T>(arr: T[], a: number, b: number): T[] {
    const out = [...arr];
    [out[a], out[b]] = [out[b], out[a]];
    return out;
}


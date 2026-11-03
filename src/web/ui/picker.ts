// Key pickers: standard keys (with modifier / mod-tap / layer-tap wrapping), special keys,
// layer keys, macro & tap dance keys and a free-form QMK keycode field.
import { describe, parseKeycode, registry, serialize, type KeycodeDef } from "../keycodes";
import { activeLayout, LAYOUT_LIST, levelName, symbolsOf } from "../hostlayout";
import { assign, autoLayout, invalidate, mouseKeysSupported, nameOf, setHostLayout, state, wrapCode, type Wrap } from "../store";
import { layerColor } from "../totem";
import { pickKey } from "./board";
import { h } from "./dom";

const code = (name: string) => registry.byName.get(name) ?? 0;

function pick(c: number) {
    assign(wrapCode(c), "picker");
}

function key(name: string, cls = "", label?: string): HTMLButtonElement {
    const c = code(name);
    const wrapping = state.wrap !== "none";
    return pickKey(c, { cls, label, onClick: () => pick(c), disabled: wrapping && c > 0xff });
}

function keys(defs: KeycodeDef[]): HTMLElement {
    const wrapping = state.wrap !== "none";
    return h(
        "div",
        { class: "kflow" },
        defs.filter((d) => registry.isVisible(d)).map((d) => pickKey(d.code, { onClick: () => pick(d.code), disabled: wrapping && d.code > 0xff })),
    );
}

function section(title: string, ...body: (Node | null)[]) {
    return h("section", null, h("h3", null, title), ...body);
}

// ---------------------------------------------------------------- wrap bar

function wrapBar(): HTMLElement {
    const modes: [Wrap, string, string][] = [
        ["none", "Plain", "Assign the key as it is"],
        ["mod", "Mod + key", "Send the key with modifiers held, e.g. Ctrl+C"],
        ["modtap", "Mod-Tap", "Modifier when held, key when tapped (home row mods)"],
        ["layertap", "Layer-Tap", "Layer while held, key when tapped"],
    ];
    const setWrap = (w: Wrap) => {
        state.wrap = w;
        invalidate("panel");
    };
    const mods: [number, string][] = [
        [1, "Ctrl"],
        [2, "Shift"],
        [4, "Alt"],
        [8, "GUI"],
    ];
    const box = h(
        "div",
        { class: "wrapbox" },
        h("div", { class: "row" }, h("span", { class: "lbl" }, "Wrap"), h("div", { class: "chips" }, modes.map(([w, label, tip]) => h("button", { class: ["chip", "sm", state.wrap === w && "on"], title: tip, onClick: () => setWrap(w) }, label)))),
    );
    if (state.wrap === "mod" || state.wrap === "modtap") {
        box.appendChild(
            h(
                "div",
                { class: "row" },
                h("span", { class: "lbl" }, "Mods"),
                h(
                    "div",
                    { class: "chips" },
                    mods.map(([bit, label]) =>
                        h(
                            "button",
                            {
                                class: ["chip", "sm", state.wrapMods & bit && "on"],
                                onClick: () => {
                                    state.wrapMods ^= bit;
                                    invalidate("panel");
                                },
                            },
                            label,
                        ),
                    ),
                ),
                h(
                    "div",
                    { class: "seg", style: "margin-left:auto" },
                    h("button", { class: !state.wrapRight && "on", onClick: () => ((state.wrapRight = false), invalidate("panel")) }, "Left"),
                    h("button", { class: state.wrapRight && "on", onClick: () => ((state.wrapRight = true), invalidate("panel")) }, "Right"),
                ),
            ),
        );
    }
    if (state.wrap === "layertap") {
        const layers = Math.min(state.kb?.layers ?? 4, 16);
        box.appendChild(
            h(
                "div",
                { class: "row" },
                h("span", { class: "lbl" }, "Layer"),
                h(
                    "div",
                    { class: "chips" },
                    Array.from({ length: layers }, (_, l) =>
                        h("button", { class: ["chip", "sm", state.wrapLayer === l && "on"], title: nameOf("layer", l) ?? `Layer ${l}`, onClick: () => ((state.wrapLayer = l), invalidate("panel")) }, nameOf("layer", l) ? `${l} ${nameOf("layer", l)}` : String(l)),
                    ),
                ),
            ),
        );
    }
    if (state.wrap !== "none") {
        const example = wrapCode(code("KC_A"));
        const ready = state.wrap === "layertap" || state.wrapMods;
        box.appendChild(
            h("div", { class: "small muted" }, ready ? `Now pick a key below — e.g. A becomes ${serialize(example)}` : "Choose at least one modifier, then pick a key below."),
        );
    }
    return box;
}

// ---------------------------------------------------------------- tabs

export function standardKeys(): HTMLElement {
    // Rows are 15 key units wide and stretch to the panel, like a real keyboard.
    type Cell = string | [string, number] | number; // name, [name, units], or a gap in units
    const row = (...cells: Cell[]) =>
        h(
            "div",
            { class: "krow fit" },
            cells.map((c) => {
                if (typeof c === "number") return h("span", { style: { flex: `${c} 1 0` } });
                const [name, u] = typeof c === "string" ? [c, 1] : c;
                const el = key(name);
                el.style.flex = `${u} 1 0`;
                return el;
            }),
        );
    const kc = (s: string) => [...s].map((ch) => `KC_${ch}`);
    const fkeys = Array.from({ length: 12 }, (_, i) => `KC_F${i + 1}`);
    const layout = activeLayout();
    // Keys are physical positions; their labels show what the computer's layout types.
    const rows = layout.iso
        ? [
              row("KC_GRAVE", ...kc("1234567890"), "KC_MINUS", "KC_EQUAL", ["KC_BSPACE", 2]),
              row(["KC_TAB", 1.5], ...kc("QWERTYUIOP"), "KC_LBRACKET", "KC_RBRACKET", 1.5),
              row(["KC_CAPSLOCK", 1.75], ...kc("ASDFGHJKL"), "KC_SCOLON", "KC_QUOTE", "KC_NONUS_HASH", ["KC_ENTER", 1.25]),
              row(["KC_LSHIFT", 1.25], "KC_NONUS_BSLASH", ...kc("ZXCVBNM"), "KC_COMMA", "KC_DOT", "KC_SLASH", ["KC_RSHIFT", 2.75]),
          ]
        : [
              row("KC_GRAVE", ...kc("1234567890"), "KC_MINUS", "KC_EQUAL", ["KC_BSPACE", 2]),
              row(["KC_TAB", 1.5], ...kc("QWERTYUIOP"), "KC_LBRACKET", "KC_RBRACKET", ["KC_BSLASH", 1.5]),
              row(["KC_CAPSLOCK", 1.75], ...kc("ASDFGHJKL"), "KC_SCOLON", "KC_QUOTE", ["KC_ENTER", 2.25]),
              row(["KC_LSHIFT", 2.25], ...kc("ZXCVBNM"), "KC_COMMA", "KC_DOT", "KC_SLASH", ["KC_RSHIFT", 2.75]),
          ];
    return h(
        "div",
        null,
        h("div", { class: "row layout-row" }, h("span", { class: "small muted" }, "Computer layout"), layoutSelect("compact")),
        wrapBar(),
        section(
            "Keyboard",
            h(
                "div",
                { class: "kgrid" },
                row("KC_ESCAPE", 0.5, ...fkeys, 1.5),
                ...rows,
                row(["KC_LCTRL", 1.5], ["KC_LGUI", 1.25], ["KC_LALT", 1.25], ["KC_SPACE", 6], ["KC_RALT", 1.25], ["KC_RGUI", 1.25], ["KC_APPLICATION", 1.25], ["KC_RCTRL", 1.25]),
            ),
        ),
        section("Blank and transparent", h("div", { class: "kflow" }, key("KC_NO", "", "Blank"), key("KC_TRNS"))),
        symbolsSection(),
        section(
            "Navigation",
            h(
                "div",
                { class: "kflow" },
                ["KC_PSCREEN", "KC_SCROLLLOCK", "KC_PAUSE", "KC_INSERT", "KC_HOME", "KC_PGUP", "KC_DELETE", "KC_END", "KC_PGDOWN", "KC_LEFT", "KC_DOWN", "KC_UP", "KC_RIGHT"].map((n) => key(n)),
            ),
        ),
        section(
            "Numpad",
            h(
                "div",
                { class: "kflow" },
                ["KC_NUMLOCK", "KC_KP_SLASH", "KC_KP_ASTERISK", "KC_KP_MINUS", "KC_KP_PLUS", "KC_KP_7", "KC_KP_8", "KC_KP_9", "KC_KP_4", "KC_KP_5", "KC_KP_6", "KC_KP_1", "KC_KP_2", "KC_KP_3", "KC_KP_0", "KC_KP_DOT", "KC_KP_ENTER", "KC_KP_EQUAL", "KC_KP_COMMA"].map((n) => key(n)),
            ),
        ),
        section("F13 – F24", h("div", { class: "kflow" }, Array.from({ length: 12 }, (_, i) => key(`KC_F${i + 13}`)))),
        section("International", keys(registry.groups.get("iso")!)),
    );
}

/** Every character the computer's layout types with Shift / AltGr, grouped by modifier. */
function symbolsSection(): HTMLElement {
    const layout = activeLayout();
    const wrapping = state.wrap !== "none";
    const groups = new Map<string, HTMLElement[]>();
    const seen = new Set<string>();
    const syms = symbolsOf(layout).sort(([a], [b]) => ((a >> 8) & 0x1f) - ((b >> 8) & 0x1f) || (a & 0xff) - (b & 0xff));
    for (const [c, info] of syms) {
        if (seen.has(info.ch)) continue;
        seen.add(info.ch);
        const level = levelName(c, layout);
        const title = `${serialize(c)} — types “${info.ch}”${info.dead ? " (dead key)" : info.note ? ` (${info.note})` : ""} on ${layout.name}`;
        const el = pickKey(c, { label: info.ch, header: "", title, onClick: () => assign(c, "picker"), disabled: wrapping, literal: true });
        if (!groups.has(level)) groups.set(level, []);
        groups.get(level)!.push(el);
    }
    if (!groups.size) return section("Symbols", h("p", { class: "small muted" }, `No symbol data for ${layout.name}.`));
    return section(
        `Symbols on ${layout.name}`,
        h(
            "div",
            { class: "kgrid" },
            [...groups].map(([level, els]) => h("div", { class: "sym-group" }, h("span", { class: "sym-level" }, level), h("div", { class: "kflow" }, els))),
        ),
    );
}

/** Choose the computer's keyboard layout ("Automatic" follows the detected one). */
export function layoutSelect(variant: "compact" | "full" = "full"): HTMLElement {
    const auto = autoLayout();
    const sel = h(
        "select",
        {
            class: ["layout-select", variant],
            "aria-label": "Computer keyboard layout",
            title: "The keyboard layout your computer uses. Keys show what they will type with it.",
            onChange: (e: Event) => setHostLayout((e.target as HTMLSelectElement).value),
        },
        h("option", { value: "auto", selected: state.prefs.hostLayout === "auto" }, `Automatic: ${auto.name}`),
        LAYOUT_LIST.map((l) => h("option", { value: l.id, selected: state.prefs.hostLayout === l.id }, l.name)),
    );
    sel.addEventListener("keydown", (e) => e.stopPropagation());
    return sel;
}

const byIds = (group: string, test: (id: string) => boolean) => registry.groups.get(group)!.filter((d) => test(d.id));

export function specialKeys(): HTMLElement {
    const media = new Set(["KC_MPRV", "KC_MNXT", "KC_MPLY", "KC_MSTP", "KC_MUTE", "KC_VOLD", "KC_VOLU", "KC_MRWD", "KC_MFFD", "KC_EJCT", "KC__VOLDOWN", "KC__VOLUP"]);
    const mouse = (id: string) => /^KC_(MS_|BTN|WH_|ACL)/.test(id);
    const system = (id: string) => !media.has(id) && !mouse(id) && !/^KC_F\d+$/.test(id) && !/^KC_L(CAP|NUM|SCR)$/.test(id);
    const quantumHidden = /^(AU_|CLICKY_|MU_|HPT_)/;
    return h(
        "div",
        null,
        section("Media", keys(byIds("media", (id) => media.has(id)))),
        section(
            "Mouse",
            mouseKeysSupported() === false
                ? h(
                      "div",
                      { class: "notice warn", style: "margin-bottom:8px" },
                      h("b", null, "Your TOTEM's firmware has no mouse keys. "),
                      "It was built without them (the TOTEM's current Vial source leaves them out), so these keys won't do anything. Flash the firmware from the firmware folder — see “Firmware” in the README — then they work as soon as you assign them.",
                  )
                : null,
            keys(byIds("media", mouse)),
        ),
        section("One-shot modifiers", keys(byIds("modifiers", (id) => id.startsWith("OSM(")))),
        section("Shift & space cadet", keys(byIds("modifiers", (id) => /^KC_(GESC|LSPO|RSPC|LCPO|RCPC|LAPO|RAPC|SFTENT)$/.test(id)))),
        section("Features", keys(byIds("quantum", (id) => !quantumHidden.test(id) && !id.startsWith("MAGIC_")))),
        section("Magic", keys(byIds("quantum", (id) => id.startsWith("MAGIC_")))),
        section("System & apps", keys(byIds("media", system))),
        section("Dynamic macros", keys(registry.groups.get("macro")!.filter((d) => d.id.startsWith("DYN_")))),
        section("Firmware", keys(registry.groups.get("boot")!), h("p", { class: "small muted" }, "QK_BOOT puts the TOTEM into its bootloader. Vial asks you to unlock the keyboard before you can assign it.")),
    );
}

export function layerKeys(): HTMLElement {
    const n = state.kb?.layers ?? 4;
    const fns: [string, string][] = [
        ["MO", "Momentary: layer is on while held"],
        ["TG", "Toggle the layer on/off"],
        ["TO", "Switch to the layer"],
        ["TT", "Tap-toggle: hold for MO, tap repeatedly to toggle"],
        ["OSL", "One-shot: layer for the next key only"],
        ["DF", "Set the base layer (until unplugged)"],
        ["PDF", "Set the base layer permanently"],
    ];
    const visible = fns.filter(([fn]) => fn !== "PDF" || registry.caps.features.has("persistent_default_layer"));
    // One row per layer, one column per function, so 16 layers still fit the panel.
    const grid = h("div", { class: "layer-grid", style: { gridTemplateColumns: `minmax(56px, 110px) repeat(${visible.length}, 36px)` } });
    grid.appendChild(h("span"));
    for (const [fn, tip] of visible) grid.appendChild(h("span", { class: "fn", title: tip, style: "text-align:center" }, fn));
    for (let l = 0; l < n; l++) {
        grid.appendChild(h("span", { class: "fn", style: { color: layerColor(l).hex }, title: `Layer ${l}` }, nameOf("layer", l) ?? `Layer ${l}`));
        for (const [fn, tip] of visible) {
            const c = code(`${fn}(${l})`);
            grid.appendChild(pickKey(c, { cls: "w36", header: fn, label: String(l), title: `${fn}(${l}): ${tip}`, onClick: () => assign(c, "picker") }));
        }
    }
    const extra = registry.groups.get("layers")!.filter((d) => !/\(/.test(d.id) && registry.isVisible(d));
    return h(
        "div",
        null,
        section("Layer switching", grid, h("p", { class: "small muted" }, visible.map(([fn, tip]) => `${fn}: ${tip}.`).join(" "))),
        section(
            "Layer-Tap",
            h(
                "p",
                { class: "small muted" },
                "Layer while held, a key when tapped. Open Standard Keys, choose “Layer-Tap” and a layer, then pick the tap key. ",
                h(
                    "a",
                    {
                        href: "#",
                        onClick: (e: Event) => {
                            e.preventDefault();
                            state.wrap = "layertap";
                            state.panel = "keys";
                            invalidate("all");
                        },
                    },
                    "Do it now",
                ),
            ),
        ),
        extra.length ? section("More", keys(extra)) : null,
    );
}

export function macroTdKeys(): HTMLElement {
    const kb = state.kb;
    return h(
        "div",
        null,
        section("Macros", keys(registry.groups.get("macro")!.filter((d) => !d.id.startsWith("DYN_"))), !kb?.macroCount ? h("p", { class: "small muted" }, "This firmware has no macros.") : null),
        section("Tap dances", keys(registry.groups.get("tapdance")!), !registry.groups.get("tapdance")!.length ? h("p", { class: "small muted" }, "This firmware has no tap dances.") : null),
        section("User keycodes", keys(registry.groups.get("user")!), h("p", { class: "small muted" }, "Only useful if your firmware's keymap.c handles them.")),
    );
}

export function customKey(): HTMLElement {
    const input = h("input", { type: "text", class: "mono", placeholder: "e.g. LT(2,KC_SPC)  LCTL_T(KC_A)  LSFT(KC_1)  0x7e40", style: "width:100%" });
    const preview = h("div", { class: "row", style: "min-height:40px" });
    const status = h("div", { class: "small muted" });
    let current: number | null = null;
    const update = () => {
        preview.replaceChildren();
        current = null;
        const v = input.value.trim();
        if (!v) {
            status.textContent = "Any QMK keycode name or expression Vial understands.";
            return;
        }
        try {
            current = parseKeycode(v);
            const c = current;
            preview.append(pickKey(c, { onClick: () => assign(c, "picker") }), h("span", { class: "mono small" }, `${serialize(c)} = 0x${c.toString(16).padStart(4, "0")}`));
            status.textContent = describe(c).title;
        } catch (e) {
            status.textContent = (e as Error).message;
        }
    };
    input.addEventListener("input", update);
    input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter" && current !== null) assign(current, "picker");
    });
    update();
    return h(
        "div",
        null,
        section("Any keycode", input, preview, status, h("p", { class: "small muted" }, "Press Enter or click the key to assign it. Functions: MO TG TO TT OSL DF PDF LT LM MT OSM TD, mod wrappers like LCTL/C_S/MEH/HYPR and their _T variants.")),
    );
}

export type PickerTab = "basic" | "layers" | "special" | "macro" | "custom";
export const PICKER_TABS: [PickerTab, string][] = [
    ["basic", "Basic"],
    ["layers", "Layers"],
    ["special", "Special"],
    ["macro", "Macro / TD"],
    ["custom", "Any"],
];

let embeddedTab: PickerTab = "basic";
/** A tabbed picker for use inside editors. */
export function embeddedPicker(): HTMLElement {
    const body = embeddedTab === "basic" ? standardKeys() : embeddedTab === "layers" ? layerKeys() : embeddedTab === "special" ? specialKeys() : embeddedTab === "macro" ? macroTdKeys() : customKey();
    return h(
        "div",
        { style: "margin-top:8px" },
        h(
            "div",
            { class: "tabs" },
            PICKER_TABS.map(([t, label]) =>
                h(
                    "button",
                    {
                        class: embeddedTab === t && "on",
                        onClick: () => {
                            embeddedTab = t;
                            invalidate("panel");
                        },
                    },
                    label,
                ),
            ),
        ),
        h("div", { style: "margin-top:10px" }, body),
    );
}

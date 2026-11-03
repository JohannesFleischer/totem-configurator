// The overlay's settings window (totem-keybard.html#overlay-settings): how the overlay
// looks and behaves, with a live preview. Every change is saved at once; the overlay
// window picks it up through the "storage" event.
import { registry } from "../keycodes";
import { sanitizeNames } from "../model";
import { DEFAULT_OVERLAY, loadOverlay, OVERLAY_KEY, overlayHost, PRESETS, saveOverlay, STYLE_NAMES, withStyle, type OverlaySettings, type OverlayStyle } from "../overlay-settings";
import { onRender, redetectLayout, reloadPrefs } from "../store";
import { demoKeyboard } from "../totem";
import { BOARD_H, BOARD_W, MAX_SQUEEZE } from "./board";
import { h, icon, ICONS, mount } from "./dom";
import { BOARD_KEY, IDLE, NAMES_PREFIX, renderOverlay, STATUS_KEY } from "./overlay-view";
import { layoutSelect } from "./picker";

interface CachedBoard {
    uid: string;
    keymap: number[][];
    names: { layer: Record<string, string> };
    info: { layers: number; macros: number; tapDances: number; combos: number; overrides: number; altRepeats: number; featureBits: number; vialProtocol: number };
}

function cachedBoard(): CachedBoard | null {
    try {
        const b = JSON.parse(localStorage.getItem(BOARD_KEY) ?? "null");
        return b && Array.isArray(b.keymap) && b.keymap.length ? b : null;
    } catch {
        return null;
    }
}

function overlayStatus(): { status: string; text: string; layer: number; unlocked: boolean; product: string; at: number } | null {
    try {
        return JSON.parse(localStorage.getItem(STATUS_KEY) ?? "null");
    } catch {
        return null;
    }
}

/** Overlay window height for a width, so the keys fill it. */
export function heightFor(width: number, s: OverlaySettings): number {
    const squeeze = MAX_SQUEEZE * (1 - s.gap);
    const board = ((width - 6) / (BOARD_W - squeeze + 0.1)) * (BOARD_H + 0.1) + 6;
    return Math.round(board + (s.showTitle ? Math.min(30, Math.max(16, Math.round(board * 0.093))) : 0));
}

export function initOverlaySettings(container: HTMLElement) {
    document.documentElement.classList.add("ovl-settings-page");
    document.title = "Overlay settings · totem-keybard";
    const host = overlayHost();
    let s = loadOverlay();
    let previewLayer = 0;
    let previewShift = false;
    let backdrop: "dark" | "light" | "busy" = "busy";
    let width = 760;
    let namesNote = ""; // what the last "Load names" did

    // what to draw in the preview: the overlay's last read of the keyboard, or the TOTEM default
    let board = cachedBoard();
    const demo = demoKeyboard();
    const useBoard = () => {
        board = cachedBoard();
        if (board) {
            const i = board.info;
            const features = new Set<string>();
            if (i.featureBits & 1) features.add("caps_word");
            if (i.featureBits & 2) features.add("layer_lock");
            if (i.vialProtocol >= 5) features.add("persistent_default_layer");
            if (i.altRepeats) features.add("repeat_key");
            registry.rebuild({ layers: i.layers, macroCount: i.macros, tapDanceCount: i.tapDances, features });
        } else demoKeyboard();
    };
    useBoard();

    const set = (patch: Partial<OverlaySettings>, keepStyle = false) => {
        s = { ...s, ...patch };
        if (!keepStyle && s.style !== "custom" && Object.keys(patch).some((k) => k in PRESETS.dark)) s.style = "custom";
        saveOverlay(s);
        render();
    };

    const range = (label: string, value: number, min: number, max: number, step: number, fmt: (v: number) => string, on: (v: number) => void) => {
        const out = h("span", { class: "ov-val" }, fmt(value));
        const inp = h("input", { type: "range", min, max, step, value: String(value), "aria-label": label });
        inp.addEventListener("input", () => {
            out.textContent = fmt(Number(inp.value));
            on(Number(inp.value));
        });
        return h("label", { class: "ov-row" }, h("span", { class: "ov-lbl" }, label), inp, out);
    };
    const colorIn = (label: string, value: string, on: (v: string) => void) => {
        const inp = h("input", { type: "color", value, "aria-label": label });
        inp.addEventListener("input", () => on(inp.value));
        return inp;
    };
    const check = (label: string, value: boolean, on: (v: boolean) => void, note?: string) => {
        const inp = h("input", { type: "checkbox", checked: value });
        inp.addEventListener("change", () => on(inp.checked));
        return h("label", { class: "check" }, inp, h("span", null, label, note ? h("span", { class: "small muted", style: "display:block" }, note) : null));
    };
    const seg = <T extends string>(value: T, options: [T, string][], on: (v: T) => void, label: string) =>
        h("div", { class: "seg", role: "group", "aria-label": label }, options.map(([v, t]) => h("button", { class: value === v && "on", onClick: () => on(v) }, t)));

    function preview(): HTMLElement {
        const km = board?.keymap ?? demo.keymap;
        const names = board?.names.layer ?? demo.names.layer;
        const layers = km.length;
        const used = Array.from({ length: layers }, (_, l) => l).filter((l) => l === 0 || km[l].some((c) => c !== 0 && c !== 1));
        if (!used.includes(previewLayer)) previewLayer = 0;
        const live = {
            ...IDLE,
            layerState: previewLayer ? 1 << previewLayer : 0,
            mods: previewShift ? 0x02 : 0,
            unlocked: true,
            held: Array.from({ length: 40 }, (_, i) => i === 11 || i === 23),
        };
        const pw = Math.min(width - 40, 640);
        const ph = heightFor(pw, s);
        const ovl = renderOverlay({ keymap: km, live, settings: { ...s, show: "always" }, width: pw, height: ph, layerName: (l) => names[String(l)] });
        return h(
            "section",
            { class: "ov-preview-wrap" },
            h(
                "div",
                { class: "row wrap", style: "justify-content:space-between" },
                h(
                    "div",
                    { class: "chips" },
                    used.map((l) => h("button", { class: ["chip", "sm", previewLayer === l && "on"], onClick: () => ((previewLayer = l), render()) }, names[String(l)] ?? `Layer ${l}`)),
                    h("button", { class: ["chip", "sm", previewShift && "on"], title: "Show the preview with Shift held", onClick: () => ((previewShift = !previewShift), render()) }, "⇧ Shift"),
                ),
                seg(backdrop, [["busy", "Busy"], ["dark", "Dark"], ["light", "Light"]], (v) => ((backdrop = v), render()), "Preview background"),
            ),
            h("div", { class: ["ov-preview", `bg-${backdrop}`], style: { height: `${ph + 24}px` } }, h("div", { style: { width: `${pw}px`, height: `${ph}px` } }, ovl)),
            h("p", { class: "small muted", style: "margin:6px 0 0" }, board ? "Your TOTEM's layout, as the overlay last read it." : "The TOTEM's default layout — yours shows once the overlay has found your keyboard.", " The two red keys show what held keys look like."),
        );
    }

    function statusLine(): HTMLElement {
        const st = overlayStatus();
        if (!host) return h("div", { class: "notice" }, "This is a preview of the overlay settings. The overlay itself is the totem-overlay app (NixOS: totem-overlay; elsewhere: the start scripts in the untested-os folder): start it and open its settings from its tray icon.");
        const fresh = st && Date.now() - st.at < 60_000 * 60 * 24 * 365;
        const cls = st?.status === "live" ? "ok" : st?.status === "noreport" || st?.status === "error" ? "warn" : "";
        return h("div", { class: ["notice", "ov-status", cls] }, h("span", { class: ["dot", st?.status === "live" && "live"] }), fresh ? st!.text : "The overlay is starting…");
    }

    /** Held keys: unlocked or not, and the button to change it (the overlay does the unlock). */
    function unlockRow(): HTMLElement | null {
        if (!host) return null;
        const st = overlayStatus();
        if (st?.status !== "live")
            return h("div", { class: "notice ov-unlock-row" }, "Unlocking needs the overlay to be following your TOTEM (with the firmware from the firmware folder).");
        return st.unlocked
            ? h(
                  "div",
                  { class: "notice ok ov-unlock-row", dataset: { unlocked: "yes" } },
                  h("span", null, "✓ The keyboard is unlocked: the keys you hold light up."),
                  h("button", { class: "pill ghost sm", onClick: () => host.lock() }, "Lock"),
              )
            : h(
                  "div",
                  { class: "notice ov-unlock-row", dataset: { unlocked: "no" } },
                  h("span", null, "The keyboard is locked, so held keys don't show. The overlay shows which two keys to hold."),
                  h("button", { class: "pill sm", onClick: () => host.unlock() }, "Unlock…"),
              );
    }

    function render() {
        width = container.clientWidth || 760;
        const look = h(
            "section",
            null,
            h("h3", null, "Look"),
            h("div", { class: "chips" }, (Object.keys(STYLE_NAMES) as OverlayStyle[]).map((st) => h("button", { class: ["chip", s.style === st && "on"], onClick: () => ((s = withStyle(s, st)), saveOverlay(s), render()) }, STYLE_NAMES[st]))),
            h(
                "div",
                { class: "ov-grid" },
                h("label", { class: "ov-row" }, h("span", { class: "ov-lbl" }, "Keys"), s.style === "layer" ? h("span", { class: "small muted" }, "layer colours") : colorIn("Key colour", s.keyColor, (v) => set({ keyColor: v }))),
                range("Key fill", s.keyAlpha, 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`, (v) => set({ keyAlpha: v })),
                h("label", { class: "ov-row" }, h("span", { class: "ov-lbl" }, "Legends"), s.style === "layer" ? h("span", { class: "small muted" }, "white") : colorIn("Legend colour", s.textColor, (v) => set({ textColor: v }))),
                h("label", { class: "ov-row" }, h("span", { class: "ov-lbl" }, "Outline"), colorIn("Outline colour", s.outlineColor, (v) => set({ outlineColor: v }))),
                range("Outline", s.outlineAlpha, 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`, (v) => set({ outlineAlpha: v })),
                range("Outline width", s.outlineWidth, 0, 4, 0.5, (v) => `${v} px`, (v) => set({ outlineWidth: v })),
                h("label", { class: "ov-row" }, h("span", { class: "ov-lbl" }, "Held keys"), colorIn("Held key colour", s.heldColor, (v) => set({ heldColor: v }, true))),
            ),
            check("Dark shadow behind legends (readable on any background)", s.shadow, (v) => set({ shadow: v })),
            h("h3", { style: "margin-top:16px" }, "Overall"),
            h(
                "div",
                { class: "ov-grid" },
                range("Opacity", s.opacity, 0.1, 1, 0.01, (v) => `${Math.round(v * 100)}%`, (v) => set({ opacity: v }, true)),
                range("Text size", s.textScale, 0.7, 1.6, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => set({ textScale: v }, true)),
                range("Gap between halves", s.gap, 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => set({ gap: v }, true)),
            ),
        );
        const behaviour = h(
            "section",
            null,
            h("h3", null, "Behaviour"),
            h(
                "div",
                { class: "ov-grid" },
                h("div", { class: "ov-row" }, h("span", { class: "ov-lbl" }, "Show"), seg(s.show, [["always", "Always"], ["layers", "Only on other layers"]], (v) => set({ show: v }, true), "When to show the overlay")),
                h("div", { class: "ov-row" }, h("span", { class: "ov-lbl" }, "Layer change"), seg(s.layerEffect, [["off", "Off"], ["flash", "Flash"], ["fade", "Fade"]], (v) => set({ layerEffect: v }, true), "Layer change effect")),
            ),
            h(
                "div",
                { class: "checks" },
                check("Layer name above the keys", s.showTitle, (v) => set({ showTitle: v }, true)),
                check("Transparent keys show the key underneath (dimmed)", s.throughKeys, (v) => set({ throughKeys: v }, true)),
                check("While Shift is held, show what keys type with Shift", s.shiftLegends, (v) => set({ shiftLegends: v }, true)),
                check("Lowercase letters (capitals with Shift, Caps Lock or Caps Word)", s.lowercase, (v) => set({ lowercase: v }, true)),
                check(
                    "Highlight the keys you hold",
                    s.highlightHeld,
                    (v) => set({ highlightHeld: v }, true),
                    "Only while the keyboard is unlocked. Vial keeps held keys secret otherwise, so no program can read what you type. Unlocking lasts until the TOTEM is unplugged.",
                ),
            ),
            unlockRow(),
        );
        let place: HTMLElement | null = null;
        if (host) {
            place = h(
                "section",
                null,
                h("h3", null, "Size and place"),
                h(
                    "div",
                    { class: "ov-grid" },
                    range("Width", sizeNow, 240, 1600, 10, (v) => `${v} px`, (v) => {
                        sizeNow = v;
                        host.resizeTo(v, heightFor(v, s));
                    }),
                ),
                h(
                    "div",
                    { class: "row wrap", style: "margin-top:8px" },
                    h("button", { class: "pill", onClick: () => host.setAdjusting(true) }, "Move and resize on screen"),
                    h("button", { class: "pill ghost", onClick: () => host.placeBottom() }, "Bottom centre"),
                    h("button", { class: "pill ghost", onClick: () => host.openEditor() }, "Open the editor"),
                ),
                h("p", { class: "small muted" }, "Clicks go through the overlay to the window underneath. To move it, use “Move and resize on screen” (or the tray icon), drag it, then press Done."),
            );
        }
        const layout = h("section", null, h("h3", null, "Your computer's keyboard layout"), h("p", { class: "small muted", style: "margin-top:0" }, "Legends show what keys type on this layout, as in the editor."), layoutSelect("full"));
        const namesIn = h("input", { type: "file", accept: ".vil,.json,application/json", class: "hidden" });
        namesIn.addEventListener("change", async () => {
            const f = namesIn.files?.[0];
            namesIn.value = "";
            if (!f) return;
            const b = cachedBoard();
            try {
                const json = JSON.parse((await f.text()).replace(/"uid"\s*:\s*(\d{16,})/, '"uid": "$1"'));
                const i = b?.info ?? { layers: 16, macros: 16, tapDances: 32, combos: 32, overrides: 32 };
                const names = sanitizeNames(json.cosmetic, {
                    layers: i.layers,
                    macroCount: i.macros,
                    tapDances: new Array(i.tapDances).fill(0),
                    combos: new Array(i.combos).fill(0),
                    overrides: new Array(i.overrides).fill(0),
                } as never);
                const n = Object.values(names).reduce((a, m) => a + Object.keys(m).length, 0);
                if (!n) {
                    namesNote = `“${f.name}” has no names in it.`;
                    return render();
                }
                localStorage.setItem(NAMES_PREFIX + (b?.uid ?? "none"), JSON.stringify(names));
                namesNote = `Loaded ${n} name${n === 1 ? "" : "s"} from “${f.name}”.`;
                useBoard();
                if (board) board.names = names;
                render();
            } catch (e) {
                namesNote = `Couldn't read “${f.name}”: ${(e as Error).message}`;
                render();
            }
        });
        const namesMsg = h("span", { class: "small muted" }, namesNote);
        const names = h(
            "section",
            null,
            h("h3", null, "Layer names"),
            h(
                "p",
                { class: "small muted", style: "margin-top:0" },
                host
                    ? "Names you give layers in the editor of this app (tray → Open editor) show on the overlay by themselves. Named them in Chrome instead? Save a .vil file there and load it here."
                    : "The overlay shows the names saved in a .vil file.",
            ),
            h("div", { class: "row wrap" }, h("button", { class: "pill ghost", onClick: () => namesIn.click() }, icon(ICONS.upload, 16), "Load names from a .vil file"), namesMsg, namesIn),
        );
        mount(
            container,
            h(
                "div",
                { class: "ov-settings" },
                h("div", { class: "ov-head" }, h("h2", null, "Overlay"), h("button", { class: "pill ghost sm", onClick: () => ((s = { ...DEFAULT_OVERLAY }), saveOverlay(s), render()) }, "Reset to defaults")),
                statusLine(),
                preview(),
                look,
                behaviour,
                place,
                layout,
                names,
            ),
        );
    }

    let sizeNow = 760;
    host?.getBounds().then((b) => {
        sizeNow = b.width;
        render();
    });
    window.addEventListener("storage", (e) => {
        if (e.key === STATUS_KEY) {
            container.querySelector(".ov-status")?.replaceWith(statusLine());
            const row = unlockRow();
            if (row) container.querySelector(".ov-unlock-row")?.replaceWith(row);
            return;
        }
        if (e.key === BOARD_KEY || e.key?.startsWith(NAMES_PREFIX)) useBoard();
        else if (e.key === OVERLAY_KEY) s = loadOverlay();
        else if (e.key === "totem-keybard:prefs") reloadPrefs();
        else return;
        render();
    });
    let t = 0;
    window.addEventListener("resize", () => {
        clearTimeout(t);
        t = window.setTimeout(render, 80);
    });
    onRender("panel", render); // the computer's layout changed (picked here or detected)
    redetectLayout();
    render();
}

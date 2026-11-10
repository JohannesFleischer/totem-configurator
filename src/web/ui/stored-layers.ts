// The "Stored Layers" panel: layers kept aside in the app, to load into a layer when you want
// them (layer-library.ts). Loading stores what was on the layer first, so nothing gets lost.
import { codesOf, removeStoredLayer, renameStoredLayer, storedLayers, type StoredLayer } from "../layer-library";
import { TOTEM_COLS } from "../model";
import { importStoredLayers, invalidate, loadStoredLayer, nameOf, state, storeLayer, ui } from "../store";
import { BOARD_W, renderBoard } from "./board";
import { h, icon, ICONS } from "./dom";
import { pickLayoutFile } from "./filepicker";

const PREVIEW_W = 372; // px: fits the panel
let storeFrom: number | null = null; // the layer last chosen to store (kept while the panel redraws)
const layerLabel = (l: number) => `${l} · ${nameOf("layer", l) ?? `Layer ${l}`}`;
const layerSelect = (value: number, label: string) =>
    h(
        "select",
        { class: "sl-select", "aria-label": label },
        Array.from({ length: state.kb!.layers }, (_, l) => h("option", { value: String(l), selected: l === value }, layerLabel(l))),
    );

export function storedPanel(): HTMLElement {
    const kb = state.kb!;
    const list = storedLayers();
    const which = layerSelect(storeFrom !== null && storeFrom < kb.layers ? storeFrom : state.layer, "Layer to store");
    which.addEventListener("change", () => (storeFrom = Number(which.value)));
    const vilIn = h("input", { type: "file", accept: ".vil,.json,application/json", class: "hidden" });
    vilIn.addEventListener("change", () => {
        const f = vilIn.files?.[0];
        vilIn.value = "";
        if (f) void importStoredLayers(f);
    });
    return h(
        "div",
        { class: "stored" },
        h(
            "p",
            { style: "margin-top:0;line-height:1.55" },
            "Keep layers you aren't using, and load one into a layer when you want it: say a Colemak and a Neo base layer. Loading stores what was on the layer first, so nothing gets lost (and Undo takes the load back).",
        ),
        h(
            "div",
            { class: "sl-store" },
            which,
            h("button", { class: "pill sm", onClick: () => storeLayer(Number(which.value)) }, "Store this layer"),
        ),
        h(
            "div",
            { class: "row wrap", style: "margin:8px 0 14px" },
            h("button", { class: "pill sm ghost", title: "Store the layers of a .vil layout (yours or someone else's)", onClick: () => pickLayoutFile(vilIn, importStoredLayers) }, icon(ICONS.upload, 14), "Store layers from a .vil…"),
            vilIn,
        ),
        list.length
            ? h("div", { class: "sl-list" }, list.map((e) => card(e, kb.keymap[0].length)))
            : h("div", { class: "notice" }, "Nothing stored yet. Store a layer to keep it, for example your base layer before you load another layout into it."),
        h("p", { class: "small muted" }, "Stored layers are kept in this app (in the browser: in this browser), not on the keyboard or in .vil files."),
    );
}

function card(e: StoredLayer, size: number): HTMLElement {
    const codes = codesOf(e, size);
    const unit = Math.floor((PREVIEW_W / BOARD_W) * 10) / 10;
    const preview = renderBoard({ unit, codeAt: (r, c) => codes[r * TOTEM_COLS + c], color: (r) => ({ hex: r < 4 ? "#5d6b75" : "#4f5d68", fg: "#fff" }), noTitles: true });
    preview.classList.add("sl-board");
    preview.style.pointerEvents = "none";
    const target = layerSelect(state.layer, `Layer to load “${e.name}” into`);
    const nameEl = h("span", { class: "sl-name", title: "Rename" }, e.name);
    const rename = () => {
        const inp = h("input", { class: "sl-rename", value: e.name, maxlength: 40, "aria-label": "Name" });
        const done = (save: boolean) => {
            if (save) renameStoredLayer(e.id, inp.value);
            invalidate("panel");
        };
        inp.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") done(true);
            else if (ev.key === "Escape") (ev.stopPropagation(), done(false));
        });
        inp.addEventListener("blur", () => done(true));
        nameEl.replaceWith(inp);
        inp.focus();
        inp.select();
    };
    nameEl.addEventListener("click", rename);
    const when = new Date(e.saved).toLocaleDateString(undefined, { dateStyle: "medium" });
    return h(
        "div",
        { class: "sl-card", dataset: { id: e.id } },
        h(
            "div",
            { class: "sl-head" },
            h("div", { class: "sl-title" }, nameEl, h("span", { class: "small muted" }, `${when}${e.from ? ` · ${e.from}` : ""}`)),
            h("button", { class: "pill sm ghost", title: "Rename", onClick: rename }, "Rename"),
            h(
                "button",
                {
                    class: "pill sm ghost sl-delete",
                    onClick: async () => {
                        if (!(await ui.confirm(`Delete “${e.name}”?`, "It's only removed from your stored layers; the keyboard isn't changed.", "Delete"))) return;
                        removeStoredLayer(e.id);
                        invalidate("panel");
                    },
                },
                "Delete",
            ),
        ),
        preview,
        h(
            "div",
            { class: "sl-actions" },
            h("span", { class: "small muted" }, "Load into"),
            target,
            h("button", { class: "pill sm sl-load", onClick: () => void loadStoredLayer(e.id, Number(target.value)) }, "Load"),
        ),
    );
}

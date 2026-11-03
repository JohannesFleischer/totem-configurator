// Pointer gestures on the TOTEM, with a mouse or pen (touch keeps scrolling):
// - drag a key onto another key to swap them; hold Alt when dropping to copy instead.
//   Hold the dragged key over a layer tab to switch to that layer and swap across layers.
// - drag on empty space around the keys to select every key inside the box
//   (with Ctrl/⌘/Shift: add them to the selection).
import { invalidate, selectedKeys, setKeySelection, state, swapKeys } from "../store";

interface KeyDrag {
    kind: "key";
    layer: number;
    pos: number;
    x0: number;
    y0: number;
    started: boolean;
    cancelled: boolean;
    ghost?: HTMLElement;
    dx: number; // pointer → key centre
    dy: number;
    over: { layer: number; pos: number } | null;
    tab: number | null; // layer tab being hovered
    tabTimer?: ReturnType<typeof setTimeout>;
}
interface BoxDrag {
    kind: "box";
    x0: number;
    y0: number;
    started: boolean;
    cancelled: boolean;
    additive: boolean;
    base: number[];
    box?: HTMLElement;
    hits: number[];
}

let g: KeyDrag | BoxDrag | null = null;
let suppressClick = false;

const THRESHOLD = 6; // px before a press becomes a drag
const TAB_DELAY = 450; // ms over a layer tab before switching to it

const boardKeys = () => [...document.querySelectorAll<HTMLElement>(".stage .board .key")];

/** Extra classes for a key while a gesture is going on (so re-renders keep them). */
export function gestureClasses(layer: number, pos: number): string[] {
    if (!g || !g.started || g.cancelled) return [];
    if (g.kind === "key") {
        const out: string[] = [];
        if (g.layer === layer && g.pos === pos) out.push("dragging");
        if (g.over && g.over.layer === layer && g.over.pos === pos) out.push("drop");
        return out;
    }
    return g.hits.includes(pos) ? ["marq"] : [];
}

/** Update the key classes in place (cheaper than re-rendering on every move). */
function paint() {
    for (const el of boardKeys()) {
        const cls = gestureClasses(state.layer, Number(el.dataset.pos));
        for (const c of ["dragging", "drop", "marq"]) el.classList.toggle(c, cls.includes(c));
    }
}

/** Remove the ghost / box and hover marks. */
function cleanup(d: KeyDrag | BoxDrag) {
    if (d.kind === "key") {
        clearTimeout(d.tabTimer);
        d.ghost?.remove();
        document.querySelector(".layer-tab.drag-over")?.classList.remove("drag-over");
        document.body.classList.remove("dragging-key");
    } else d.box?.remove();
}

/** Esc while dragging: drop nothing. Returns whether a drag was going on. */
export function cancelGesture(): boolean {
    if (!g || !g.started || g.cancelled) return false;
    cleanup(g);
    g.cancelled = true;
    paint();
    return true;
}

function begin(ev: PointerEvent) {
    if (!g) return;
    g.started = true;
    if (g.kind === "key") {
        const src = document.querySelector<HTMLElement>(`.stage .board .key[data-pos="${g.pos}"]`);
        if (!src) {
            g = null;
            return;
        }
        const r = src.getBoundingClientRect();
        const ghost = src.cloneNode(true) as HTMLElement;
        ghost.classList.remove("sel", "flash", "dragging", "drop", "marq");
        ghost.classList.add("ghost");
        ghost.removeAttribute("title");
        ghost.setAttribute("aria-hidden", "true");
        Object.assign(ghost.style, { position: "fixed", left: "0px", top: "0px", transform: "none", pointerEvents: "none" });
        g.dx = r.left + r.width / 2 - g.x0;
        g.dy = r.top + r.height / 2 - g.y0;
        document.body.appendChild(ghost);
        document.body.classList.add("dragging-key");
        g.ghost = ghost;
    } else {
        g.box = document.createElement("div");
        g.box.className = "marquee";
        document.body.appendChild(g.box);
    }
    move(ev);
}

function move(ev: PointerEvent) {
    if (!g || g.cancelled) return;
    if (g.kind === "key") {
        const d = g;
        const gh = d.ghost!;
        gh.style.translate = `${ev.clientX + d.dx - gh.offsetWidth / 2}px ${ev.clientY + d.dy - gh.offsetHeight / 2}px`;
        gh.classList.toggle("copy", ev.altKey);
        const under = document.elementFromPoint(ev.clientX, ev.clientY); // the ghost lets the pointer through
        const key = under?.closest<HTMLElement>(".stage .board .key");
        const pos = key ? Number(key.dataset.pos) : -1;
        d.over = key && !(d.layer === state.layer && pos === d.pos) ? { layer: state.layer, pos } : null;
        // holding it over a layer tab switches to that layer
        const tabEl = under?.closest<HTMLElement>(".layer-tab");
        const tab = tabEl ? Number(tabEl.dataset.layer) : null;
        if (tab !== d.tab) {
            clearTimeout(d.tabTimer);
            document.querySelector(".layer-tab.drag-over")?.classList.remove("drag-over");
            d.tab = tab;
            if (tabEl && tab !== null && tab !== state.layer) {
                tabEl.classList.add("drag-over");
                d.tabTimer = setTimeout(() => {
                    if (g !== d || d.cancelled) return;
                    state.layer = tab;
                    if (state.target?.kind === "key") state.target = { ...state.target, layer: tab };
                    d.tab = null;
                    invalidate("board", "panel");
                }, TAB_DELAY);
            }
        }
    } else {
        const x = Math.min(g.x0, ev.clientX),
            y = Math.min(g.y0, ev.clientY),
            w = Math.abs(ev.clientX - g.x0),
            h = Math.abs(ev.clientY - g.y0);
        Object.assign(g.box!.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
        // a key is in the box when its centre is
        g.hits = boardKeys()
            .filter((el) => {
                const r = el.getBoundingClientRect();
                const cx = r.left + r.width / 2,
                    cy = r.top + r.height / 2;
                return cx >= x && cx <= x + w && cy >= y && cy <= y + h;
            })
            .map((el) => Number(el.dataset.pos));
    }
    paint();
}

async function finish(ev: PointerEvent) {
    const d = g;
    g = null;
    if (!d || !d.started) return; // a plain click: let it through
    // The click that follows a drag must not select or clear anything.
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    cleanup(d);
    paint();
    if (d.cancelled) return;
    if (d.kind === "key") {
        if (d.over && (await swapKeys({ layer: d.layer, i: d.pos }, { layer: d.over.layer, i: d.over.pos }, ev.altKey))) setKeySelection(d.over.layer, [d.over.pos]);
    } else {
        const keys = d.additive ? [...d.base.filter((p) => !d.hits.includes(p)), ...d.hits] : d.hits;
        setKeySelection(state.layer, keys);
        if (keys.length && !state.panel) {
            state.panel = "keys";
            invalidate("all");
        }
    }
}

/** Start listening. `area` is the main area holding the stage with the TOTEM. */
export function attachGestures(area: HTMLElement) {
    area.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0 || ev.pointerType === "touch" || !state.kb) return;
        // not in the modes where a click on a key means something else
        if (state.lock || state.swapFrom || (state.panel === "tester" && state.tester.running) || (state.target && state.target.kind !== "key")) return;
        const el = ev.target as HTMLElement;
        if (!el.closest(".stage")) return;
        const key = el.closest<HTMLElement>(".board .key");
        if (key) {
            g = { kind: "key", layer: state.layer, pos: Number(key.dataset.pos), x0: ev.clientX, y0: ev.clientY, started: false, cancelled: false, dx: 0, dy: 0, over: null, tab: null };
            return;
        }
        ev.preventDefault(); // no text selection while drawing the box
        const additive = ev.shiftKey || ev.ctrlKey || ev.metaKey;
        const base = additive && state.target?.kind === "key" && state.target.layer === state.layer ? selectedKeys() : [];
        g = { kind: "box", x0: ev.clientX, y0: ev.clientY, started: false, cancelled: false, additive, base, hits: [] };
    });
    window.addEventListener("pointermove", (ev) => {
        if (!g) return;
        if (!g.started) {
            if (Math.hypot(ev.clientX - g.x0, ev.clientY - g.y0) >= THRESHOLD) begin(ev);
            return;
        }
        move(ev);
    });
    window.addEventListener("pointerup", (ev) => void finish(ev));
    window.addEventListener("pointercancel", () => {
        if (g) cleanup(g);
        g = null;
        paint();
    });
    window.addEventListener(
        "click",
        (ev) => {
            if (!suppressClick) return;
            suppressClick = false;
            ev.stopPropagation();
            ev.preventDefault();
        },
        true,
    );
}

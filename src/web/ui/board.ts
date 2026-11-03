// The TOTEM, drawn from its real geometry, and keycap helpers.
import { describe, type KeyFace } from "../keycodes";
import { TOTEM_COLS } from "../model";
import { TOTEM_HEIGHT, TOTEM_KEYS, TOTEM_WIDTH } from "../totem-geometry";
import { isMouseKeycode, mouseKeysSupported } from "../store";
import { h } from "./dom";

export interface BoardOptions {
    unit: number; // px per key unit
    squeeze?: number; // key units to move the right half towards the left one
    codeAt: (row: number, col: number) => number;
    color: (row: number, col: number) => { hex: string; fg: string };
    selected?: (row: number, col: number) => boolean;
    classFor?: (row: number, col: number) => string[];
    onClick?: (row: number, col: number, ev: MouseEvent) => void;
    onHover?: (code: number | null) => void;
    transmit?: boolean;
    faceFor?: (row: number, col: number, code: number) => KeyFace; // instead of describe(code)
    noTitles?: boolean;
}

/** A keycode the connected firmware can't do (mouse keys on a build without them). */
const unsupported = (code: number) => isMouseKeycode(code) && mouseKeysSupported() === false;

export const BOARD_W = TOTEM_WIDTH;
export const BOARD_H = TOTEM_HEIGHT;

// How far the halves can move together and still leave one key unit between them.
function halfExtents() {
    let leftMax = -Infinity,
        rightMin = Infinity;
    for (const k of TOTEM_KEYS) {
        const a = (k.r * Math.PI) / 180;
        for (const [dx, dy] of [[0, 0], [k.w, 0], [0, k.h], [k.w, k.h]]) {
            const px = k.x + dx - k.rx,
                py = k.y + dy - k.ry;
            const x = k.rx + px * Math.cos(a) - py * Math.sin(a);
            if (k.row < 4) leftMax = Math.max(leftMax, x);
            else rightMin = Math.min(rightMin, x);
        }
    }
    return Math.max(0, rightMin - leftMax - 1);
}
export const MAX_SQUEEZE = halfExtents();

function fontFor(face: KeyFace, unit: number, w: number): number {
    // Longest word must fit on one line; bold uppercase Inter is about 0.66em per character.
    const words = face.main.split(/[\n ]+/);
    const n = Math.max(1, ...words.map((t) => [...t].length));
    const room = unit * w - unit * 0.06 - 6;
    let f = Math.min(unit * 0.26, room / (n * 0.66));
    if (face.header) f = Math.min(f, unit * 0.23);
    return Math.max(6, Math.round(f * 10) / 10);
}

export function keyFaceNodes(face: KeyFace): Node[] {
    const out: Node[] = [];
    if (face.header) out.push(h("div", { class: "hdr" }, face.header));
    out.push(h("div", { class: "face" }, face.sub ? h("div", { class: ["sub", face.literal && "lit"] }, face.sub) : null, h("div", { class: ["lbl", face.literal && "lit"] }, face.main)));
    return out;
}

export function renderBoard(o: BoardOptions): HTMLElement {
    const gap = Math.max(2, Math.round(o.unit * 0.06));
    const squeeze = Math.min(o.squeeze ?? 0, MAX_SQUEEZE);
    const board = h("div", {
        class: ["board", o.transmit && "transmit"],
        style: { width: `${Math.ceil((BOARD_W - squeeze) * o.unit)}px`, height: `${Math.ceil(BOARD_H * o.unit)}px` },
    });
    for (const g of TOTEM_KEYS) {
        const k = g.row >= 4 ? { ...g, x: g.x - squeeze, rx: g.rx - squeeze } : g;
        const code = o.codeAt(k.row, k.col);
        const face = o.faceFor?.(k.row, k.col, code) ?? describe(code);
        const col = o.color(k.row, k.col);
        const el = h(
            "button",
            {
                class: ["key", face.kind === "trans" && "trans", face.kind === "blank" && "blank", o.selected?.(k.row, k.col) && "sel", unsupported(code) && "unsupported", ...(o.classFor?.(k.row, k.col) ?? [])],
                title: o.noTitles ? undefined : `${face.title}${unsupported(code) ? "\n⚠ This firmware has no mouse keys: this key does nothing." : ""}\nmatrix ${k.row},${k.col}`,
                dataset: { row: String(k.row), col: String(k.col), pos: String(k.row * TOTEM_COLS + k.col) },
                style: {
                    left: `${k.x * o.unit}px`,
                    top: `${k.y * o.unit}px`,
                    width: `${k.w * o.unit - gap}px`,
                    height: `${k.h * o.unit - gap}px`,
                    transform: k.r ? `rotate(${k.r}deg)` : undefined,
                    transformOrigin: k.r ? `${(k.rx - k.x) * o.unit}px ${(k.ry - k.y) * o.unit}px` : undefined,
                    background: col.hex,
                    color: col.fg,
                    fontSize: `${fontFor(face, o.unit, k.w)}px`,
                },
                onClick: (ev: MouseEvent) => {
                    ev.stopPropagation();
                    o.onClick?.(k.row, k.col, ev);
                },
                onMouseenter: () => o.onHover?.(code),
                onMouseleave: () => o.onHover?.(null),
            },
            keyFaceNodes(face),
        );
        board.appendChild(el);
    }
    return board;
}

/** A keycap button for pickers (dark keybard style). */
export function pickKey(code: number, opts: { label?: string; header?: string; cls?: string; onClick?: () => void; disabled?: boolean; title?: string; literal?: boolean } = {}): HTMLButtonElement {
    const face = describe(code);
    const header = opts.header ?? face.header;
    const main = opts.label ?? (face.sub && face.main.length <= 2 ? `${face.sub}\n${face.main}` : face.main);
    return h(
        "button",
        {
            class: ["pk", opts.cls],
            title: opts.title ?? face.title,
            disabled: opts.disabled,
            dataset: { code: String(code) },
            onClick: (ev: MouseEvent) => {
                ev.stopPropagation();
                opts.onClick?.();
            },
        },
        header ? h("span", { class: "pk-h" }, header) : null,
        h("span", { class: (opts.literal ?? (face.literal && opts.label === undefined)) && "lit" }, main === "" && code === 0 ? " " : main),
    );
}

/** A slot in an editor (tap dance action, combo key...). */
export function slotKey(code: number, opts: { on?: boolean; small?: boolean; onClick?: () => void; title?: string }): HTMLButtonElement {
    const face = describe(code);
    return h(
        "button",
        {
            class: ["slot", code !== 0 && "filled", opts.on && "on", opts.small && "sm"],
            title: opts.title ?? face.title,
            onClick: (ev: MouseEvent) => {
                ev.stopPropagation();
                opts.onClick?.();
            },
        },
        face.header ? h("div", { class: "hdr" }, face.header) : null,
        h("div", { class: ["face", face.literal && "lit"] }, face.main),
    );
}

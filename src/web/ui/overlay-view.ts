// The desktop overlay (totem-keybard.html#overlay): your layout drawn see-through, following
// the layer you're on. Runs in the overlay app's transparent window; reads the keyboard
// through the firmware's tagged overlay report, so it never gets in the editor's way.
import { describe, registry, type KeyFace } from "../keycodes";
import { emptyCombo, emptyNames, emptyTapDance, sanitizeNames, TOTEM_COLS, TOTEM_ROWS, type KeyboardData, type Names } from "../model";
import { baseLayer, NoOverlayReport, OverlayBusy, OverlayClient, topLayer, type BoardInfo, type LiveState } from "../overlay-protocol";
import { loadOverlay, OVERLAY_KEY, overlayHost, rgba, type OverlaySettings } from "../overlay-settings";
import { onRender, redetectLayout, reloadPrefs, state, transport, vial } from "../store";
import { DEFAULT_UNLOCK_KEYS, layerColor } from "../totem";
import { BOARD_H, BOARD_W, MAX_SQUEEZE, renderBoard } from "./board";
import { h, mount } from "./dom";

export const STATUS_KEY = "totem-keybard:overlay-status";
export const BOARD_KEY = "totem-keybard:overlay-board";
export const NAMES_PREFIX = "totem-keybard:names:";
const KC_TRNS = 1;

export const IDLE: LiveState = { layerState: 0, defaultLayerState: 1, mods: 0, capsLock: false, capsWord: false, unlocked: false, held: null };

// ---------------------------------------------------------------- drawing (also used by the settings preview)

export interface OverlayFrame {
    keymap: number[][];
    live: LiveState;
    settings: OverlaySettings;
    width: number;
    height: number;
    layerName?: (layer: number) => string | undefined;
    effectAge?: number; // ms since the layer changed (for the flash / fade), or undefined
}

const SHADOW = "0 0 2px rgba(0,0,0,.95), 0 0 4px rgba(0,0,0,.7), 0 1px 1px rgba(0,0,0,.9)";

/** The key's face as the overlay shows it: Shift and letter case applied. */
function overlayFace(code: number, shift: boolean, upper: boolean): KeyFace {
    let f = describe(code);
    if (shift && code > 1 && code <= 0xff && f.kind === "basic") {
        const s = describe(code | 0x0200);
        f = { ...s, header: s.header === "LSFT" ? undefined : s.header, sub: undefined };
    }
    if (f.literal && /^\p{L}$/u.test(f.main)) f = { ...f, main: upper ? f.main.toUpperCase() : f.main.toLowerCase() };
    return f;
}

export function renderOverlay(f: OverlayFrame): HTMLElement {
    const s = f.settings;
    const layers = f.keymap.length;
    const top = Math.min(topLayer(f.live), Math.max(0, layers - 1));
    const base = baseLayer(f.live);
    const on = (((f.live.layerState | f.live.defaultLayerState) >>> 0) || 1) >>> 0;
    const shift = s.shiftLegends && !!(f.live.mods & 0x22);
    const upper = !s.lowercase || (!!(f.live.mods & 0x22) !== f.live.capsLock) || f.live.capsWord;

    // QMK looks a key up from the highest layer that's on down, skipping transparent keys.
    const lookup = (pos: number): { code: number; from: number } => {
        for (let l = Math.min(31, layers - 1); l >= 0; l--) {
            if (!(on & (1 << l))) continue;
            const c = f.keymap[l][pos] ?? 0;
            if (c !== KC_TRNS || !s.throughKeys) return { code: c, from: l };
        }
        return { code: 0, from: base };
    };
    const keys = new Map<number, { code: number; from: number }>();
    const at = (r: number, c: number) => {
        const pos = r * TOTEM_COLS + c;
        let k = keys.get(pos);
        if (!k) keys.set(pos, (k = lookup(pos)));
        return k;
    };

    const name = f.layerName?.(top);
    const titleH = s.showTitle ? Math.max(16, Math.min(30, Math.round(f.height * 0.085))) : 0;
    const squeeze = MAX_SQUEEZE * (1 - s.gap);
    const unit = Math.max(8, Math.min((f.width - 6) / (BOARD_W - squeeze + 0.1), (f.height - titleH - 6) / (BOARD_H + 0.1)));
    const fill = (from: number) => (s.style === "layer" ? layerColor(from).hex : s.keyColor);
    const text = (from: number) => (s.style === "layer" ? layerColor(from).fg : s.textColor);
    const board = renderBoard({
        unit,
        squeeze,
        noTitles: true,
        codeAt: (r, c) => at(r, c).code,
        faceFor: (_r, _c, code) => overlayFace(code, shift, upper),
        color: (r, c) => ({ hex: rgba(fill(at(r, c).from), s.keyAlpha), fg: text(at(r, c).from) }),
        classFor: (r, c) => {
            const pos = r * TOTEM_COLS + c;
            const out: string[] = [];
            if (at(r, c).from !== top) out.push("through");
            if (s.highlightHeld && f.live.held?.[pos]) out.push("held");
            return out;
        },
    });
    // text size
    if (s.textScale !== 1) for (const k of board.querySelectorAll<HTMLElement>(".key")) k.style.fontSize = `${parseFloat(k.style.fontSize) * s.textScale}px`;
    const effect = f.effectAge !== undefined && f.effectAge < 600 && s.layerEffect !== "off" ? s.layerEffect : null;
    const lc = layerColor(top);
    const root = h(
        "div",
        {
            class: ["ovl", s.shadow && "shadow", effect && `ovl-${effect}`, s.show === "layers" && top === base && "ovl-away"],
            style: {
                opacity: String(s.opacity),
                "--ov-outline": rgba(s.outlineColor, s.outlineAlpha),
                "--ov-ow": `${s.outlineWidth}px`,
                "--ov-held": s.heldColor,
                "--ov-flash": lc.hex,
                "--ov-shadow": s.shadow ? SHADOW : "none",
                "--ov-delay": `-${Math.round(f.effectAge ?? 0)}ms`,
            },
            dataset: { layer: String(top) },
        },
        s.showTitle
            ? h(
                  "div",
                  { class: "ovl-title", style: { fontSize: `${Math.round(titleH * 0.62)}px`, height: `${titleH}px`, color: s.style === "light" ? s.textColor : "#fff" } },
                  h("span", { class: "ovl-dot", style: { background: lc.hex } }),
                  h("span", { class: "ovl-name" }, name ?? `Layer ${top}`),
                  name ? h("span", { class: "ovl-num" }, String(top)) : null,
                  shift ? h("span", { class: "ovl-mod" }, "⇧") : null,
                  f.live.capsLock || f.live.capsWord ? h("span", { class: "ovl-mod" }, f.live.capsWord ? "Caps Word" : "Caps") : null,
              )
            : null,
        board,
    );
    return root;
}

// ---------------------------------------------------------------- the overlay window

type Status = "searching" | "loading" | "live" | "noreport" | "error";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function featuresOf(info: BoardInfo): Set<string> {
    const f = new Set<string>();
    if (info.featureBits & 1) f.add("caps_word");
    if (info.featureBits & 2) f.add("layer_lock");
    if (info.vialProtocol >= 5) f.add("persistent_default_layer");
    if (info.altRepeats) f.add("repeat_key");
    return f;
}

function boardData(info: BoardInfo, keymap: number[][]): KeyboardData {
    return {
        name: "TOTEM",
        uid: info.uid,
        viaProtocol: 9,
        vialProtocol: info.vialProtocol,
        rows: info.rows,
        cols: info.cols,
        layers: info.layers,
        keymap,
        macroCount: info.macros,
        macroBufferSize: 0,
        macros: [],
        tapDances: Array.from({ length: info.tapDances }, emptyTapDance),
        combos: Array.from({ length: info.combos }, emptyCombo),
        overrides: [],
        altRepeats: [],
        features: featuresOf(info),
        settings: new Map(),
        names: emptyNames(),
    };
}

/** Names typed in the editor (same app, same storage) or loaded from a .vil in the overlay settings. */
export function storedNames(kb: KeyboardData): Names {
    try {
        return sanitizeNames(JSON.parse(localStorage.getItem(NAMES_PREFIX + (kb.uid ?? "none")) ?? "null"), kb);
    } catch {
        return emptyNames();
    }
}

export function initOverlay(container: HTMLElement) {
    document.documentElement.classList.add("ovl-page");
    const host = overlayHost();
    let settings = loadOverlay();
    let live: LiveState = { ...IDLE };
    let status: Status = "searching";
    let statusText = "Looking for your TOTEM…";
    let adjusting = false;
    let lastTop = -1;
    let changedAt = 0;
    let effectTimer = 0;
    // an unlock in progress: the overlay shows the keys to hold instead of the layout
    let unlock: null | { phase: "start" | "hold" | "done" | "error"; keys: [number, number][]; progress: number; text?: string } = null;

    /** Tell the settings window (storage) and the tray menu (app) what's going on. */
    let reported = "";
    const report = () => {
        try {
            localStorage.setItem(STATUS_KEY, JSON.stringify({ status, text: statusText, layer: topLayer(live), unlocked: live.unlocked, product: transport.productName, at: Date.now() }));
        } catch {
            /* ignore */
        }
        const ks = { connected: !!transport.device, supported: status === "live", unlocked: status === "live" && live.unlocked };
        const sig = JSON.stringify(ks);
        if (sig !== reported) {
            reported = sig;
            host?.reportState(ks);
        }
    };

    const setStatus = (st: Status, txt: string) => {
        status = st;
        statusText = txt;
        report();
        render();
    };

    function render() {
        if (unlock) return mount(container, unlockPanel(unlock));
        const kb = state.kb;
        const age = Date.now() - changedAt;
        const frame = kb
            ? renderOverlay({
                  keymap: kb.keymap,
                  live,
                  settings,
                  width: window.innerWidth,
                  height: window.innerHeight,
                  layerName: (l) => kb.names.layer[String(l)],
                  effectAge: changedAt && age < 600 ? age : undefined,
              })
            : null;
        const showStatus = status !== "live" || adjusting;
        mount(
            container,
            frame,
            showStatus ? h("div", { class: ["ovl-status", status] }, statusText) : null,
            adjusting && host ? adjustUi(host) : null,
        );
    }

    function adjustUi(hst: NonNullable<typeof host>): HTMLElement {
        const grip = h("div", { class: "ovl-grip", title: "Drag to resize" });
        grip.addEventListener("pointerdown", (ev) => {
            ev.preventDefault();
            grip.setPointerCapture(ev.pointerId);
            const x0 = ev.screenX,
                y0 = ev.screenY,
                w0 = window.innerWidth,
                h0 = window.innerHeight;
            const move = (e: PointerEvent) => hst.resizeTo(Math.max(220, Math.round(w0 + e.screenX - x0)), Math.max(110, Math.round(h0 + e.screenY - y0)));
            const up = () => {
                grip.removeEventListener("pointermove", move);
                grip.removeEventListener("pointerup", up);
            };
            grip.addEventListener("pointermove", move);
            grip.addEventListener("pointerup", up);
        });
        return h(
            "div",
            { class: "ovl-adjust" },
            h(
                "div",
                { class: "ovl-adjust-bar" },
                h("span", null, "Drag to move · corner to resize"),
                h("button", { onClick: () => hst.placeBottom() }, "Bottom centre"),
                h("button", { class: "done", onClick: () => hst.setAdjusting(false) }, "Done"),
            ),
            grip,
        );
    }

    // ---- unlock (for the held keys): the overlay shows the keys to hold

    function unlockPanel(u: NonNullable<typeof unlock>): HTMLElement {
        const kb = state.kb;
        const hold = new Set(u.keys.map(([r, c]) => r * TOTEM_COLS + c));
        const base = baseLayer(live);
        const done = u.phase === "done";
        const title = done ? "Unlocked" : u.phase === "error" ? "Couldn't unlock" : "Unlock your TOTEM";
        const text =
            u.phase === "start"
                ? "Asking the keyboard…"
                : u.phase === "hold"
                  ? "Hold the two highlighted keys until the bar is full (a few seconds). To cancel, unplug the keyboard."
                  : done
                    ? "The keys you hold now light up on the overlay, until the TOTEM is unplugged or locked again."
                    : (u.text ?? "");
        const head = Math.max(34, Math.round(window.innerHeight * 0.15));
        const room = { w: window.innerWidth - 28, h: window.innerHeight - head - 34 };
        const squeeze = MAX_SQUEEZE * (1 - settings.gap);
        const unit = Math.max(8, Math.min(room.w / (BOARD_W - squeeze + 0.1), room.h / (BOARD_H + 0.1)));
        const board = renderBoard({
            unit,
            squeeze,
            noTitles: true,
            codeAt: (r, c) => kb?.keymap[base]?.[r * TOTEM_COLS + c] ?? 0,
            color: (r, c) => (hold.has(r * TOTEM_COLS + c) ? { hex: done ? "#099e7c" : "#d8304a", fg: "#fff" } : { hex: "rgba(255, 255, 255, 0.1)", fg: "rgba(255, 255, 255, 0.45)" }),
            classFor: (r, c) => (hold.has(r * TOTEM_COLS + c) && !done ? ["unlock"] : []),
        });
        return h(
            "div",
            { class: ["ovl-unlock", u.phase] },
            h("div", { class: "ovl-unlock-head", style: { height: `${head}px`, fontSize: `${Math.max(11, Math.min(15, Math.round(head * 0.3)))}px` } }, h("b", null, title), h("span", null, text)),
            h("div", { class: "ovl-unlock-board" }, board),
            h("div", { class: "ovl-unlock-bar" }, h("div", { style: { width: `${Math.round(u.progress * 100)}%` } })),
        );
    }

    async function startUnlock() {
        if (unlock) return;
        if (status !== "live" || !transport.device) {
            unlock = { phase: "error", keys: [], progress: 0, text: status === "noreport" ? "This firmware can't show held keys: flash the firmware from the firmware folder." : "The overlay hasn't found your TOTEM yet." };
            host?.setUnlocking(true);
            render();
            await sleep(3500);
            unlock = null;
            host?.setUnlocking(false);
            return render();
        }
        unlock = { phase: "start", keys: DEFAULT_UNLOCK_KEYS, progress: 0 };
        host?.setUnlocking(true);
        render();
        try {
            try {
                const keys = await client.unlockKeys();
                if (keys.length) unlock.keys = keys;
            } catch {
                /* the TOTEM's two top outer keys */
            }
            let p = await client.unlockPoll();
            if (!p.unlocked) {
                if (!p.inProgress) await client.unlockStart();
                unlock.phase = "hold";
                render();
                let max = 1;
                for (;;) {
                    if (!transport.device) throw new Error("The keyboard was unplugged.");
                    p = await client.unlockPoll();
                    if (p.unlocked) break;
                    max = Math.max(max, p.counter);
                    unlock.progress = max ? (max - p.counter) / max : 0;
                    render();
                    await sleep(150);
                }
            }
            unlock.phase = "done";
            unlock.progress = 1;
            live = { ...live, unlocked: true };
            report();
            render();
            await sleep(1800);
        } catch (e) {
            unlock = { ...unlock, phase: "error", text: (e as Error).message };
            render();
            await sleep(3500);
        } finally {
            unlock = null;
            host?.setUnlocking(false);
            render();
        }
    }

    async function lockKeyboard() {
        if (!transport.device) return;
        try {
            await client.lock();
            live = { ...live, unlocked: false, held: null };
            report();
            render();
        } catch {
            /* the next state report says how it is */
        }
    }

    function applyLive(next: LiveState) {
        const sig = JSON.stringify(next);
        if (sig === JSON.stringify(live)) return;
        const t = topLayer(next);
        if (next.unlocked !== live.unlocked) {
            live = next;
            report();
        }
        live = next;
        if (t !== lastTop) {
            if (lastTop !== -1) changedAt = Date.now();
            lastTop = t;
            // run the flash / fade to its end
            clearTimeout(effectTimer);
            effectTimer = window.setTimeout(render, 620);
            setStatus("live", `Following layer ${t}`);
            return;
        }
        render();
    }

    // ---- reading the keyboard

    const client = new OverlayClient(transport);

    async function loadReported(): Promise<number> {
        setStatus("loading", "Reading your layout…");
        const info = await client.info();
        registry.rebuild({ layers: info.layers, macroCount: info.macros, tapDanceCount: info.tapDances, features: featuresOf(info) });
        const keymap = await client.keymap(info.layers, info.rows * info.cols);
        const kb = boardData(info, keymap);
        kb.names = storedNames(kb);
        state.kb = kb;
        try {
            localStorage.setItem(BOARD_KEY, JSON.stringify({ uid: String(info.uid), keymap, names: kb.names, info: { ...info, uid: String(info.uid) } }));
        } catch {
            /* ignore */
        }
        return client.keymapSum();
    }

    async function follow(sum: number) {
        let fails = 0,
            sumAt = Date.now();
        while (transport.device) {
            try {
                const st = await client.state(TOTEM_COLS);
                fails = 0;
                if (status !== "live") setStatus("live", `Following layer ${topLayer(st)}`);
                applyLive(st);
                if (Date.now() - sumAt > 1000) {
                    sumAt = Date.now();
                    const now = await client.keymapSum();
                    if (now !== sum) sum = await loadReported(); // a key was changed (in the editor, or in Vial)
                }
            } catch (e) {
                if (e instanceof OverlayBusy) {
                    await sleep(250);
                    continue;
                }
                if (++fails >= 6) throw e;
            }
            await sleep(30);
        }
    }

    /** Firmware without the overlay report: show the base layer only. */
    async function loadPlain() {
        setStatus("loading", "Reading your layout…");
        const kb = await vial.load();
        kb.names = storedNames(kb);
        state.kb = kb;
        live = { ...IDLE };
        setStatus("noreport", "This firmware can't report layers, so the overlay shows the base layer. Flash the firmware from the firmware folder to follow layers live.");
        while (transport.device) await sleep(1000);
    }

    let busy = false;
    async function attach(how: "reconnect" | "connect"): Promise<boolean> {
        if (transport.device) return true;
        if (busy) return false;
        busy = true;
        try {
            return how === "connect" ? await transport.connect() : await transport.reconnect();
        } catch {
            return false;
        } finally {
            busy = false;
        }
    }
    // The overlay app calls this with a user gesture, so the browser lets it pick the TOTEM.
    (window as unknown as { __overlayConnect: () => Promise<boolean> }).__overlayConnect = () => attach("connect");

    transport.onDisconnect = () => {
        live = { ...IDLE };
        setStatus("searching", "Looking for your TOTEM…");
    };
    report();

    async function run() {
        for (;;) {
            if (!transport.device && !(await attach("reconnect"))) {
                if (status !== "searching") setStatus("searching", "Looking for your TOTEM…");
                await sleep(1500);
                continue;
            }
            try {
                const sum = await loadReported();
                await follow(sum);
            } catch (e) {
                if (e instanceof NoOverlayReport) {
                    try {
                        await loadPlain();
                    } catch (e2) {
                        setStatus("error", (e2 as Error).message);
                    }
                } else if (transport.device) setStatus("error", `Lost track of the keyboard (${(e as Error).message}). Trying again…`);
            }
            await sleep(1000);
        }
    }

    // ---- settings from the settings window and the editor (same app, same storage)
    window.addEventListener("storage", (e) => {
        if (e.key === OVERLAY_KEY) settings = loadOverlay();
        else if (e.key === "totem-keybard:prefs") reloadPrefs();
        else if (e.key?.startsWith(NAMES_PREFIX) && state.kb) state.kb.names = storedNames(state.kb);
        else return;
        render();
    });
    window.addEventListener("resize", () => render());
    // unlock / lock, from the tray menu or the settings window (and tests)
    const command = (c: "unlock" | "lock") => void (c === "unlock" ? startUnlock() : lockKeyboard());
    host?.onCommand(command);
    (window as unknown as { __overlayCommand: typeof command }).__overlayCommand = command;
    host?.onAdjusting((on) => {
        adjusting = on;
        render();
    });
    if (navigator.hid) navigator.hid.addEventListener("connect", () => void attach("reconnect"));
    onRender("panel", () => render()); // the computer's layout changed
    redetectLayout().then(render);
    window.addEventListener("focus", () => redetectLayout());
    render();
    if (!navigator.hid) setStatus("error", "This browser can't talk to keyboards (no WebHID).");
    else void run();
}

/** For tests and the settings preview: the overlay's idea of the rows × cols. */
export const KEYS_PER_LAYER = TOTEM_ROWS * TOTEM_COLS;

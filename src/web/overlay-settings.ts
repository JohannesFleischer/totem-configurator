// What the desktop overlay looks like and does. Kept in localStorage; the overlay and its
// settings window are pages of the same app, so a change shows on the overlay at once
// (through the "storage" event).

export type OverlayStyle = "dark" | "subtle" | "outline" | "light" | "contrast" | "layer" | "custom";

export interface OverlaySettings {
    style: OverlayStyle;
    keyColor: string; // key fill
    keyAlpha: number; // 0..1
    textColor: string;
    outlineColor: string;
    outlineAlpha: number; // 0..1
    outlineWidth: number; // px
    shadow: boolean; // dark halo around legends, for any background
    opacity: number; // the whole overlay, 0.1..1
    textScale: number; // 0.7..1.6
    gap: number; // 0..1: how far apart the two halves are drawn
    show: "always" | "layers"; // "layers": only while a layer other than the base layer is on
    layerEffect: "off" | "flash" | "fade"; // when the layer changes
    showTitle: boolean; // layer name above the keys
    throughKeys: boolean; // transparent keys show the key underneath, dimmed
    lowercase: boolean; // letters in lowercase, capitals while Shift / Caps Lock / Caps Word is on
    shiftLegends: boolean; // while Shift is held, show what keys type with Shift
    highlightHeld: boolean; // keys you hold light up (keyboard must be unlocked)
    heldColor: string;
}

export const STYLE_NAMES: Record<OverlayStyle, string> = {
    dark: "Dark",
    subtle: "Subtle",
    outline: "Outline only",
    light: "Light",
    contrast: "High contrast",
    layer: "Layer colours",
    custom: "Custom",
};

type Look = Pick<OverlaySettings, "keyColor" | "keyAlpha" | "textColor" | "outlineColor" | "outlineAlpha" | "outlineWidth" | "shadow">;
export const PRESETS: Record<Exclude<OverlayStyle, "custom">, Look> = {
    dark: { keyColor: "#16171a", keyAlpha: 0.72, textColor: "#ffffff", outlineColor: "#ffffff", outlineAlpha: 0.18, outlineWidth: 1, shadow: true },
    subtle: { keyColor: "#000000", keyAlpha: 0.22, textColor: "#ffffff", outlineColor: "#ffffff", outlineAlpha: 0.12, outlineWidth: 1, shadow: true },
    outline: { keyColor: "#000000", keyAlpha: 0, textColor: "#ffffff", outlineColor: "#ffffff", outlineAlpha: 0.85, outlineWidth: 1.5, shadow: true },
    light: { keyColor: "#ffffff", keyAlpha: 0.82, textColor: "#16171a", outlineColor: "#000000", outlineAlpha: 0.15, outlineWidth: 1, shadow: false },
    contrast: { keyColor: "#000000", keyAlpha: 0.92, textColor: "#ffe14d", outlineColor: "#ffe14d", outlineAlpha: 1, outlineWidth: 2, shadow: false },
    layer: { keyColor: "#099e7c", keyAlpha: 0.82, textColor: "#ffffff", outlineColor: "#ffffff", outlineAlpha: 0, outlineWidth: 1, shadow: true },
};

export const DEFAULT_OVERLAY: OverlaySettings = {
    style: "dark",
    ...PRESETS.dark,
    opacity: 0.9,
    textScale: 1,
    gap: 0.5,
    show: "always",
    layerEffect: "flash",
    showTitle: true,
    throughKeys: true,
    lowercase: false,
    shiftLegends: true,
    highlightHeld: true,
    heldColor: "#ff4d6d",
};

export const OVERLAY_KEY = "totem-keybard:overlay";

const clamp = (v: unknown, lo: number, hi: number, def: number) => (typeof v === "number" && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
const color = (v: unknown, def: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : def);
const oneOf = <T extends string>(v: unknown, list: readonly T[], def: T): T => (list.includes(v as T) ? (v as T) : def);
const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);

/** Settings from storage, with anything missing or broken replaced by the default. */
export function sanitizeOverlay(raw: unknown): OverlaySettings {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const d = DEFAULT_OVERLAY;
    return {
        style: oneOf(r.style, Object.keys(STYLE_NAMES) as OverlayStyle[], d.style),
        keyColor: color(r.keyColor, d.keyColor),
        keyAlpha: clamp(r.keyAlpha, 0, 1, d.keyAlpha),
        textColor: color(r.textColor, d.textColor),
        outlineColor: color(r.outlineColor, d.outlineColor),
        outlineAlpha: clamp(r.outlineAlpha, 0, 1, d.outlineAlpha),
        outlineWidth: clamp(r.outlineWidth, 0, 4, d.outlineWidth),
        shadow: bool(r.shadow, d.shadow),
        opacity: clamp(r.opacity, 0.1, 1, d.opacity),
        textScale: clamp(r.textScale, 0.7, 1.6, d.textScale),
        gap: clamp(r.gap, 0, 1, d.gap),
        show: oneOf(r.show, ["always", "layers"] as const, d.show),
        layerEffect: oneOf(r.layerEffect, ["off", "flash", "fade"] as const, d.layerEffect),
        showTitle: bool(r.showTitle, d.showTitle),
        throughKeys: bool(r.throughKeys, d.throughKeys),
        lowercase: bool(r.lowercase, d.lowercase),
        shiftLegends: bool(r.shiftLegends, d.shiftLegends),
        highlightHeld: bool(r.highlightHeld, d.highlightHeld),
        heldColor: color(r.heldColor, d.heldColor),
    };
}

export function loadOverlay(): OverlaySettings {
    try {
        return sanitizeOverlay(JSON.parse(localStorage.getItem(OVERLAY_KEY) ?? "{}"));
    } catch {
        return { ...DEFAULT_OVERLAY };
    }
}

export function saveOverlay(s: OverlaySettings) {
    try {
        localStorage.setItem(OVERLAY_KEY, JSON.stringify(s));
    } catch {
        /* storage blocked */
    }
}

/** Pick a look: its colours replace the current ones. */
export function withStyle(s: OverlaySettings, style: OverlayStyle): OverlaySettings {
    return style === "custom" ? { ...s, style } : { ...s, style, ...PRESETS[style] };
}

/** "#rrggbb" + alpha -> rgba() */
export function rgba(hex: string, a: number): string {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(a * 1000) / 1000})`;
}

/** What the overlay app (Electron) offers the pages; absent in a normal browser. */
export interface OverlayHost {
    version: string;
    setAdjusting(on: boolean): void; // overlay takes the mouse so it can be moved and resized
    resizeTo(width: number, height: number): void;
    moveBy(dx: number, dy: number): void;
    getBounds(): Promise<{ x: number; y: number; width: number; height: number; screen: { x: number; y: number; width: number; height: number } }>;
    placeBottom(): void;
    setVisible(on: boolean): void;
    openSettings(): void;
    openEditor(): void;
    onAdjusting(fn: (on: boolean) => void): void;
    unlock(): void; // ask the overlay to unlock the keyboard (it shows the keys to hold)
    lock(): void;
    reportState(s: KeyboardState): void; // the overlay tells the app (tray menu) about the keyboard
    setUnlocking(on: boolean): void; // the overlay shows the unlock keys: keep it on screen
    onCommand(fn: (command: "unlock" | "lock") => void): void;
}

/** What the overlay knows about the keyboard, for the tray menu and the settings window. */
export interface KeyboardState {
    connected: boolean;
    supported: boolean; // the firmware has the overlay report
    unlocked: boolean;
}

export function overlayHost(): OverlayHost | null {
    return (window as unknown as { overlayHost?: OverlayHost }).overlayHost ?? null;
}

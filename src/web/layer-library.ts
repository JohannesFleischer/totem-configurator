// Stored layers: whole layers kept aside in the app (not on the keyboard), to load into a layer
// when you want them, e.g. a Colemak and a Neo base layer. Kept in this app's storage, the keys
// by name like in .vil files (so they survive keycode renumbering).
import { deserialize, serialize } from "./keycodes";

export interface StoredLayer {
    id: string;
    name: string;
    keys: string[]; // one per matrix position
    saved: number; // when it was stored (ms)
    from?: string; // where it came from: "TOTEM", a .vil file, …
}

const KEY = "totem-keybard:stored-layers";
let cache: StoredLayer[] | null = null;

const valid = (e: unknown): e is StoredLayer =>
    !!e && typeof e === "object" && typeof (e as StoredLayer).id === "string" && typeof (e as StoredLayer).name === "string" && Array.isArray((e as StoredLayer).keys);

export function storedLayers(): StoredLayer[] {
    if (!cache) {
        try {
            const v = JSON.parse(localStorage.getItem(KEY) || "[]");
            cache = Array.isArray(v) ? v.filter(valid) : [];
        } catch {
            cache = [];
        }
    }
    return cache;
}

function persist() {
    try {
        localStorage.setItem(KEY, JSON.stringify(cache ?? []));
    } catch {
        /* storage unavailable: kept for this session only */
    }
}

/** The keycodes of a stored layer, for a layer of `size` positions (missing ones: KC_NO). */
export function codesOf(e: StoredLayer, size: number): number[] {
    return Array.from({ length: size }, (_, i) => (e.keys[i] === undefined ? 0 : deserialize(e.keys[i])));
}

/** Nothing on it: only KC_NO and KC_TRNS. */
export const isEmptyLayer = (codes: number[]) => codes.every((c) => c === 0 || c === 1);

/** Store a layer, unless the same keys are stored already (then that one is returned). */
export function addStoredLayer(name: string, codes: number[], from?: string): { entry: StoredLayer; added: boolean } {
    const keys = codes.map(serialize);
    const dup = storedLayers().find((e) => e.keys.length === keys.length && e.keys.every((k, i) => k === keys[i]));
    if (dup) return { entry: dup, added: false };
    const entry: StoredLayer = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name: name.trim().slice(0, 40) || "Layer", keys, saved: Date.now(), from };
    storedLayers().unshift(entry);
    persist();
    return { entry, added: true };
}

export function renameStoredLayer(id: string, name: string) {
    const e = storedLayers().find((x) => x.id === id);
    if (!e || !name.trim()) return;
    e.name = name.trim().slice(0, 40);
    persist();
}

export function removeStoredLayer(id: string) {
    cache = storedLayers().filter((x) => x.id !== id);
    persist();
}

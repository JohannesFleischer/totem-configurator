// TOTEM specifics: matrix, physical order, demo keymap, layer colours.
import { parseKeycode, registry } from "./keycodes";
import { emptyCombo, emptyNames, emptyOverride, emptyTapDance, TOTEM_COLS, TOTEM_ROWS, type KeyboardData } from "./model";
import { TOTEM_UID } from "./vial";

// QMK LAYOUT() argument order -> matrix [row, col] (from keyboard.json of geigeigeist/totem).
// L = left half (rows 0-3), R = right half (rows 4-7, columns mirrored).
export const LAYOUT_ORDER: [number, number][] = [
    [0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [4, 4], [4, 3], [4, 2], [4, 1], [4, 0],
    [1, 0], [1, 1], [1, 2], [1, 3], [1, 4], [5, 4], [5, 3], [5, 2], [5, 1], [5, 0],
    [3, 0], [2, 0], [2, 1], [2, 2], [2, 3], [2, 4], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0], [7, 0],
    [3, 2], [3, 3], [3, 4], [7, 4], [7, 3], [7, 2],
];

// Keys to hold for a Vial unlock on the TOTEM (VIAL_UNLOCK_COMBO_ROWS/COLS {0,4}/{0,0}).
export const DEFAULT_UNLOCK_KEYS: [number, number][] = [
    [0, 0],
    [4, 0],
];

// keybard's layer palette (src/utils/colors.ts)
export const LAYER_COLORS = [
    { name: "green", hex: "#099e7c", fg: "#fff" },
    { name: "blue", hex: "#379cd7", fg: "#fff" },
    { name: "purple", hex: "#8672b5", fg: "#fff" },
    { name: "orange", hex: "#f89804", fg: "#fff" },
    { name: "magenta", hex: "#b5508a", fg: "#fff" },
    { name: "brown", hex: "#b39369", fg: "#fff" },
    { name: "red", hex: "#d8304a", fg: "#fff" },
    { name: "yellow", hex: "#ffc222", fg: "#7c2d12" },
    { name: "grey", hex: "#85929b", fg: "#fff" },
];
export const layerColor = (l: number) => LAYER_COLORS[l % LAYER_COLORS.length];

// The TOTEM's own default keymap (GEIGEIGEIST/TOTEM vial keymap), with its custom
// keycodes swapped for standard ones: LOWER/RAISE/ADJUST -> MO(2)/MO(3)/MO(4),
// QWERTY/COLEMAK -> PDF(0)/PDF(1), OS_SWAP -> CG_TOGG, SNAP -> LSG(KC_S).
const ___ = "KC_TRNS",
    XXX = "KC_NO";
const DEMO_LAYERS: { name: string; keys: string[] }[] = [
    {
        name: "QWERTY",
        keys: [
            "KC_Q", "KC_W", "KC_E", "KC_R", "KC_T", "KC_Y", "KC_U", "KC_I", "KC_O", "KC_P",
            "LGUI_T(KC_A)", "LALT_T(KC_S)", "LCTL_T(KC_D)", "LSFT_T(KC_F)", "KC_G", "KC_H", "RSFT_T(KC_J)", "LCTL_T(KC_K)", "LALT_T(KC_L)", "LGUI_T(KC_SCLN)",
            "KC_Q", "KC_Z", "KC_X", "KC_C", "KC_V", "KC_B", "KC_N", "KC_M", "KC_COMM", "KC_DOT", "KC_SLSH", "KC_P",
            "KC_DEL", "MO(2)", "KC_SPC", "KC_ENT", "MO(3)", "KC_BSPC",
        ],
    },
    {
        name: "COLEMAK",
        keys: [
            "KC_Q", "KC_W", "KC_F", "KC_P", "KC_G", "KC_J", "KC_L", "KC_U", "KC_Y", "KC_SCLN",
            "LGUI_T(KC_A)", "LALT_T(KC_R)", "LCTL_T(KC_S)", "LSFT_T(KC_T)", "KC_D", "KC_H", "RSFT_T(KC_N)", "LCTL_T(KC_E)", "LALT_T(KC_I)", "LGUI_T(KC_O)",
            "KC_Q", "KC_Z", "KC_X", "KC_C", "KC_V", "KC_B", "KC_K", "KC_M", "KC_COMM", "KC_DOT", "KC_SLSH", "KC_SCLN",
            "KC_DEL", "MO(2)", "KC_SPC", "KC_ENT", "MO(3)", "KC_BSPC",
        ],
    },
    {
        name: "LOWER",
        keys: [
            "KC_CAPS", "KC_NUMLOCK", "KC_UP", "KC_EQL", "KC_LCBR", "KC_RCBR", "KC_P7", "KC_P8", "KC_P9", "KC_PPLS",
            "KC_HOME", "KC_LEFT", "KC_DOWN", "KC_RGHT", "KC_LBRC", "KC_RBRC", "KC_P4", "KC_P5", "KC_P6", "KC_MINS",
            "LSG(KC_S)", "KC_END", "KC_PGUP", "LCTL(KC_S)", "KC_PGDN", "KC_LPRN", "KC_RPRN", "KC_P1", "KC_P2", "KC_P3", "KC_PAST", ___,
            ___, ___, ___, ___, "MO(4)", "KC_P0",
        ],
    },
    {
        name: "RAISE",
        keys: [
            "KC_EXLM", "KC_AT", "KC_HASH", "KC_DLR", "KC_PERC", "KC_CIRC", "KC_AMPR", "RALT(KC_U)", "RALT(KC_3)", "KC_BSLS",
            "RALT(KC_A)", "RALT(KC_F)", "RALT(KC_S)", "RALT(KC_G)", XXX, XXX, "LSFT(RALT(KC_4))", "RALT(KC_5)", "RALT(KC_4)", "RALT(KC_O)",
            XXX, "LSFT(KC_GRV)", "KC_TILD", "RALT(KC_C)", XXX, XXX, XXX, XXX, XXX, "DM_REC1", "DM_RSTP", "DM_PLY1",
            ___, "MO(4)", ___, ___, ___, ___,
        ],
    },
    {
        name: "ADJUST",
        keys: [
            "QK_BOOT", XXX, XXX, XXX, XXX, XXX, "KC_F7", "KC_F8", "KC_F9", "KC_F12",
            XXX, "PDF(0)", XXX, XXX, XXX, XXX, "KC_F4", "KC_F5", "KC_F6", "KC_F11",
            XXX, "CG_TOGG", "PDF(1)", XXX, XXX, XXX, XXX, "KC_F1", "KC_F2", "KC_F3", "KC_F10", "KC_F13",
            ___, ___, ___, ___, ___, ___,
        ],
    },
];

export function demoKeyboard(): KeyboardData {
    const layers = DEMO_LAYERS.length;
    const features = new Set(["caps_word", "persistent_default_layer"]);
    registry.rebuild({ layers, macroCount: 16, tapDanceCount: 32, features });
    const keymap = DEMO_LAYERS.map((layer) => {
        const out = new Array(TOTEM_ROWS * TOTEM_COLS).fill(0);
        layer.keys.forEach((k, i) => {
            const [r, c] = LAYOUT_ORDER[i];
            out[r * TOTEM_COLS + c] = parseKeycode(k);
        });
        return out;
    });
    const tapDances = Array.from({ length: 32 }, emptyTapDance);
    const combos = Array.from({ length: 32 }, emptyCombo);
    const overrides = Array.from({ length: 32 }, emptyOverride).map((o) => ({ ...o, options: 0 }));
    return {
        name: "TOTEM (demo)",
        uid: TOTEM_UID,
        viaProtocol: 9,
        vialProtocol: 6,
        rows: TOTEM_ROWS,
        cols: TOTEM_COLS,
        layers,
        keymap,
        macroCount: 16,
        macroBufferSize: 900,
        macros: Array.from({ length: 16 }, () => []),
        tapDances,
        combos,
        overrides,
        altRepeats: [],
        features,
        settings: new Map([[7, 170]]),
        names: { ...emptyNames(), layer: { "0": "QWERTY", "1": "Colemak", "2": "Lower", "3": "Raise", "4": "Adjust" } },
    };
}

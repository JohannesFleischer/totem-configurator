// bun test — keycode naming/parsing must match the Vial GUI exactly (for .vil compatibility).
import { describe as group, expect, test } from "bun:test";
import { decodeMacro, encodeMacro } from "../web/model";
import { describe, parseKeycode, registry, serialize } from "../web/keycodes";

registry.rebuild({ layers: 5, macroCount: 16, tapDanceCount: 8, features: new Set(["caps_word", "persistent_default_layer"]) });

group("serialize (Vial names)", () => {
    const cases: [number, string][] = [
        [0x0000, "KC_NO"],
        [0x0001, "KC_TRNS"],
        [0x0004, "KC_A"],
        [0x002a, "KC_BSPACE"],
        [0x0235, "LSFT(KC_GRAVE)"], // KC_TILD is stored as LSFT(KC_GRAVE) by Vial
        [0x021e, "LSFT(KC_1)"],
        [0x0329, "C_S(KC_ESCAPE)"],
        [0x0f04, "HYPR(KC_A)"],
        [0x1404, "RALT(KC_A)"],
        [0x2104, "LCTL_T(KC_A)"],
        [0x2f04, "ALL_T(KC_A)"],
        [0x3204, "RSFT_T(KC_A)"],
        [0x2b04, "0x2b04"], // Ctl+Sft+Gui mod-tap has no Vial name
        [0x412c, "LT1(KC_SPACE)"],
        [0x452c, "0x452c"], // LT5 on a 5-layer board isn't registered by Vial either
        [0x5221, "MO(1)"],
        [0x5204, "TO(4)"],
        [0x52e2, "PDF(2)"],
        [0x52a2, "OSM(MOD_LSFT)"],
        [0x52af, "OSM(MOD_HYPR)"],
        [0x5701, "TD(1)"],
        [0x57ff, "TD(255)"],
        [0x7700, "M0"],
        [0x7c00, "QK_BOOT"],
        [0x7c73, "QK_CAPS_WORD_TOGGLE"],
        [0x7e00, "USER00"],
        [0x7e40, "0x7e40"],
        [0x5000, "0x5000"],
        [0x7017, "MAGIC_SWAP_LCTL_LGUI"],
        [0x701d, "MAGIC_TOGGLE_CTL_GUI"],
    ];
    for (const [code, name] of cases) test(`${code.toString(16)} -> ${name}`, () => expect(serialize(code)).toBe(name));
});

group("parse names, aliases and expressions", () => {
    const cases: [string, number][] = [
        ["KC_A", 0x04],
        ["KC_ENT", 0x28],
        ["KC_TILD", 0x235],
        ["LSFT(KC_GRAVE)", 0x235],
        ["LCTL_T(KC_A)", 0x2104],
        ["CTL_T(KC_A)", 0x2104],
        ["MT(MOD_LCTL|MOD_LSFT, KC_A)", 0x2304],
        ["LT(2, KC_SPC)", 0x422c],
        ["LT2(KC_SPACE)", 0x422c],
        ["MO(3)", 0x5223],
        ["MO(20)", 0x5234],
        ["TO(1)", 0x5201],
        ["OSM(MOD_LSFT)", 0x52a2],
        ["OSM(MOD_LSFT|MOD_LALT)", 0x52a6],
        ["LM(1, MOD_LSFT)", 0x5022],
        ["TD(5)", 0x5705],
        ["M3", 0x7703],
        ["QK_BOOT", 0x7c00],
        ["RESET", 0x7c00],
        ["CW_TOGG", 0x7c73],
        ["0x7e40", 0x7e40],
        ["LCTL(LSFT(KC_ESC))", 0x0329],
        ["C(KC_S)", 0x0116],
        ["LSFT(RALT(KC_4))", 0x1621],
        ["HYPR_T(KC_A)", 0x2f04],
        ["ALL_T(KC_A)", 0x2f04],
    ];
    for (const [s, code] of cases) test(`${s} -> 0x${code.toString(16)}`, () => expect(parseKeycode(s)).toBe(code));
    test("bad input throws", () => {
        expect(() => parseKeycode("KC_NOPE")).toThrow();
        expect(() => parseKeycode("LT(1,")).toThrow();
    });
    test("every serialized name parses back", () => {
        for (let code = 0; code < 0x8000; code += 7) expect(parseKeycode(serialize(code))).toBe(code);
    });
});

group("key faces", () => {
    test("shifted symbol shows the symbol", () => expect(describe(0x21e).main).toBe("!"));
    test("mod-tap has a header", () => expect(describe(0x2104)).toMatchObject({ header: "LCTL_T", main: "A", kind: "modtap" }));
    test("layer tap", () => expect(describe(0x412c)).toMatchObject({ header: "LT1", main: "Space", kind: "layertap" }));
    test("layer key", () => expect(describe(0x5223)).toMatchObject({ header: "MO", main: "3", layer: 3 }));
});

group("macros (Vial protocol 6 encoding)", () => {
    test("text, tap, down/up with 16-bit keycodes and delays round-trip", () => {
        const m = [
            { type: "text" as const, text: "Hi!" },
            { type: "tap" as const, keys: [0x28, 0x04] },
            { type: "down" as const, keys: [0x0100] },
            { type: "up" as const, keys: [0x2104] },
            { type: "delay" as const, ms: 1000 },
        ];
        const bytes = encodeMacro(m, 6);
        expect(bytes.slice(0, 3)).toEqual([72, 105, 33]);
        expect(bytes.slice(3, 9)).toEqual([1, 1, 0x28, 1, 1, 0x04]);
        expect(bytes.slice(9, 13)).toEqual([1, 6, 0x01, 0xff]); // LCTL(KC_NO) -> 0xFF01 (decode_keycode)
        expect(decodeMacro(bytes)).toEqual(m);
    });
    test("non-ASCII text is dropped", () => expect(encodeMacro([{ type: "text", text: "aäb" }], 6)).toEqual([97, 98]));
});

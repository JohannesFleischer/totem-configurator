// bun test — computer keyboard layouts: labels, detection, macro text.
import { afterEach, describe as group, expect, test } from "bun:test";
import {
    charFor,
    guessFromLanguage,
    keycodeFor,
    LAYOUT_LIST,
    layoutById,
    matchLayoutMap,
    setActiveLayout,
    textAsTyped,
    textToKeycodes,
    US,
} from "../web/hostlayout";
import { describe, registry } from "../web/keycodes";

registry.rebuild({ layers: 5, macroCount: 16, tapDanceCount: 8, features: new Set() });
const german = layoutById("german")!;
const french = layoutById("french")!;
afterEach(() => setActiveLayout(US));

// A US-layout map as Chrome's navigator.keyboard.getLayoutMap() reports it, and edits of it.
const usMap = (): Map<string, string> => {
    const m = new Map<string, string>();
    for (let i = 0; i < 26; i++) m.set("Key" + String.fromCharCode(65 + i), String.fromCharCode(97 + i));
    for (let i = 0; i <= 9; i++) m.set("Digit" + i, String(i));
    Object.entries({ Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Backquote: "`", Comma: ",", Period: ".", Slash: "/" }).forEach(([k, v]) => m.set(k, v));
    return m;
};
const germanMap = () => {
    const m = usMap();
    Object.entries({ KeyY: "z", KeyZ: "y", Minus: "ß", Equal: "´", BracketLeft: "ü", BracketRight: "+", Backslash: "#", Semicolon: "ö", Quote: "ä", Backquote: "^", Slash: "-", IntlBackslash: "<" }).forEach(([k, v]) => m.set(k, v));
    return m;
};

group("labels", () => {
    test("US is the default and matches Vial", () => {
        expect(describe(0x1c).main).toBe("Y");
        expect(describe(0x1e)).toMatchObject({ main: "1", sub: "!" });
        expect(describe(0x21f).main).toBe("@");
    });
    test("German: keys show what they type", () => {
        setActiveLayout(german);
        expect(describe(0x1c).main).toBe("Z"); // KC_Y
        expect(describe(0x1d).main).toBe("Y"); // KC_Z
        expect(describe(0x2d)).toMatchObject({ main: "ß", sub: "?" }); // KC_MINUS
        expect(describe(0x1f)).toMatchObject({ main: "2", sub: '"' });
        expect(describe(0x21f).main).toBe('"'); // LSFT(KC_2)
        expect(describe(0x1414).main).toBe("@"); // RALT(KC_Q)
        expect(describe(0x31).main).toBe("#"); // KC_BSLS is the ISO # key on Windows/Linux
        expect(describe(0xe6).main).toBe("AltGr");
        expect(describe(0x1c).title).toContain("types “z” on German");
        expect(describe(0x21c).title).toContain("types “Z” on German");
        expect(describe(0x2104)).toMatchObject({ header: "LCTL_T", main: "A" });
        expect(describe(0x211c)).toMatchObject({ header: "LCTL_T", main: "Z" }); // mod-tap shows the layout's character
    });
    test("French AZERTY", () => {
        setActiveLayout(french);
        expect(describe(0x14).main).toBe("A"); // KC_Q
        expect(describe(0x1e)).toMatchObject({ main: "&", sub: "1" });
    });
    test("dead keys are marked in the title", () => {
        setActiveLayout(german);
        expect(describe(0x2e).title).toContain("dead key");
    });
    test("every layout parses and Latin ones label all letters", () => {
        for (const l of LAYOUT_LIST) {
            for (let kc = 0x04; kc <= 0x1d; kc++) charFor(kc, l);
        }
        for (const id of ["us", "uk", "german", "french", "spanish", "swedish", "colemak", "dvorak"]) {
            const l = layoutById(id)!;
            for (let kc = 0x04; kc <= 0x38; kc++) if (![0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x31, 0x32].includes(kc)) expect(charFor(kc, l)?.ch).toBeTruthy();
        }
    });
});

group("text <-> keycodes", () => {
    test("shortest keycode for a character", () => {
        expect(keycodeFor("z", german)).toBe(0x1c);
        expect(keycodeFor("Z", german)).toBe(0x21c);
        expect(keycodeFor("@", german)).toBe(0x1414);
        expect(keycodeFor("ä", german)).toBe(0x34);
        expect(keycodeFor("\n", german)).toBe(0x28);
        expect(keycodeFor("a", french)).toBe(0x14);
    });
    test("macro text comes out as on a US keyboard", () => {
        expect(textAsTyped("yz", US)).toBe("yz");
        expect(textAsTyped("yz", german)).toBe("zy");
        expect(textAsTyped("a-b", german)).toBe("aßb");
        expect(textAsTyped("Hello", german)).toBe("Hello");
    });
    test("text to key taps", () => {
        expect(textToKeycodes("Grüße z@", german)).toEqual({ codes: [0x20a, 0x15, 0x2f, 0x2d, 0x08, 0x2c, 0x1c, 0x1414], missing: [] });
        expect(textToKeycodes("ä", US).missing).toEqual(["ä"]);
    });
});

group("detection", () => {
    test("matches the system layout map", () => {
        expect(matchLayoutMap(usMap(), "en-US", false).layout?.id).toBe("us");
        expect(matchLayoutMap(germanMap(), "en-US", false).layout?.id).toBe("german");
        expect(matchLayoutMap(germanMap(), "de-DE", true).layout?.id).toBe("german_mac_iso");
    });
    test("ties are broken by the browser language", () => {
        const sv = new Map(usMap());
        Object.entries({ Minus: "+", BracketLeft: "å", Semicolon: "ö", Quote: "ä", Backquote: "§", Slash: "-", IntlBackslash: "<", Backslash: "'", BracketRight: "¨", Equal: "´" }).forEach(([k, v]) => sv.set(k, v));
        expect(matchLayoutMap(sv, "fi-FI", false).layout?.id).toBe("finnish");
        expect(matchLayoutMap(sv, "sv-SE", false).layout?.id).toBe("swedish");
    });
    test("an unknown layout still shows the base characters", () => {
        const m = usMap();
        for (const k of [...m.keys()]) m.set(k, "ب");
        const d = matchLayoutMap(m, "ar", false);
        expect(d.layout?.id).toBe("system");
        setActiveLayout(d.layout!);
        expect(describe(0x04).main).toBe("ب");
    });
    test("language guesses", () => {
        expect(guessFromLanguage("de-CH", false)?.id).toBe("swiss_de");
        expect(guessFromLanguage("fr-CA", false)?.id).toBe("canadian_french");
        expect(guessFromLanguage("pt-BR", false)?.id).toBe("brazilian_abnt2");
        expect(guessFromLanguage("de", true)?.id).toBe("german_mac_iso");
        expect(guessFromLanguage("xx", false)).toBeNull();
    });
});

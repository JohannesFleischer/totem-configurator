// The editor's idea of the firmware's layer lights matches the firmware source (in the patch).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DEFAULT_BRIGHTNESS, DEFAULT_LIGHTS, DEFAULT_SPEED, EFFECTS, LIGHTS_VERSION } from "../web/overlay-protocol";

const patch = readFileSync(new URL("../../firmware/vial-qmk-totem-keybard.patch", import.meta.url), "utf8");
const file = (name: string) => {
    const at = patch.indexOf(`+++ b/keyboards/geigeigeist/totem/keymaps/vial/${name}`);
    expect(at).toBeGreaterThan(-1);
    const end = patch.indexOf("\ndiff --git", at);
    return patch.slice(at, end < 0 ? undefined : end);
};

test("default colours and brightness are the firmware's", () => {
    const c = file("layer_lights.c");
    const block = c.slice(c.indexOf("static const lights_t defaults"), c.indexOf("};", c.indexOf("static const lights_t defaults")));
    const colors = [...block.matchAll(/\{(\d+), (\d+), (\d+)\}/g)].map((m) => [1, 2, 3].map((i) => Number(m[i])));
    expect(colors).toEqual(DEFAULT_LIGHTS);
    expect(block).toContain(`+    ${DEFAULT_BRIGHTNESS},\n`);
});

test("the firmware reports the version the editor expects for lights, and keeps 16 layers", () => {
    expect(file("overlay_report.c")).toContain(`#define OVL_VERSION ${LIGHTS_VERSION}`);
    expect(file("layer_lights.h")).toContain("#define LIGHT_LAYERS 16");
    expect(DEFAULT_LIGHTS).toHaveLength(16);
    expect(file("config.h")).toContain("#define EECONFIG_USER_DATA_SIZE 69"); // magic, brightness, timeout (2), speed, 16 x RGB, 16 x effect
    expect(file("layer_lights.h")).toContain("LIGHT_STATIC = 0, LIGHT_BREATHE = 1, LIGHT_RAINBOW = 2");
    expect([...EFFECTS]).toEqual(["Steady", "Breathe", "Rainbow"]);
    expect(file("layer_lights.c")).toContain(`+    ${DEFAULT_SPEED},\n`);
});

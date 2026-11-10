// Settings, key tester and about panels.
import { QMK_SETTINGS } from "../qmk-settings";
import { overlayHost } from "../overlay-settings";
import { DEFAULT_BRIGHTNESS, DEFAULT_LIGHTS, DEFAULT_SPEED, EFFECTS, type Rgb } from "../overlay-protocol";
import {
    checkOverlaySupport,
    ensureUnlocked,
    invalidate,
    lockKeyboard,
    nameOf,
    onLightsNote,
    readLights,
    savePrefs,
    setLayerEffect,
    setLayerLight,
    setLightBrightness,
    setLightSpeed,
    setLightTimeout,
    startTester,
    state,
    stopTester,
    updateSetting,
} from "../store";
import { layerColor } from "../totem";
import { h } from "./dom";
import { layoutSelect } from "./picker";

declare const __BUILD__: string;

export function settingsPanel(): HTMLElement {
    const kb = state.kb;
    const p = state.prefs;
    const appSection = h(
        "section",
        null,
        h("h3", null, "Editor"),
        h(
            "div",
            { class: "checks" },
            h("label", null, h("input", { type: "checkbox", checked: p.typingAssigns, onChange: (e: Event) => savePrefs({ typingAssigns: (e.target as HTMLInputElement).checked }) }), h("span", null, "Typing on your computer keyboard assigns that key to the selected TOTEM key or slot")),
            h("label", null, h("input", { type: "checkbox", checked: p.advanceAfterTyping, onChange: (e: Event) => savePrefs({ advanceAfterTyping: (e.target as HTMLInputElement).checked }) }), h("span", null, "After typing a key, move to the next TOTEM key (type a whole layer in one go)")),
        ),
    );
    const d = state.detected;
    const layoutSection = h(
        "section",
        null,
        h("h3", null, "Computer keyboard layout"),
        h(
            "p",
            { class: "small muted" },
            "Your TOTEM sends key positions; the computer turns them into characters. Pick the layout the computer uses, so keys show what they will really type (on German, KC_Y types Z). This only changes what you see here, not the keyboard.",
        ),
        layoutSelect("full"),
        h("p", { class: "small muted", style: "margin-top:6px" }, d ? `Automatic: ${d.detail}` : "Detecting…"),
    );
    const security = state.connected
        ? h(
              "section",
              null,
              h("h3", null, "Security"),
              h(
                  "div",
                  { class: "row" },
                  h("span", { class: "grow small muted" }, state.unlocked ? "The keyboard is unlocked: macros, QK_BOOT and the key tester can be changed/used." : "The keyboard is locked. Vial asks you to hold two keys to unlock it before saving macros, assigning QK_BOOT or using the key tester."),
                  state.unlocked ? h("button", { class: "pill ghost", onClick: () => lockKeyboard() }, "Lock") : h("button", { class: "pill ghost", onClick: () => ensureUnlocked() }, "Unlock"),
              ),
          )
        : null;

    let qmk: HTMLElement;
    if (!kb || !kb.settings.size) {
        qmk = h("section", null, h("h3", null, "Firmware settings"), h("p", { class: "small muted" }, state.connected ? "This firmware exposes no QMK settings." : "Connect your TOTEM to change firmware settings such as the tapping term."));
    } else {
        qmk = h(
            "section",
            null,
            h("h3", null, "Firmware settings"),
            h("p", { class: "small muted" }, state.connected ? "Changes are saved to the keyboard right away." : "Saved in the .vil file."),
            QMK_SETTINGS.map((tab) => {
                const fields = tab.fields.filter((f) => kb.settings.has(f.qsid));
                if (!fields.length) return null;
                return h(
                    "details",
                    { open: tab.name === "Tap-Hold", style: "margin-top:10px" },
                    h("summary", { style: "cursor:pointer;font-weight:600" }, tab.name),
                    h(
                        "div",
                        { class: "kv", style: "margin-top:8px" },
                        fields.map((f) => {
                            const v = kb.settings.get(f.qsid) ?? 0;
                            if (f.type === "boolean") {
                                const bit = f.bit ?? 0;
                                const inp = h("input", { type: "checkbox", checked: !!(v & (1 << bit)) });
                                inp.addEventListener("change", () => {
                                    const cur = kb.settings.get(f.qsid) ?? 0;
                                    updateSetting(f.qsid, inp.checked ? cur | (1 << bit) : cur & ~(1 << bit), `${f.title} ${inp.checked ? "on" : "off"}`);
                                });
                                return [h("span", null, f.title), inp];
                            }
                            const inp = h("input", { type: "number", min: f.min ?? 0, max: f.max ?? 65535, value: v, style: "width:100px" });
                            inp.addEventListener("keydown", (e) => e.stopPropagation());
                            inp.addEventListener("change", () => {
                                const n = Math.max(f.min ?? 0, Math.min(f.max ?? 65535, Math.round(Number(inp.value) || 0)));
                                inp.value = String(n);
                                updateSetting(f.qsid, n, `${f.title} → ${n}`);
                            });
                            return [h("span", null, f.title), inp];
                        }),
                    ),
                );
            }),
        );
    }
    return h("div", null, appSection, layoutSection, security, qmk);
}

export function testerPanel(): HTMLElement {
    if (!state.connected) return h("div", { class: "notice" }, "Connect your TOTEM to test its switches.");
    const t = state.tester;
    const seen = t.seen.filter(Boolean).length;
    return h(
        "div",
        null,
        h("p", { class: "small muted" }, "Press keys on your TOTEM: held keys light up green, keys that have worked at least once get a dashed outline. Handy for checking solder joints and switches."),
        t.running
            ? h("div", { class: "row" }, h("span", { class: "grow" }, `${seen} of 38 keys seen`), h("button", { class: "pill ghost", onClick: () => stopTester() }, "Stop"))
            : h(
                  "div",
                  { class: "row" },
                  h(
                      "button",
                      {
                          class: "pill",
                          onClick: () => {
                              startTester();
                          },
                      },
                      "Start key tester",
                  ),
                  state.unlocked ? null : h("span", { class: "small muted" }, "Needs an unlock first."),
              ),
    );
}

export function aboutPanel(): HTMLElement {
    const kb = state.kb;
    return h(
        "div",
        null,
        h(
            "p",
            null,
            "An unofficial, minimal editor modelled on ",
            h("a", { href: "https://github.com/svalboard/keybard", target: "_blank", rel: "noopener" }, "keybard"),
            " (by Svalboard) for the ",
            h("a", { href: "https://github.com/GEIGEIGEIST/TOTEM", target: "_blank", rel: "noopener" }, "GEIST TOTEM"),
            " running ",
            h("a", { href: "https://get.vial.today", target: "_blank", rel: "noopener" }, "Vial"),
            " firmware. Not affiliated with Svalboard or GEIST.",
        ),
        h(
            "ul",
            { class: "small muted", style: "line-height:1.7;padding-left:18px" },
            h("li", null, "Talks to the keyboard over WebHID: use Chrome, Edge, Opera or Brave."),
            h("li", null, "Everything runs locally in this one HTML file; nothing is sent anywhere."),
            h("li", null, "Layout files (.vil) are compatible with the Vial app."),
            h("li", null, "Keycode tables come from the Vial GUI, the key layout from the TOTEM's own Vial definition."),
        ),
        kb
            ? h(
                  "div",
                  { class: "kv small", style: "margin-top:12px" },
                  h("span", null, "Keyboard"),
                  h("b", null, kb.name),
                  h("span", null, "Vial protocol"),
                  h("b", null, String(kb.vialProtocol)),
                  h("span", null, "VIA protocol"),
                  h("b", null, String(kb.viaProtocol)),
                  h("span", null, "Layers"),
                  h("b", null, String(kb.layers)),
                  h("span", null, "Macros / tap dances / combos / overrides"),
                  h("b", null, `${kb.macroCount} / ${kb.tapDances.length} / ${kb.combos.length} / ${kb.overrides.length}`),
                  h("span", null, "Keyboard UID"),
                  h("b", { class: "mono" }, kb.uid !== null ? "0x" + kb.uid.toString(16) : "—"),
              )
            : null,
        h("p", { class: "small muted", style: "margin-top:16px" }, `Build ${typeof __BUILD__ !== "undefined" ? __BUILD__ : "dev"}`),
    );
}

// ---------------------------------------------------------------- desktop overlay

export function overlayPanel(): HTMLElement {
    const host = overlayHost();
    const sup = state.overlaySupport;
    if (state.connected && sup === null) void checkOverlaySupport();
    const firmware = !state.connected
        ? h("div", { class: "notice" }, "Connect your TOTEM to check that its firmware can tell the overlay which layer you're on.")
        : sup === null
          ? h("div", { class: "notice" }, "Checking your TOTEM's firmware…")
          : sup
            ? h("div", { class: "notice ok", dataset: { support: "yes" } }, "✓ Your TOTEM's firmware reports the layer you're on: the overlay can follow it.")
            : h(
                  "div",
                  { class: "notice warn", dataset: { support: "no" } },
                  "Your TOTEM's firmware can't report the layer you're on, so the overlay would only show the base layer. Flash ",
                  h("b", null, "totem_vial_keybard_left.uf2"),
                  " and ",
                  h("b", null, "…_right.uf2"),
                  " from the firmware folder (see “Firmware” in the README; save your layout as a .vil first).",
              );
    return h(
        "div",
        null,
        h(
            "p",
            { style: "margin-top:0;line-height:1.55" },
            "The overlay shows your layout see-through on top of every app and follows the layer you're on, so you can glance at it while you learn a new layout. Clicks go through it to the window underneath. You choose its colours, opacity, size and place.",
        ),
        firmware,
        host
            ? h(
                  "section",
                  null,
                  h("h3", null, "Overlay app"),
                  h("p", { class: "small muted", style: "margin-top:0" }, `You're using the editor inside the overlay app (${host.version}). Layer names you set here show on the overlay.`),
                  h(
                      "div",
                      { class: "row wrap" },
                      h("button", { class: "pill", onClick: () => host.openSettings() }, "Overlay settings…"),
                      h("button", { class: "pill ghost", onClick: () => host.setAdjusting(true) }, "Move and resize"),
                  ),
              )
            : h(
                  "section",
                  null,
                  h("h3", null, "Start the overlay"),
                  h(
                      "ol",
                      { class: "small", style: "line-height:1.7;padding-left:18px;margin:0" },
                      h(
                          "li",
                          null,
                          "NixOS: run ",
                          h("b", { class: "mono" }, "totem-overlay"),
                          " (nix/totem-keybard.nix). Elsewhere, in the ",
                          h("b", null, "untested-os"),
                          " folder, start ",
                          h("b", null, "Start Overlay (Windows).cmd"),
                          ", ",
                          h("b", null, "Start Overlay (macOS).command"),
                          " (right-click → Open the first time) or ",
                          h("b", { class: "mono" }, "start-overlay-linux.sh"),
                          ".",
                      ),
                      h("li", null, "The start scripts download the app's runtime (Electron, about 120 MB) from GitHub the first time."),
                      h("li", null, "The overlay finds your TOTEM by itself. Its settings and “Move and resize” are in its tray (menu bar) icon."),
                  ),
                  h(
                      "p",
                      { class: "small muted" },
                      "This editor and the overlay can use the keyboard at the same time. Layer names from this browser reach the overlay through a .vil file (overlay settings → Load names), or use the editor from the overlay's tray icon. The official Vial app can't share the keyboard with the overlay: quit the overlay while you use Vial.",
                  ),
              ),
    );
}

// ---------------------------------------------------------------- layer lights

const toHex = (c: Rgb) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
const fromHex = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const isOff = (c: Rgb) => !c[0] && !c[1] && !c[2];
const lastLit = new Map<number, Rgb>(); // colours of lights turned off, to turn them on again

const flashNote = (...more: (string | HTMLElement)[]) =>
    h(
        "div",
        { class: "notice warn", dataset: { lights: "no" } },
        "Your TOTEM's firmware has no layer lights. Flash ",
        h("b", null, "totem_vial_keybard_left.uf2"),
        " and ",
        h("b", null, "…_right.uf2"),
        " from the firmware folder (see “Firmware” in the README; save your layout as a .vil first).",
        ...more,
    );

export function lightsPanel(): HTMLElement {
    onLightsNote(null);
    const intro = h(
        "p",
        { style: "margin-top:0;line-height:1.55" },
        "The RGB LED on each half's XIAO RP2040 shows the colour of the layer you're on (the highest layer that's on), steady, breathing or as a rainbow. It shines through a clear or white case. What you pick shows on the keyboard for a moment, and is saved on it.",
    );
    if (!state.connected) return h("div", null, intro, h("div", { class: "notice" }, "Connect your TOTEM to set its layer lights."));
    if (state.lightsSupport === null) {
        if (state.lightsError)
            return h(
                "div",
                null,
                intro,
                h("div", { class: "notice warn" }, `Couldn't read the light colours: ${state.lightsError}`),
                h("button", { class: "pill", onClick: () => (state.lightsError = null, void readLights(), invalidate("panel")) }, "Try again"),
            );
        void readLights();
        return h("div", null, intro, h("div", { class: "notice" }, "Reading the light colours from your TOTEM…"));
    }
    if (!state.lightsSupport || !state.lights) return h("div", null, intro, flashNote());

    const L = state.lights;
    const noteText = () => {
        const n = state.lightsNote;
        return n === "saving" ? "Saving on your TOTEM…" : n === "saved" ? "✓ Saved on your TOTEM" : n ? n.replace(/^error: /, "Couldn't save: ") : "Kept on your TOTEM.";
    };
    const note = h("div", { class: "small muted lights-note", role: "status" });
    const syncNote = () => {
        note.textContent = noteText();
        note.dataset.state = state.lightsNote.split(":")[0];
    };
    syncNote();
    onLightsNote(syncNote);

    const pct = Math.round((L.brightness / 255) * 100);
    const pctOut = h("span", { class: "ov-val" }, `${pct} %`);
    const bright = h("input", { type: "range", min: 0, max: 100, step: 1, value: String(pct), "aria-label": "Brightness" });
    bright.addEventListener("input", () => {
        pctOut.textContent = `${bright.value} %`;
        setLightBrightness(Math.round(Number(bright.value) * 2.55));
    });

    const speedPct = Math.round((L.speed / 255) * 100);
    const speedOut = h("span", { class: "ov-val" }, `${speedPct} %`);
    const speed = h("input", { type: "range", min: 0, max: 100, step: 1, value: String(speedPct), "aria-label": "Effect speed" });
    speed.addEventListener("input", () => {
        speedOut.textContent = `${speed.value} %`;
        setLightSpeed(Math.round(Number(speed.value) * 2.55));
    });
    // turn off after: the usual choices, plus whatever the keyboard has
    const times: [number, string][] = [
        [0, "Never"],
        [30, "30 seconds"],
        [60, "1 minute"],
        [120, "2 minutes"],
        [300, "5 minutes"],
        [600, "10 minutes"],
        [1800, "30 minutes"],
        [3600, "1 hour"],
    ];
    if (!times.some(([s]) => s === L.timeout)) times.push([L.timeout, L.timeout % 60 ? `${L.timeout} seconds` : `${L.timeout / 60} minutes`]);
    const timeout = h(
        "select",
        { class: "light-timeout", "aria-label": "Turn the lights off after" },
        times.map(([s, t]) => h("option", { value: String(s), selected: s === L.timeout }, t)),
    );
    timeout.addEventListener("change", () => setLightTimeout(Number(timeout.value)));

    const n = Math.min(state.kb!.layers, L.colors.length);
    const setAll = (colors: Rgb[]) => {
        for (let l = 0; l < n; l++) setLayerLight(l, colors[l]);
        invalidate("panel");
    };
    return h(
        "div",
        { class: "lights" },
        intro,
        h("label", { class: "ov-row" }, h("span", { class: "ov-lbl" }, "Brightness"), bright, pctOut),
        h("label", { class: "ov-row" }, h("span", { class: "ov-lbl" }, "Effect speed"), speed, speedOut),
        h("label", { class: "ov-row" }, h("span", { class: "ov-lbl" }, "Turn off after"), timeout, h("span", { class: "small muted" }, "without a key press")),
        h("div", { class: "light-list" }, Array.from({ length: n }, (_, l) => lightRow(l))),
        note,
        h(
            "div",
            { class: "row wrap", style: "margin-top:12px" },
            h(
                "button",
                { class: "pill ghost", title: "Each layer gets its colour from the layer tabs; the base layer stays as it is", onClick: () => setAll(Array.from({ length: n }, (_, l) => (l === 0 ? L.colors[0] : fromHex(layerColor(l).hex)))) },
                "Editor's layer colours",
            ),
            h(
                "button",
                {
                    class: "pill ghost",
                    onClick: () => {
                        for (let l = 0; l < n; l++) setLayerEffect(l, 0);
                        setLightSpeed(DEFAULT_SPEED);
                        setLightTimeout(0);
                        setLightBrightness(DEFAULT_BRIGHTNESS);
                        setAll(DEFAULT_LIGHTS);
                    },
                },
                "Defaults",
            ),
            h("button", { class: "pill ghost", onClick: () => setAll(Array.from({ length: n }, () => [0, 0, 0] as Rgb)) }, "All off"),
        ),
        h("p", { class: "small muted" }, "The lights go dark while your computer sleeps. They aren't part of .vil files: they stay on the keyboard."),
    );
}

function lightRow(l: number): HTMLElement {
    const c = state.lights!.colors[l];
    const off = isOff(c);
    const shown = off ? (lastLit.get(l) ?? fromHex(layerColor(l).hex)) : c;
    const rainbow = state.lights!.effects[l] === 2;
    const inp = h("input", { type: "color", value: toHex(shown), title: off ? "off" : toHex(c), "aria-label": `Light colour of layer ${l}` });
    const effect = h(
        "select",
        { class: "light-effect", "aria-label": `Light effect of layer ${l}`, title: "Steady, breathing in this colour, or a rainbow (which ignores the colour)" },
        EFFECTS.map((name, i) => h("option", { value: String(i), selected: i === state.lights!.effects[l] }, name)),
    );
    effect.addEventListener("change", () => {
        setLayerEffect(l, Number(effect.value));
        invalidate("panel");
    });
    const offBtn = h(
        "button",
        {
            class: ["light-off", off && "on"],
            "aria-pressed": String(off),
            title: off ? "Light this layer again" : "No light on this layer",
            onClick: () => {
                const now = state.lights!.colors[l];
                if (isOff(now)) setLayerLight(l, lastLit.get(l) ?? fromHex(inp.value));
                else {
                    lastLit.set(l, [...now]);
                    setLayerLight(l, [0, 0, 0]);
                    if (state.lights!.effects[l] === 2) setLayerEffect(l, 0); // a rainbow ignores the colour: steady, so off is off
                }
                invalidate("panel");
            },
        },
        "Off",
    );
    const row = h(
        "div",
        { class: ["light-row", off && "off", rainbow && "rainbow"], dataset: { layer: String(l), color: off ? "off" : toHex(c) } },
        h("span", { class: "light-num" }, String(l)),
        h("span", { class: "light-name" }, nameOf("layer", l) ?? `Layer ${l}`),
        rainbow ? h("span", { class: "light-rainbow", title: "Rainbow: goes round the colour wheel" }) : inp,
        effect,
        offBtn,
    );
    inp.addEventListener("input", () => {
        // update this row only: re-rendering would close the colour picker
        setLayerLight(l, fromHex(inp.value));
        row.classList.remove("off");
        row.dataset.color = inp.value;
        inp.title = inp.value;
        offBtn.classList.remove("on");
        offBtn.setAttribute("aria-pressed", "false");
    });
    return row;
}

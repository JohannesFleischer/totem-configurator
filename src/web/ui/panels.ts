// Settings, key tester and about panels.
import { QMK_SETTINGS } from "../qmk-settings";
import { overlayHost } from "../overlay-settings";
import { checkOverlaySupport, ensureUnlocked, lockKeyboard, savePrefs, startTester, state, stopTester, updateSetting } from "../store";
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

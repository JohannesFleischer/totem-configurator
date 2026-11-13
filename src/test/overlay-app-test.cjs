// Drives the real overlay app (Electron) against the simulated TOTEM. Run by test/overlay-app.sh:
//   TOTEM_OVERLAY_TEST_MOCK=test/mock-totem.js TOTEM_OVERLAY_TEST_SCRIPT=test/overlay-app-test.cjs electron ../untested-os/app
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { BrowserWindow, session } = require("electron");

module.exports = async function run(app) {
    const out = process.env.TOTEM_OVERLAY_TEST_OUT || ".";
    const results = [];
    const ok = (name) => (results.push(name), console.log("  ok -", name));
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const js = (win, code) => win.webContents.executeJavaScript(code, true);
    async function until(win, code, what, timeout = 8000) {
        const t0 = Date.now();
        for (;;) {
            if (await js(win, code).catch(() => false)) return;
            if (Date.now() - t0 > timeout) throw new Error("timed out waiting for " + what);
            await sleep(100);
        }
    }
    async function shot(win, name) {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(out, name), img.toPNG());
    }
    try {
        const ov = app.overlay();
        // the window itself
        if (!ov.isAlwaysOnTop()) throw new Error("overlay is not always on top");
        if (ov.isFocusable()) throw new Error("overlay can take focus");
        if (ov.isResizable()) throw new Error("overlay should open with a fixed size (keeps it floating)");
        await until(ov, "!!document.querySelector('.ovl .key')", "the overlay to draw keys");
        await until(ov, "!document.querySelector('.ovl-status')", "the overlay to follow the keyboard");
        if (ov.getTitle() !== "TOTEM overlay") throw new Error(`overlay title is "${ov.getTitle()}"`);
        ok("overlay window: transparent, always on top, not focusable, fixed size, titled TOTEM overlay; draws layer 0");
        await shot(ov, "app-overlay-layer0.png");

        // follows the layer
        await js(ov, "window.__mock.layerState = 1 << 2; true");
        await until(ov, "document.querySelector('.ovl').dataset.layer === '2'", "layer 2");
        await js(ov, "window.__mock.layerState = 0; window.__mock.mods = 2; true");
        await until(ov, "document.querySelector('.ovl').dataset.layer === '0' && !!document.querySelector('.ovl-mod')", "Shift");
        await js(ov, "window.__mock.mods = 0; true");
        ok("follows the layer and Shift the keyboard reports");

        // a key changed elsewhere (editor, Vial) shows up
        await js(ov, "window.__mock.keymap[0][0] = 0x1d; true"); // KC_Z
        await until(ov, "document.querySelector('.ovl .key[data-pos=\"0\"]').textContent.trim() === 'Z'", "the changed key", 6000);
        ok("picks up a key changed by another program within a couple of seconds");

        // move and resize
        app.setAdjusting(true);
        await until(ov, "!!document.querySelector('.ovl-adjust')", "the adjust frame");
        if (!ov.isFocusable()) throw new Error("adjust mode: overlay should take the mouse");
        await sleep(300);
        await shot(ov, "app-overlay-adjust.png");
        const before = ov.getBounds();
        app.resizeOverlay(900, 330);
        await sleep(300);
        const after = ov.getBounds();
        if (after.width !== 900 || after.height !== 330) throw new Error(`resize gave ${after.width}x${after.height}`);
        if (after.y + after.height !== before.y + before.height) throw new Error("resize moved the bottom edge");
        await js(ov, "document.querySelector('.ovl-adjust-bar .done').click(); true");
        await sleep(600);
        if (ov.isFocusable()) throw new Error("Done should make the overlay click-through again");
        if (ov.isResizable()) throw new Error("the overlay should keep a fixed size");
        const done = ov.getBounds();
        if (done.width !== 900 || done.height !== 330) throw new Error(`Done changed the size to ${done.width}x${done.height}`);
        await until(ov, "!document.querySelector('.ovl-adjust')", "the adjust frame to go");
        ok("Move and resize: frame, resize keeps the bottom edge; Done keeps the size and makes it click-through again");

        // settings window changes the overlay live
        const sw = app.openSettings();
        await new Promise((r) => (sw.webContents.isLoading() ? sw.webContents.once("did-finish-load", r) : r()));
        await until(sw, "!!document.querySelector('.ov-settings .ov-preview .key')", "the settings preview");
        await until(sw, "document.querySelector('.ov-status').textContent.includes('Following layer')", "the overlay's status in the settings");
        await js(sw, "[...document.querySelectorAll('.ov-settings .chip')].find(b => b.textContent === 'Outline only').click(); true");
        await until(ov, "getComputedStyle(document.querySelector('.ovl .key')).backgroundColor === 'rgba(0, 0, 0, 0)'", "the overlay to switch to Outline only");
        await js(sw, "[...document.querySelectorAll('.ov-settings .seg button')].find(b => b.textContent === 'Only on other layers').click(); true");
        await until(ov, "document.querySelector('.ovl').classList.contains('ovl-away')", "the overlay to hide on the base layer");
        await js(ov, "window.__mock.layerState = 1 << 1; true");
        await until(ov, "!document.querySelector('.ovl').classList.contains('ovl-away')", "the overlay to show on layer 1");
        await shot(sw, "app-settings.png");
        await js(sw, "[...document.querySelectorAll('.ov-settings .chip')].find(b => b.textContent === 'Dark').click(); [...document.querySelectorAll('.ov-settings .seg button')].find(b => b.textContent === 'Always').click(); true");
        await sleep(300);
        await shot(ov, "app-overlay-layer1.png");
        ok("settings window: preview, status, and changes show on the overlay at once");

        // held keys: the tray offers "Unlock", the overlay shows the keys to hold (even when hidden)
        const item = (re) => app.menu().find((i) => i && re.test(i.label || ""));
        for (let i = 0; i < 50 && !(item(/^Unlock/) && item(/^Unlock/).enabled); i++) await sleep(100);
        if (!item(/^Unlock/) || !item(/^Unlock/).enabled) throw new Error("tray has no usable Unlock item: " + JSON.stringify(app.menu().map((i) => i && i.label)));
        app.setVisible(false);
        await js(ov, "window.__mock.hold = false; true");
        item(/^Unlock/).click();
        await until(ov, "!!document.querySelector('.ovl-unlock.hold')", "the unlock panel");
        if (!ov.isVisible()) throw new Error("a hidden overlay should show for the unlock");
        await shot(ov, "app-overlay-unlock.png");
        await js(ov, "window.__mock.hold = true; true");
        await until(ov, "!!document.querySelector('.ovl-unlock.done')", "the unlock to finish", 10000);
        await until(ov, "!document.querySelector('.ovl-unlock')", "the unlock panel to go", 6000);
        await sleep(200);
        if (ov.isVisible()) throw new Error("the overlay should be hidden again after the unlock");
        app.setVisible(true);
        for (let i = 0; i < 30 && !item(/^Lock keyboard/); i++) await sleep(100);
        if (!item(/^Lock keyboard/) || !app.keyboard().unlocked) throw new Error("tray should offer Lock once unlocked");
        await until(sw, "document.querySelector('.ov-unlock-row')?.dataset.unlocked === 'yes'", "the settings to show it's unlocked");
        await js(sw, "document.querySelector('.ov-unlock-row button').click(); true"); // Lock
        await until(ov, "!window.__mock.unlocked", "the keyboard to be locked");
        await until(sw, "document.querySelector('.ov-unlock-row')?.dataset.unlocked === 'no'", "the settings to show it's locked");
        for (let i = 0; i < 30 && !item(/^Unlock/); i++) await sleep(100);
        if (!item(/^Unlock/)) throw new Error("tray should offer Unlock again");
        ok("held keys: tray Unlock shows the keys to hold (also on a hidden overlay); settings and tray show it and can lock again");

        // the editor window has the real WebHID; picking a device goes through select-hid-device
        let asked = 0;
        session.defaultSession.on("select-hid-device", () => asked++);
        const ed = app.openEditor();
        await new Promise((r) => ed.webContents.once("did-finish-load", r));
        const got = await js(ed, "navigator.hid.requestDevice({ filters: [{ usagePage: 0xff60, usage: 0x61 }] }).then(d => d.length)");
        if (asked < 1 || got !== 0) throw new Error(`requestDevice: handler ran ${asked}x, got ${got}`);
        ok("editor window: requestDevice is answered by the app (no chooser), with no TOTEM plugged in here");
        const panelOk = await js(ed, "(async () => { [...document.querySelectorAll('.nav-item')].find(b => b.textContent.includes('Overlay')); return !!window.overlayHost; })()");
        if (!panelOk) throw new Error("editor window has no overlayHost");
        ok("editor window knows it runs inside the overlay app");

        // window classes: the editor is its own app for desktop shells, the overlay's windows another
        const classes = JSON.parse(require("node:child_process").execFileSync("python3", [path.join(__dirname, "x11-classes.py")], { encoding: "utf8" })).map((w) => w.class.join("/"));
        app.openSettings();
        await sleep(800);
        const all = JSON.parse(require("node:child_process").execFileSync("python3", [path.join(__dirname, "x11-classes.py")], { encoding: "utf8" })).map((w) => w.class.join("/"));
        if (all.filter((c) => c === "totem-keybard/totem-keybard").length !== 1 || all.filter((c) => c === "totem-overlay/totem-overlay").length < 2 || all.some((c) => !/^totem-(keybard|overlay)\/totem-(keybard|overlay)$/.test(c)))
            throw new Error("window classes: " + JSON.stringify({ classes, all }));
        ok(`window classes: the editor "totem-keybard", the overlay and its settings "totem-overlay" (${all.length} windows), as in their launcher entries`);

        fs.writeFileSync(path.join(out, "app-results.json"), JSON.stringify({ ok: true, results }, null, 2));
    } catch (e) {
        console.error("FAILED:", e.message);
        fs.writeFileSync(path.join(out, "app-results.json"), JSON.stringify({ ok: false, error: e.message, results }, null, 2));
    }
    app.app.exit(0);
};

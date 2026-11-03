// "electron app --editor" (the configurator, as the Nix package starts it): just the editor;
// asking for the overlay starts it in the same process.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { BrowserWindow } = require("electron");
module.exports = async function run(app) {
    const out = process.env.TOTEM_OVERLAY_TEST_OUT || ".";
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const results = [];
    try {
        await sleep(1500);
        const titles = () => BrowserWindow.getAllWindows().map((w) => w.getTitle());
        if (app.overlay()) throw new Error("--editor started the overlay too");
        const ed = app.editor();
        if (!ed) throw new Error("no editor window: " + titles().join(", "));
        await ed.webContents.executeJavaScript("new Promise(r => { const t = () => document.querySelector('.welcome, .nav') ? r(true) : setTimeout(t, 100); t(); })");
        const hid = await ed.webContents.executeJavaScript("typeof navigator.hid");
        if (hid !== "object") throw new Error("editor has no WebHID");
        results.push("--editor opens only the editor window (with WebHID), no overlay");
        // starting the app again without --editor (the overlay's launcher) is handed to this process
        app.app.emit("second-instance", {}, [process.execPath, "app"], process.cwd());
        for (let i = 0; i < 50 && !app.overlay(); i++) await sleep(100);
        if (!app.overlay()) throw new Error("the overlay didn't start in the running editor process");
        await sleep(500);
        if (!app.editor()) throw new Error("the editor window went away");
        results.push("the overlay starts in the running editor process when it's launched");
        fs.writeFileSync(path.join(out, "editor-results.json"), JSON.stringify({ ok: true, results }));
    } catch (e) {
        fs.writeFileSync(path.join(out, "editor-results.json"), JSON.stringify({ ok: false, error: e.message, results }));
    }
    app.app.exit(0);
};

// The overlay app as users run it (sandboxed pages, real WebHID, no TOTEM attached here).
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { BrowserWindow } = require("electron");
module.exports = async function run(app) {
    const out = process.env.TOTEM_OVERLAY_TEST_OUT || ".";
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const results = [];
    try {
        const ov = app.overlay();
        const js = (code) => ov.webContents.executeJavaScript(code, true);
        for (let i = 0; i < 80 && !(await js("!!document.querySelector('.ovl-status')").catch(() => false)); i++) await sleep(100);
        const r = await js(`({
            status: document.querySelector('.ovl-status')?.textContent,
            host: typeof window.overlayHost, version: window.overlayHost && window.overlayHost.version,
            hid: typeof navigator.hid, require: typeof window.require, processType: typeof window.process,
            bg: getComputedStyle(document.body).backgroundColor })`);
        if (!/Looking for your TOTEM/.test(r.status || "")) throw new Error("status: " + r.status);
        if (r.host !== "object" || r.version !== "1.0.0") throw new Error("no overlayHost in the page");
        if (r.hid !== "object") throw new Error("no WebHID");
        if (r.require !== "undefined" || r.processType !== "undefined") throw new Error("Node leaks into the page");
        results.push("sandboxed overlay page: WebHID, the app's bridge and nothing else; waits for a TOTEM");
        const titles = BrowserWindow.getAllWindows().map((w) => w.getTitle());
        if (!titles.some((t) => /settings/i.test(t))) throw new Error("first start should open the settings: " + titles.join(", "));
        results.push("first start opens the settings window");
        await js("window.overlayHost.setAdjusting(true); true");
        await sleep(300);
        if (!ov.isFocusable() || !(await js("!!document.querySelector('.ovl-adjust')"))) throw new Error("setAdjusting from the page didn't work");
        await js("window.overlayHost.setAdjusting(false); true");
        await sleep(200);
        results.push("the page's bridge drives the window (Move and resize on/off)");
        fs.writeFileSync(path.join(out, "prod-results.json"), JSON.stringify({ ok: true, results }));
    } catch (e) {
        fs.writeFileSync(path.join(out, "prod-results.json"), JSON.stringify({ ok: false, error: e.message, results }));
    }
    app.app.exit(0);
};

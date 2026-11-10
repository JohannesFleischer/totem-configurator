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

        // Save the layout: straight into Downloads (no save dialog), and the page says where
        const js = (c) => ed.webContents.executeJavaScript(c, true).catch((e) => Promise.reject(new Error(`${e.message} in: ${c.slice(0, 160)}`)));
        await js("[...document.querySelectorAll('button')].find(b => /demo layout/i.test(b.textContent)).click(); true");
        await js("new Promise(r => { const t = () => document.querySelector('.stage .board .key') ? r(true) : setTimeout(t, 100); t(); })");
        const home = app.app.getPath("home"), xdg = app.app.getPath("downloads");
        const dir = path.resolve(xdg) === path.resolve(home) ? path.join(home, "Downloads") : xdg; // no XDG dirs here: ~/Downloads
        const saveAndToast = async () => {
            await js("document.querySelectorAll('.toast').forEach(t => t.remove()); document.querySelector('.topbar button[title^=\"Save the layout\"]').click(); true");
            for (let i = 0; i < 50; i++) {
                const t = await js("document.querySelector('.toast[data-id=saved]')?.textContent || ''");
                if (t) return t;
                await sleep(100);
            }
            throw new Error("no message after saving (a save dialog waiting?)");
        };
        const t1 = await saveAndToast();
        const f1 = path.join(dir, "totem-demo.vil");
        if (t1 !== `Saved to ${f1}`) throw new Error("first save said: " + t1);
        const vil = JSON.parse(fs.readFileSync(f1, "utf8"));
        if (vil.version !== 1 || !Array.isArray(vil.layout)) throw new Error("saved file isn't a .vil");
        const t2 = await saveAndToast();
        const f2 = path.join(dir, "totem-demo (2).vil");
        if (t2 !== `Saved to ${f2}` || !fs.existsSync(f2)) throw new Error("second save said: " + t2);
        results.push(`Save the layout: written to ${dir} without a dialog, the page shows the path; a second save gets a new name`);

        // Open a layout: the app's own file browser (no system dialog), starting in Downloads
        const sub = path.join(dir, "layouts");
        fs.mkdirSync(sub, { recursive: true });
        const named = JSON.parse(fs.readFileSync(f1, "utf8"));
        fs.writeFileSync(path.join(sub, "mine.vil"), JSON.stringify(named));
        fs.writeFileSync(path.join(sub, "notes.txt"), "not a layout");
        const until = async (cond, what) => {
            for (let i = 0; i < 50; i++) {
                if (await js(cond)) return;
                await sleep(100);
            }
            throw new Error("waited for " + what);
        };
        await js("document.querySelector('.topbar button[title^=\"Open a .vil\"]').click(); true");
        await until("!!document.querySelector('.fp .fp-row.file')", "the file browser");
        const listed = await js(`({ path: document.querySelector('.fp-path').value, rows: [...document.querySelectorAll('.fp-row')].map(r => r.querySelector('.name').textContent),
            places: [...document.querySelectorAll('.fp-places button')].map(b => b.textContent), system: !!document.querySelector('.fp-system') })`);
        if (listed.path !== dir) throw new Error("file browser didn't start in Downloads: " + listed.path);
        if (listed.rows[0] !== ".." || listed.rows[1] !== "layouts" || !listed.rows.includes("totem-demo.vil") || listed.rows.indexOf("totem-demo (2).vil") > listed.rows.indexOf("totem-demo.vil"))
            throw new Error("listing: " + JSON.stringify(listed.rows));
        if (listed.places.join() !== "Downloads,Home" || !listed.system) throw new Error("places/system button: " + JSON.stringify(listed));
        fs.writeFileSync(path.join(out, "editor-open-browser.png"), (await ed.webContents.capturePage()).toPNG());
        await js("[...document.querySelectorAll('.fp-row.dir')].find(r => r.textContent.includes('layouts')).click(); true");
        await until(`document.querySelector('.fp-path').value === ${JSON.stringify(sub)}`, "the subfolder");
        const inSub = await js("[...document.querySelectorAll('.fp-row')].map(r => r.querySelector('.name').textContent).join(',')");
        if (inSub !== "..,mine.vil") throw new Error("subfolder shows: " + inSub + " (only folders and .vil files)");
        await js("[...document.querySelectorAll('.fp-row.file')].find(r => r.textContent.includes('mine.vil')).click(); true");
        await until("!document.querySelector('.fp') && /mine\\.vil · offline/.test(document.querySelector('.topbar').textContent)", "mine.vil to open");
        // again: starts where it was; a typed path opens a file, a missing folder says so, Esc closes
        await js("document.querySelector('.topbar button[title^=\"Open a .vil\"]').click(); true");
        await until(`document.querySelector('.fp-path')?.value === ${JSON.stringify(sub)}`, "the browser to remember the folder");
        await js("{ const i = document.querySelector('.fp-path'); i.value = '~/nowhere'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); } true");
        await until("/There's no folder/.test(document.querySelector('.fp-msg').textContent)", "the missing-folder message");
        await js(`{ const i = document.querySelector('.fp-path'); i.value = ${JSON.stringify(f1)}; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); } true`);
        await until("!document.querySelector('.fp') && /totem-demo\\.vil · offline/.test(document.querySelector('.topbar').textContent)", "the typed file to open");
        await js("document.querySelector('.topbar button[title^=\"Open a .vil\"]').click(); true");
        await until("!!document.querySelector('.fp')", "the browser");
        await js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true");
        await until("!document.querySelector('.fp')", "Esc to close it");
        results.push("Open a layout: the app's own file browser (starts in Downloads, folders and .vil files only, newest first), opens a picked or typed file, remembers the folder; Esc closes");
        // the app's own title bar (as under niri; here asked for with TOTEM_KEYBARD_TITLEBAR=own) and the dark theme
        const bar = await js(`({ bar: !!document.querySelector('.winbar'), buttons: [...document.querySelectorAll('.winbtn')].map(b => b.getAttribute('aria-label')).join(','),
            title: document.querySelector('.winbar-title')?.textContent, dark: matchMedia('(prefers-color-scheme: dark)').matches,
            drag: getComputedStyle(document.querySelector('.winbar')).getPropertyValue('-webkit-app-region') || getComputedStyle(document.querySelector('.winbar')).webkitAppRegion,
            top: document.querySelector('.app').getBoundingClientRect().top })`);
        if (!bar.bar || bar.buttons !== "Minimize,Maximize,Close" || bar.top !== 32) throw new Error("own title bar: " + JSON.stringify(bar));
        if (!bar.dark) throw new Error("TOTEM_KEYBARD_THEME=dark didn't make the page dark");
        fs.writeFileSync(path.join(out, "editor-own-bar.png"), (await ed.webContents.capturePage()).toPNG());
        await js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F11' })); true");
        for (let i = 0; i < 30 && !ed.isFullScreen(); i++) await sleep(100);
        if (!ed.isFullScreen()) throw new Error("F11 didn't make the window full screen");
        for (let i = 0; i < 30 && (await js("document.querySelector('.winbtn[aria-label=Restore]') ? 1 : 0")) !== 1; i++) await sleep(100);
        await js("document.querySelector('.winbtn[aria-label=Restore]').click(); true"); // the button leaves full screen
        for (let i = 0; i < 30 && ed.isFullScreen(); i++) await sleep(100);
        if (ed.isFullScreen()) throw new Error("the bar's button didn't leave full screen");
        results.push(`own title bar (frameless window): ${bar.buttons}; follows the dark theme; F11 and the button switch full screen`);

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

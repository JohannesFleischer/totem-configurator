// The overlay app under niri: a stand-in for niri's IPC socket ($NIRI_SOCKET) that checks every
// request against niri-ipc's message types (niri 26.04) and does to the window what niri would:
// it opens fixed-size windows floating, centres new floating windows, keeps a window within its
// size limits, and moves floating windows within a working area (here: a 30 px bar on top).
"use strict";
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { BrowserWindow } = require("electron");

module.exports = async function run(app) {
    const out = process.env.TOTEM_OVERLAY_TEST_OUT || ".";
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const results = [];
    const ok = (name) => (results.push(name), console.log("  ok -", name));
    const ov = app.overlay();

    // ---- the stand-in niri
    const wa = { x: 0, y: 30, w: 1600, h: 970 }; // the 1600x1000 screen less a bar
    let mapped = false,
        floating = false,
        forceTiled = false,
        pos = [0, 0],
        id = 10;
    const requests = [];
    const bad = [];
    const size = () => ov.getContentSize();
    const centre = () => {
        const [w, h] = size();
        return [wa.x + Math.max(0, (wa.w - w) / 2), wa.y + Math.max(0, (wa.h - h) / 2)];
    };
    ov.on("show", () => {
        // a new window for niri: floating if its size is fixed (or a rule says so), then centred
        mapped = true;
        id++;
        floating = !forceTiled && !ov.isResizable();
        pos = floating ? centre() : [0, wa.y];
    });
    ov.on("hide", () => (mapped = false));

    const isInt = (v) => Number.isInteger(v);
    const isNum = (v) => typeof v === "number" && Number.isFinite(v);
    const one = (o, kinds) => o && typeof o === "object" && Object.keys(o).length === 1 && kinds[Object.keys(o)[0]]?.(Object.values(o)[0]);
    const sizeChange = (c) => one(c, { SetFixed: isInt, SetProportion: isNum, AdjustFixed: isInt, AdjustProportion: isNum });
    const posChange = (c) => c === undefined || one(c, { SetFixed: isNum, SetProportion: isNum, AdjustFixed: isNum, AdjustProportion: isNum });
    const fields = (a, allowed) => Object.keys(a).every((k) => allowed.includes(k)) && isInt(a.id); // an id always: without one niri acts on the focused window
    const ACTIONS = {
        SetWindowWidth: (a) => fields(a, ["id", "change"]) && sizeChange(a.change),
        SetWindowHeight: (a) => fields(a, ["id", "change"]) && sizeChange(a.change),
        MoveFloatingWindow: (a) => fields(a, ["id", "x", "y"]) && posChange(a.x) && posChange(a.y),
        CenterWindow: (a) => fields(a, ["id"]),
        MoveWindowToFloating: (a) => fields(a, ["id"]),
    };
    const movePos = (p, c, from, len) => {
        const [k, v] = Object.entries(c)[0];
        return k === "SetFixed" ? v + from : k === "SetProportion" ? (len * v) / 100 + from : k === "AdjustFixed" ? p + v : p + (len * v) / 100;
    };
    function handle(req) {
        if (req === "Windows") {
            const [w, h] = size();
            const win = (title, wid) => ({
                id: wid,
                title,
                app_id: "totem-overlay",
                pid: 4242,
                workspace_id: 1,
                is_focused: false,
                is_floating: floating,
                is_urgent: false,
                layout: { pos_in_scrolling_layout: floating ? null : [1, 1], tile_size: [w, h], window_size: [w, h], tile_pos_in_workspace_view: pos, window_offset_in_tile: [0, 0] },
                focus_timestamp: null,
            });
            return { Ok: { Windows: mapped ? [win("TOTEM overlay settings", 3), win("TOTEM overlay", id)] : [win("TOTEM overlay settings", 3)] } };
        }
        const [name, a] = req && typeof req === "object" && Object.keys(req).length === 1 && req.Action ? Object.entries(req.Action)[0] || [] : [];
        if (!name || !ACTIONS[name] || Object.keys(req.Action).length !== 1 || !ACTIONS[name](a)) return { Err: "error parsing request" };
        if (a.id !== id || !mapped) return { Ok: "Handled" }; // niri ignores ids it doesn't know
        const [w, h] = size();
        if (name === "SetWindowWidth" || name === "SetWindowHeight") {
            // niri keeps the size within the window's limits: a fixed-size window stays as it is
            if (!ov.isResizable()) return { Ok: "Handled" };
            const v = a.change.SetFixed ?? (a.change.AdjustFixed !== undefined ? (name === "SetWindowWidth" ? w : h) + a.change.AdjustFixed : null);
            if (v !== null) ov.setContentSize(name === "SetWindowWidth" ? v : w, name === "SetWindowHeight" ? v : h);
        } else if (name === "MoveFloatingWindow") {
            if (a.x) pos = [movePos(pos[0], a.x, wa.x, wa.w), pos[1]];
            if (a.y) pos = [pos[0], movePos(pos[1], a.y, wa.y, wa.h)];
        } else if (name === "CenterWindow") pos = centre();
        else if (name === "MoveWindowToFloating") {
            floating = true;
            pos = centre();
        }
        return { Ok: "Handled" };
    }
    const server = net.createServer((sock) => {
        let buf = "";
        sock.setEncoding("utf8");
        sock.on("data", (d) => {
            buf += d;
            let nl;
            while ((nl = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, nl);
                buf = buf.slice(nl + 1);
                let req;
                try {
                    req = JSON.parse(line);
                } catch {
                    req = undefined;
                }
                requests.push(line);
                const reply = handle(req);
                if (reply.Err) bad.push(line);
                sock.write(JSON.stringify(reply) + "\n");
            }
        });
        sock.on("error", () => {});
    });
    await new Promise((r) => server.listen(process.env.NIRI_SOCKET, r));

    /** Until the app's niri requests are done. */
    async function settled() {
        for (let quiet = 0; quiet < 3; ) {
            const q = app.niriIdle();
            await q;
            await sleep(120);
            quiet = app.niriIdle() === q ? quiet + 1 : 0;
        }
    }
    const near = (a, b) => Math.abs(a - b) <= 1;
    const where = () => `${size().join("x")} at ${pos.map(Math.round).join(",")} (floating: ${floating}, resizable: ${ov.isResizable()})`;

    try {
        // first start: opened with a fixed size, so floating; then free to resize; bottom centre
        for (let i = 0; i < 100 && !mapped; i++) await sleep(100);
        await sleep(300);
        await settled();
        if (!floating) throw new Error("niri should have opened the overlay floating: " + where());
        if (!ov.isResizable()) throw new Error("after opening, niri should be able to resize it");
        let [w, h] = size();
        if (!near(pos[0], wa.x + (wa.w - w) / 2) || !near(pos[1], wa.y + wa.h - h - 24)) throw new Error("not at the bottom centre: " + where());
        if (!app.niriPlace() || !near(app.niriPlace()[1], pos[1])) throw new Error("place not remembered: " + JSON.stringify(app.niriPlace()));
        ok(`opens floating (fixed size), then resizable; first start puts it at the bottom centre above the bar: ${where()}`);

        // resize as the settings' width slider does: niri resizes it, the bottom edge stays
        const bottom = pos[1] + h;
        app.resizeOverlay(900, 330);
        await settled();
        [w, h] = size();
        if (w !== 900 || h !== 330 || !near(pos[1] + h, bottom)) throw new Error("resize: " + where());
        ok(`resize through niri: ${where()}, bottom edge kept`);

        // the corner grip: many sizes in a row from the page; ends at the last one
        const n0 = requests.length;
        await ov.webContents.executeJavaScript("for (let w = 910; w <= 1100; w += 10) window.overlayHost.resizeTo(w, 340); true", true);
        await settled();
        [w, h] = size();
        if (w !== 1100 || h !== 340 || !near(pos[1] + h, bottom)) throw new Error("grip: " + where());
        ok(`grip drag (20 sizes from the page): ends at ${w}x${h} with ${requests.length - n0} niri requests, bottom edge kept`);

        // the user moves it with niri (Move and resize, then Done): remembered
        app.setAdjusting(true);
        await sleep(200);
        pos = [100, 200];
        app.setAdjusting(false);
        await settled();
        if (JSON.stringify(app.niriPlace()) !== "[100,200]") throw new Error("Done didn't remember the place: " + JSON.stringify(app.niriPlace()));
        await sleep(600);
        const saved = JSON.parse(fs.readFileSync(path.join(app.app.getPath("userData"), "overlay-window.json"), "utf8"));
        if (JSON.stringify(saved.niriPlace) !== "[100,200]") throw new Error("place not saved: " + JSON.stringify(saved));
        ok("a place set with niri is remembered on Done (and saved)");

        // hidden and shown again: niri sees a new window; floating again and back in its place
        app.setVisible(false);
        await sleep(300);
        app.setVisible(true);
        await sleep(300);
        await settled();
        if (!floating || !ov.isResizable() || !near(pos[0], 100) || !near(pos[1], 200)) throw new Error("after hide/show: " + where());
        ok(`hidden and shown: opens floating again and goes back to its place: ${where()}`);

        // a window rule tiles it: the app floats it itself
        app.setVisible(false);
        await sleep(300);
        forceTiled = true;
        app.setVisible(true);
        await sleep(300);
        await settled();
        forceTiled = false;
        if (!floating || !near(pos[0], 100) || !near(pos[1], 200)) throw new Error("tiled by a rule: " + where());
        ok("opened tiled (by a window rule): floats it and puts it back");

        // Bottom centre (tray, settings, Move and resize)
        app.placeBottom();
        await settled();
        [w, h] = size();
        if (!near(pos[0], wa.x + (wa.w - w) / 2) || !near(pos[1], wa.y + wa.h - h - 24)) throw new Error("bottom centre: " + where());
        ok(`Bottom centre through niri: ${where()}`);

        if (bad.length) throw new Error("niri couldn't parse: " + bad.join(" | "));
        const kinds = [...new Set(requests.map((l) => (l.startsWith('"') ? JSON.parse(l) : Object.keys(JSON.parse(l).Action)[0])))];
        ok(`all ${requests.length} requests match niri-ipc's types (${kinds.join(", ")}); every action names the window's id`);
        fs.writeFileSync(path.join(out, "niri-requests.txt"), requests.join("\n") + "\n");
        fs.writeFileSync(path.join(out, "niri-results.json"), JSON.stringify({ ok: true, results }, null, 2));
    } catch (e) {
        console.error("FAILED:", e.message);
        fs.writeFileSync(path.join(out, "niri-requests.txt"), requests.join("\n") + "\n");
        fs.writeFileSync(path.join(out, "niri-results.json"), JSON.stringify({ ok: false, error: e.message, results }, null, 2));
    }
    server.close();
    for (const w of BrowserWindow.getAllWindows()) w.destroy();
    app.app.exit(0);
};

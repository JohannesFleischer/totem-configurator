// TOTEM Overlay: shows your TOTEM layout see-through on top of every app and follows the
// layer you're on. The pages (overlay, its settings, the editor) are totem-keybard.html;
// this file only makes the windows: a transparent, click-through, always-on-top one for
// the overlay, a tray icon, and normal windows for the settings and the editor.
//
//   electron app            the overlay (tray icon, settings)
//   electron app --editor   just the editor (the configurator); quits when it's closed
//
// Only one copy runs: starting another one hands its request to the running one (the
// editor opens there, or the overlay starts there), so both always share their settings.
"use strict";
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, nativeTheme, session, shell } = require("electron");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");

const VERSION = require("./package.json").version;
const HTML = path.join(__dirname, "totem-keybard.html");
const PRELOAD = path.join(__dirname, "preload.js");
// Tests only: a simulated TOTEM (test/mock-totem.js) and a script that drives the app.
const TEST_MOCK = process.env.TOTEM_OVERLAY_TEST_MOCK || "";
const TEST_SCRIPT = process.env.TOTEM_OVERLAY_TEST_SCRIPT || "";
const EDITOR_ONLY = process.argv.includes("--editor");

app.setName("TOTEM Overlay");
// The overlay is a few dozen keys: drawing them in software is plenty fast and avoids
// GPU glitches with transparent windows on some systems.
app.disableHardwareAcceleration();
if (process.platform === "linux") app.commandLine.appendSwitch("enable-transparent-visuals");

if (!app.requestSingleInstanceLock()) {
    app.quit(); // already running: that one takes over (second-instance)
} else {
    app.on("second-instance", (_e, argv) => {
        if (argv.includes("--editor")) openEditor();
        else if (!overlay) startOverlay(); // only the editor was running
        else openSettings();
    });
    app.whenReady().then(start);
}

let overlay = null;
let settingsWin = null;
let editorWin = null;
let tray = null;
let adjusting = false;
let visible = true;
// what the overlay page reports about the keyboard (for the tray menu)
let keyboard = { connected: false, supported: false, unlocked: false };
let unlockShown = false; // the overlay was hidden and is shown for an unlock
let menuTemplate = [];
const OVERLAY_TITLE = "TOTEM overlay"; // also how niri (below) finds the window
let niriPlace = null; // under niri: where the overlay was, [x, y] in niri's view of the workspace

// ---------------------------------------------------------------- remembered place and size

const STATE_FILE = () => path.join(app.getPath("userData"), "overlay-window.json");
function readState() {
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE(), "utf8"));
    } catch {
        return {};
    }
}
let saveTimer = null;
function saveState() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        if (!overlay || overlay.isDestroyed()) return;
        try {
            fs.mkdirSync(app.getPath("userData"), { recursive: true });
            fs.writeFileSync(STATE_FILE(), JSON.stringify({ bounds: overlay.getBounds(), visible, niriPlace }, null, 2));
        } catch (e) {
            console.error("Couldn't save the overlay's place:", e.message);
        }
    }, 400);
}

function bottomCentre(display, width, height) {
    const wa = display.workArea;
    const w = Math.min(width, wa.width - 20),
        h = Math.min(height, wa.height - 20);
    return { x: Math.round(wa.x + (wa.width - w) / 2), y: Math.round(wa.y + wa.height - h - 24), width: w, height: h };
}

function initialBounds() {
    const b = readState().bounds;
    if (b && b.width >= 120 && b.height >= 60) {
        // still on a screen? (a monitor may be gone)
        const d = screen.getDisplayMatching(b);
        const wa = d.workArea;
        if (b.x < wa.x + wa.width - 40 && b.x + b.width > wa.x + 40 && b.y < wa.y + wa.height - 20 && b.y + b.height > wa.y) return b;
    }
    const wa = screen.getPrimaryDisplay().workArea;
    const width = Math.round(Math.min(760, wa.width * 0.5));
    return bottomCentre(screen.getPrimaryDisplay(), width, Math.round(width * 0.36));
}

// ---------------------------------------------------------------- windows

function webPreferences(extra = {}) {
    return {
        preload: PRELOAD,
        // a test injects the simulated TOTEM into the page itself, which needs a shared context
        contextIsolation: !TEST_MOCK,
        sandbox: !TEST_MOCK,
        spellcheck: false,
        ...extra,
    };
}

function createOverlay() {
    const st = readState();
    visible = st.visible !== false;
    niriPlace = Array.isArray(st.niriPlace) ? st.niriPlace : null;
    overlay = new BrowserWindow({
        ...initialBounds(),
        title: OVERLAY_TITLE,
        transparent: true,
        backgroundColor: "#00000000",
        frame: false,
        hasShadow: false,
        resizable: false, // a fixed size: tiling compositors (niri, …) open it floating
        minWidth: 220,
        minHeight: 100,
        movable: true,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: false,
        show: false,
        webPreferences: webPreferences({ backgroundThrottling: false }),
    });
    overlay.setAlwaysOnTop(true, "screen-saver");
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlay.setIgnoreMouseEvents(true); // clicks go to the window underneath
    overlay.on("page-title-updated", (e) => e.preventDefault()); // keeps OVERLAY_TITLE (niri, window rules)
    overlay.loadFile(HTML, { hash: "overlay" });
    overlay.once("ready-to-show", () => {
        if (visible) showOverlay();
        connectSoon();
    });
    overlay.on("show", () => onNiri() && niriSettle());
    overlay.on("move", saveState);
    overlay.on("resize", saveState);
    overlay.on("closed", () => (overlay = null));
}

/** The page finds an already allowed TOTEM itself; picking one needs a "user gesture". */
let connectTimer = null;
function connectSoon() {
    clearInterval(connectTimer);
    const tryIt = () => {
        if (!overlay || overlay.isDestroyed()) return;
        overlay.webContents.executeJavaScript("window.__overlayConnect ? window.__overlayConnect() : false", true).catch(() => {});
    };
    tryIt();
    connectTimer = setInterval(tryIt, 3000);
}

// ---------------------------------------------------------------- opening .vil files
// The page's own file browser (the app's "Open a layout"): on some Linux desktops (niri) the
// system file dialog never shows up, and files dropped from Wayland apps don't reach an X11
// window. So the app lists folders and reads the chosen file itself: folders and .vil/.json
// files only, a file at most 1 MB.

function downloadsDir() {
    const dir = app.getPath("downloads");
    // no XDG download folder set up (a minimal desktop): Electron says the home folder
    return path.resolve(dir) === path.resolve(app.getPath("home")) ? path.join(dir, "Downloads") : dir;
}
const LAYOUT_FILE = /\.(vil|json)$/i;

ipcMain.handle("files:list", async (_e, wanted) => {
    const home = app.getPath("home");
    const places = [
        ["Downloads", downloadsDir()],
        ["Documents", app.getPath("documents")],
        ["Desktop", app.getPath("desktop")],
        ["Home", home],
    ]
        .filter(([label, p]) => fs.existsSync(p) && (label === "Home" || path.resolve(p) !== path.resolve(home))) // no XDG folders set up: Electron says the home folder
        .filter(([, p], i, all) => all.findIndex(([, q]) => path.resolve(q) === path.resolve(p)) === i);
    let dir = typeof wanted === "string" && wanted.trim() ? wanted.trim().replace(/^~(?=$|\/)/, home) : places[0]?.[1] || home;
    dir = path.resolve(dir);
    let names;
    try {
        if (!fs.statSync(dir).isDirectory()) dir = path.dirname(dir);
        names = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (e) {
        return { error: e.code === "ENOENT" ? `There's no folder ${dir}.` : `Can't open ${dir} (${e.code || e.message}).`, dir, places };
    }
    const entries = [];
    for (const d of names) {
        if (d.name.startsWith(".")) continue;
        const full = path.join(dir, d.name);
        let st;
        try {
            st = await fs.promises.stat(full); // follows links
        } catch {
            continue;
        }
        if (st.isDirectory()) entries.push({ name: d.name, path: full, dir: true });
        else if (st.isFile() && LAYOUT_FILE.test(d.name)) entries.push({ name: d.name, path: full, dir: false, mtime: st.mtimeMs, size: st.size });
    }
    entries.sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.dir ? a.name.localeCompare(b.name) : b.mtime - a.mtime));
    return { dir, parent: path.dirname(dir) !== dir ? path.dirname(dir) : null, places, entries: entries.slice(0, 1000) };
});

ipcMain.handle("files:read", async (_e, file) => {
    if (typeof file !== "string" || !LAYOUT_FILE.test(file)) throw new Error("Only .vil and .json files can be opened.");
    file = path.resolve(file.trim().replace(/^~(?=$|\/)/, app.getPath("home")));
    const st = await fs.promises.stat(file);
    if (!st.isFile()) throw new Error(`${file} isn't a file.`);
    if (st.size > 1024 * 1024) throw new Error("That file is too big to be a layout (over 1 MB).");
    return { name: path.basename(file), text: await fs.promises.readFile(file, "utf8") };
});

// ---------------------------------------------------------------- window frame and theme

// niri draws no title bars, so XWayland's helper (xwayland-satellite) gives X11 windows a plain
// white one that can only move and close. There the editor and settings windows go without a
// frame and the page draws its own bar (move, double-click to maximize, buttons, the app's
// colours). TOTEM_KEYBARD_TITLEBAR=own|system chooses it anywhere on Linux.
const OWN_BAR = process.platform === "linux" && (/^(own|system)$/.test(process.env.TOTEM_KEYBARD_TITLEBAR || "") ? process.env.TOTEM_KEYBARD_TITLEBAR === "own" : !!process.env.NIRI_SOCKET);

/** Light or dark as the desktop says, where Electron doesn't notice by itself (Linux without a full desktop). */
function systemPrefersDark() {
    const env = process.env.TOTEM_KEYBARD_THEME;
    if (env === "dark" || env === "light") return env === "dark";
    if (process.platform !== "linux") return null;
    if (/dark/i.test(process.env.GTK_THEME || "")) return true; // e.g. Adwaita:dark, Breeze-Dark
    const ask = (...args) => {
        try {
            return execFileSync(args[0], args.slice(1), { timeout: 700, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        } catch {
            return "";
        }
    };
    // GNOME and friends (also what the settings portal reports)
    const scheme = ask("gsettings", "get", "org.gnome.desktop.interface", "color-scheme");
    if (/prefer-dark/.test(scheme)) return true;
    if (/dark/i.test(ask("gsettings", "get", "org.gnome.desktop.interface", "gtk-theme"))) return true;
    // KDE: the colour scheme's name, or how dark its window background is
    try {
        const kde = fs.readFileSync(path.join(process.env.XDG_CONFIG_HOME || path.join(app.getPath("home"), ".config"), "kdeglobals"), "utf8");
        if (/^ColorScheme=.*dark/im.test(kde)) return true;
        const bg = /\[Colors:Window\][^[]*?^BackgroundNormal=(\d+),(\d+),(\d+)/ms.exec(kde);
        if (bg) return (Number(bg[1]) * 299 + Number(bg[2]) * 587 + Number(bg[3]) * 114) / 1000 < 128;
    } catch {
        /* no KDE settings */
    }
    if (/prefer-light|default/.test(scheme)) return false;
    return null;
}

function applyTheme() {
    const dark = systemPrefersDark();
    if (dark === true && !nativeTheme.shouldUseDarkColors) nativeTheme.themeSource = "dark";
    else if (process.env.TOTEM_KEYBARD_THEME === "light") nativeTheme.themeSource = "light";
}
const windowBg = () => (nativeTheme.shouldUseDarkColors ? "#141517" : "#f1f2f2");

/** The page's own title bar follows the window's state. */
function watchWindow(win) {
    const tell = () => !win.isDestroyed() && win.webContents.send("win:state", { maximized: win.isMaximized(), fullscreen: win.isFullScreen() });
    for (const ev of ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) win.on(ev, tell);
}
const senderWindow = (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    return win && win !== overlay ? win : null;
};
ipcMain.on("win:info", (e) => (e.returnValue = { ownBar: OWN_BAR && !!senderWindow(e), canMinimize: !process.env.NIRI_SOCKET }));
ipcMain.on("win:minimize", (e) => senderWindow(e)?.minimize());
ipcMain.on("win:maximize", (e) => {
    const win = senderWindow(e);
    if (!win) return;
    if (win.isFullScreen()) win.setFullScreen(false);
    else if (win.isMaximized()) win.unmaximize();
    else win.maximize();
});
ipcMain.on("win:fullscreen", (e) => {
    const win = senderWindow(e);
    if (win) win.setFullScreen(!win.isFullScreen());
});
ipcMain.on("win:close", (e) => senderWindow(e)?.close());

function openSettings() {
    if (settingsWin && !settingsWin.isDestroyed()) {
        settingsWin.show();
        settingsWin.focus();
        return settingsWin;
    }
    settingsWin = new BrowserWindow({
        width: 820,
        height: 940,
        minWidth: 420,
        minHeight: 400,
        title: "TOTEM overlay settings",
        icon: path.join(__dirname, "icon.png"),
        autoHideMenuBar: true,
        frame: !OWN_BAR,
        backgroundColor: windowBg(),
        webPreferences: webPreferences(),
    });
    watchWindow(settingsWin);
    settingsWin.setMenuBarVisibility(false);
    settingsWin.loadFile(HTML, { hash: "overlay-settings" });
    settingsWin.on("closed", () => (settingsWin = null));
    return settingsWin;
}

function openEditor() {
    if (editorWin && !editorWin.isDestroyed()) {
        editorWin.show();
        editorWin.focus();
        return editorWin;
    }
    editorWin = new BrowserWindow({
        width: 1440,
        height: 920,
        minWidth: 600,
        minHeight: 480,
        title: "totem-keybard",
        icon: path.join(__dirname, "icon.png"),
        autoHideMenuBar: true,
        frame: !OWN_BAR,
        backgroundColor: windowBg(),
        webPreferences: webPreferences(),
    });
    watchWindow(editorWin);
    editorWin.setMenuBarVisibility(false);
    editorWin.loadFile(HTML);
    editorWin.on("closed", () => (editorWin = null));
    return editorWin;
}

function setAdjusting(on) {
    adjusting = !!on;
    if (!overlay) return;
    if (adjusting && !visible) setVisible(true);
    overlay.setIgnoreMouseEvents(!adjusting);
    overlay.setFocusable(adjusting);
    if (adjusting) {
        showOverlay(false);
        overlay.focus();
    } else if (onNiri()) niriRemember(); // where it was moved to (niri knows, the app doesn't)
    overlay.webContents.send("ovl:adjusting", adjusting);
    updateTray();
}

function setVisible(on) {
    visible = !!on;
    if (!overlay) return;
    if (visible) showOverlay();
    else {
        if (adjusting) setAdjusting(false);
        overlay.hide();
    }
    saveState();
    updateTray();
}

/** Show it; under niri with a fixed size first, so niri opens it floating (niriSettle frees it). */
function showOverlay(inactive = true) {
    if (!overlay) return;
    if (onNiri() && !overlay.isVisible()) overlay.setResizable(false);
    if (inactive) overlay.showInactive();
    else overlay.show();
}

function resizeOverlay(width, height) {
    if (!overlay) return;
    const b = overlay.getBounds();
    const wa = screen.getDisplayMatching(b).workArea;
    const w = Math.round(Math.max(220, Math.min(width, wa.width))),
        h = Math.round(Math.max(100, Math.min(height, wa.height)));
    if (onNiri()) return niriResize(w, h);
    // keep the bottom edge where it is, so growing doesn't run off the screen
    const y = Math.max(wa.y, Math.min(b.y + b.height - h, wa.y + wa.height - h));
    const x = Math.max(wa.x, Math.min(b.x, wa.x + wa.width - w));
    const fixed = process.platform === "linux" && !overlay.isResizable(); // GTK pins the size of fixed-size windows
    if (fixed) overlay.setResizable(true);
    overlay.setBounds({ x, y, width: w, height: h });
    if (fixed) overlay.setResizable(false);
}

function placeBottom() {
    if (!overlay) return;
    if (onNiri()) return niriDo(niriBottom);
    const b = overlay.getBounds();
    overlay.setBounds(bottomCentre(screen.getDisplayMatching(b), b.width, b.height));
}

// ---------------------------------------------------------------- niri
// niri (a Wayland compositor) shows the overlay, through XWayland, as one of its own windows:
// it places and sizes it, and ignores the app moving or resizing itself. So under niri the
// overlay asks niri, over the socket `niri msg` uses ($NIRI_SOCKET), with the same requests.

const onNiri = () => process.platform === "linux" && !!process.env.NIRI_SOCKET;
let niriScale = 1; // niri's pixels per app pixel (1 unless X11 apps get another scale than the screen)

/** One request, one reply (a line of JSON each way). */
function niri(request) {
    return new Promise((resolve, reject) => {
        const sock = net.createConnection(process.env.NIRI_SOCKET);
        let buf = "";
        sock.setEncoding("utf8");
        sock.setTimeout(2000, () => sock.destroy(new Error("niri didn't answer")));
        sock.on("connect", () => sock.write(JSON.stringify(request) + "\n"));
        sock.on("data", (d) => {
            buf += d;
            const nl = buf.indexOf("\n");
            if (nl < 0) return;
            sock.end();
            try {
                const reply = JSON.parse(buf.slice(0, nl));
                if ("Ok" in reply) resolve(reply.Ok);
                else reject(new Error(String(reply.Err)));
            } catch (e) {
                reject(e);
            }
        });
        sock.on("error", reject);
    });
}
const niriAction = (action) => niri({ Action: action });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The overlay as niri sees it, or null. */
async function niriWindow() {
    const { Windows } = await niri("Windows");
    return Windows.find((w) => w.title === OVERLAY_TITLE) || null;
}

/** niri requests run one after another. */
let niriQueue = Promise.resolve();
function niriDo(fn) {
    niriQueue = niriQueue.then(fn).catch((e) => console.error("niri:", e.message));
    return niriQueue;
}

/** Just shown: once niri has it (floating, as it had a fixed size), let niri resize it and put it back where it was. */
function niriSettle() {
    niriDo(async () => {
        let win = null;
        for (let i = 0; i < 50 && !win; i++) {
            win = await niriWindow().catch(() => null);
            if (!win) await sleep(100);
        }
        if (!win || !overlay || overlay.isDestroyed()) return;
        const r = win.layout.window_size[0] / (overlay.getContentSize()[0] || 1);
        niriScale = r > 0.2 && r < 5 && Math.abs(r - 1) > 0.02 ? r : 1;
        if (!win.is_floating) await niriAction({ MoveWindowToFloating: { id: win.id } }); // a window rule tiled it
        overlay.setResizable(true); // niri keeps a window's size within its size limits
        overlay.webContents.invalidate(); // a new frame carries the new limits to niri
        await sleep(100);
        const pos = (await niriWindow())?.layout.tile_pos_in_workspace_view;
        if (niriPlace && pos) await niriMove(win.id, niriPlace[0] - pos[0], niriPlace[1] - pos[1]);
        else if (!niriPlace) await niriBottom();
    });
}

const niriMove = (id, dx, dy) => niriAction({ MoveFloatingWindow: { id, x: { AdjustFixed: dx }, y: { AdjustFixed: dy } } });

/** Remember where it is (after the user moved it, or the app placed it). */
function niriRemember() {
    niriDo(async () => {
        const pos = (await niriWindow())?.layout.tile_pos_in_workspace_view;
        if (pos) {
            niriPlace = [Math.round(pos[0]), Math.round(pos[1])];
            saveState();
        }
    });
}

/** Bottom centre of the working area (niri knows it: the screen less any bars). */
async function niriBottom() {
    const win = await niriWindow();
    if (!win) return;
    await niriAction({ CenterWindow: { id: win.id } });
    await niriAction({ MoveFloatingWindow: { id: win.id, x: { AdjustFixed: 0 }, y: { SetProportion: 100 } } });
    await niriMove(win.id, 0, -(win.layout.tile_size[1] + 24));
    await sleep(50);
    niriRemember();
}

/** Resize (in the app's pixels), keeping the bottom edge. Called for every move of the grip: only the latest size is asked for. */
let niriWanted = null,
    niriSizing = false;
function niriResize(width, height) {
    niriWanted = [width, height];
    if (niriSizing) return;
    niriSizing = true;
    niriDo(async () => {
        while (niriWanted) {
            const w = Math.round(niriWanted[0] * niriScale),
                h = Math.round(niriWanted[1] * niriScale);
            niriWanted = null;
            const win = await niriWindow();
            if (!win) return;
            const [ww, wh] = win.layout.window_size;
            if (w !== ww) await niriAction({ SetWindowWidth: { id: win.id, change: { SetFixed: w } } });
            if (h !== wh) {
                await niriAction({ SetWindowHeight: { id: win.id, change: { SetFixed: h } } });
                await niriMove(win.id, 0, wh - h); // keep the bottom edge where it is
            }
            // wait until it has the new size, so the next step starts from there
            for (let i = 0; i < 20; i++) {
                const now = await niriWindow();
                if (!now || (now.layout.window_size[0] === w && now.layout.window_size[1] === h)) break;
                await sleep(25);
            }
        }
    }).finally(() => {
        niriSizing = false;
        niriRemember();
    });
}

// ---------------------------------------------------------------- tray

function trayIcon() {
    if (process.platform === "darwin") {
        const img = nativeImage.createFromPath(path.join(__dirname, "trayTemplate.png"));
        img.setTemplateImage(true);
        return img;
    }
    return nativeImage.createFromPath(path.join(__dirname, process.platform === "win32" ? "tray.png" : "tray@2x.png"));
}

function updateTray() {
    if (!tray) return;
    tray.setContextMenu(
        Menu.buildFromTemplate((menuTemplate = [
            { label: `TOTEM Overlay ${VERSION}`, enabled: false },
            { type: "separator" },
            { label: "Show overlay", type: "checkbox", checked: visible, click: (i) => setVisible(i.checked) },
            { label: "Move and resize", type: "checkbox", checked: adjusting, click: (i) => setAdjusting(i.checked) },
            { label: "Place at bottom centre", click: () => placeBottom() },
            keyboard.unlocked
                ? { label: "Lock keyboard (hide held keys)", click: () => sendToOverlay("lock") }
                : { label: "Unlock to show held keys…", enabled: keyboard.connected && keyboard.supported, click: () => sendToOverlay("unlock") },
            { type: "separator" },
            { label: "Overlay settings…", click: () => openSettings() },
            { label: "Open editor…", click: () => openEditor() },
            { type: "separator" },
            { label: "Quit TOTEM Overlay", click: () => app.quit() },
        ])),
    );
}

function createTray() {
    try {
        tray = new Tray(trayIcon());
        tray.setToolTip("TOTEM Overlay");
        if (process.platform !== "darwin") tray.on("click", () => openSettings());
        updateTray();
    } catch (e) {
        console.error("No tray icon:", e.message);
    }
}

// ---------------------------------------------------------------- keyboard access and safety

function setUpSession() {
    const ses = session.defaultSession;
    // The pages may talk to HID devices (the TOTEM); nothing else is asked for.
    ses.setPermissionCheckHandler((_wc, permission) => permission === "hid");
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setDevicePermissionHandler((details) => details.deviceType === "hid");
    // navigator.hid.requestDevice(): pick the TOTEM without asking (the page filters for
    // Vial's Raw HID interface already).
    ses.on("select-hid-device", (event, details, callback) => {
        event.preventDefault();
        const list = details.deviceList || [];
        const pick = list.find((d) => /totem/i.test(d.name || d.productName || "")) || list[0];
        callback(pick ? pick.deviceId : "");
    });
    // "Save the layout" (a download from the page): straight into the Downloads folder, without a
    // save dialog (on some Linux desktops it never shows up and the download waits for good). The
    // page then says where the file is.
    const taken = new Set();
    ses.on("will-download", (_e, item, wc) => {
        let dir = downloadsDir();
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch {
            dir = app.getPath("home");
        }
        const name = path.basename(item.getFilename() || "totem-layout.vil");
        const ext = path.extname(name),
            base = name.slice(0, name.length - ext.length);
        let file = path.join(dir, name);
        for (let i = 2; fs.existsSync(file) || taken.has(file); i++) file = path.join(dir, `${base} (${i})${ext}`);
        taken.add(file);
        item.setSavePath(file);
        item.once("done", (_e2, result) => {
            taken.delete(file);
            if (!wc.isDestroyed()) wc.send("ovl:saved", result === "completed" ? { file } : { error: result });
        });
    });
}

app.on("web-contents-created", (_e, wc) => {
    // only this app's own page; links open in the normal browser
    wc.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//.test(url)) shell.openExternal(url);
        return { action: "deny" };
    });
    wc.on("will-navigate", (ev, url) => {
        if (!url.startsWith("file://")) {
            ev.preventDefault();
            if (/^https?:\/\//.test(url)) shell.openExternal(url);
        }
    });
});

// ---------------------------------------------------------------- IPC from the pages

ipcMain.on("ovl:version", (e) => (e.returnValue = VERSION));
ipcMain.on("ovl:test-mock", (e) => {
    try {
        e.returnValue = TEST_MOCK ? fs.readFileSync(TEST_MOCK, "utf8") : "";
    } catch {
        e.returnValue = "";
    }
});
ipcMain.on("ovl:adjust", (_e, on) => {
    if (on && !overlay) startOverlay();
    setAdjusting(on);
});
ipcMain.on("ovl:resize", (_e, w, h) => resizeOverlay(Number(w) || 0, Number(h) || 0));
ipcMain.on("ovl:move", (_e, dx, dy) => {
    if (!overlay) return;
    const b = overlay.getBounds();
    overlay.setPosition(Math.round(b.x + (Number(dx) || 0)), Math.round(b.y + (Number(dy) || 0)));
});
ipcMain.handle("ovl:bounds", () => {
    const b = overlay ? overlay.getBounds() : { x: 0, y: 0, width: 760, height: 280 };
    return { ...b, screen: screen.getDisplayMatching(b).workArea };
});
ipcMain.on("ovl:bottom", () => placeBottom());
ipcMain.on("ovl:visible", (_e, on) => setVisible(on));
ipcMain.on("ovl:settings", () => {
    if (!overlay) startOverlay();
    openSettings();
});
ipcMain.on("ovl:editor", () => openEditor());
ipcMain.on("ovl:unlock", () => sendToOverlay("unlock"));
ipcMain.on("ovl:lock", () => sendToOverlay("lock"));
ipcMain.on("ovl:state", (e, s) => {
    if (!overlay || e.sender !== overlay.webContents) return; // only the overlay knows
    keyboard = { connected: !!s.connected, supported: !!s.supported, unlocked: !!s.unlocked };
    updateTray();
});
// While the overlay shows the keys to hold for an unlock, it has to be on screen.
ipcMain.on("ovl:unlocking", (e, on) => {
    if (!overlay || e.sender !== overlay.webContents) return;
    if (on && !visible) {
        unlockShown = true;
        showOverlay();
    } else if (!on && unlockShown) {
        unlockShown = false;
        if (!visible) overlay.hide();
    }
    if (on) overlay.moveTop();
});

/** Unlock / lock: the overlay page holds the connection to the keyboard, so it does it. */
function sendToOverlay(command) {
    if (!overlay) startOverlay();
    const wc = overlay.webContents;
    if (wc.isLoading()) wc.once("did-finish-load", () => wc.send("ovl:command", command));
    else wc.send("ovl:command", command);
}

// ---------------------------------------------------------------- start

function start() {
    applyTheme();
    setUpSession();
    if (EDITOR_ONLY) openEditor();
    else startOverlay();
    if (TEST_SCRIPT) require(TEST_SCRIPT)({ app, overlay: () => overlay, editor: () => editorWin, startOverlay, openSettings, openEditor, setAdjusting, setVisible, resizeOverlay, placeBottom, menu: () => menuTemplate, keyboard: () => keyboard, niriIdle: () => niriQueue, niriPlace: () => niriPlace });
}

let started = false;
function startOverlay() {
    if (started) return;
    started = true;
    if (process.platform === "darwin" && app.dock) app.dock.hide();
    createOverlay();
    createTray();
    // Some systems take "always on top" back (full-screen apps, other overlays): put it back.
    setInterval(() => {
        if (overlay && visible && !adjusting && !overlay.isDestroyed()) overlay.moveTop();
    }, 2000);
    screen.on("display-removed", () => overlay && overlay.setBounds(initialBounds()));
    // First start (or no tray, as on plain GNOME): show the settings so the overlay can be found.
    if (!fs.existsSync(STATE_FILE()) || !tray) openSettings();
    saveState();
}

app.on("window-all-closed", () => {
    // the overlay keeps running in the tray; the editor on its own quits with its window
    if (!overlay) app.quit();
});

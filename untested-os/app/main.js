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
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, session, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

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
            fs.writeFileSync(STATE_FILE(), JSON.stringify({ bounds: overlay.getBounds(), visible }, null, 2));
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
    overlay = new BrowserWindow({
        ...initialBounds(),
        title: "TOTEM overlay",
        transparent: true,
        backgroundColor: "#00000000",
        frame: false,
        hasShadow: false,
        resizable: false,
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
    overlay.loadFile(HTML, { hash: "overlay" });
    overlay.once("ready-to-show", () => {
        if (visible) overlay.showInactive();
        connectSoon();
    });
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
        backgroundColor: "#f1f2f2",
        webPreferences: webPreferences(),
    });
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
        backgroundColor: "#f1f2f2",
        webPreferences: webPreferences(),
    });
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
        overlay.show();
        overlay.focus();
    }
    overlay.webContents.send("ovl:adjusting", adjusting);
    updateTray();
}

function setVisible(on) {
    visible = !!on;
    if (!overlay) return;
    if (visible) overlay.showInactive();
    else {
        if (adjusting) setAdjusting(false);
        overlay.hide();
    }
    saveState();
    updateTray();
}

function resizeOverlay(width, height) {
    if (!overlay) return;
    const b = overlay.getBounds();
    const wa = screen.getDisplayMatching(b).workArea;
    const w = Math.round(Math.max(220, Math.min(width, wa.width))),
        h = Math.round(Math.max(100, Math.min(height, wa.height)));
    // keep the bottom edge where it is, so growing doesn't run off the screen
    const y = Math.max(wa.y, Math.min(b.y + b.height - h, wa.y + wa.height - h));
    const x = Math.max(wa.x, Math.min(b.x, wa.x + wa.width - w));
    if (process.platform === "linux") overlay.setResizable(true); // GTK pins the size of fixed-size windows
    overlay.setBounds({ x, y, width: w, height: h });
    if (process.platform === "linux") overlay.setResizable(false);
}

function placeBottom() {
    if (!overlay) return;
    const b = overlay.getBounds();
    overlay.setBounds(bottomCentre(screen.getDisplayMatching(b), b.width, b.height));
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
        overlay.showInactive();
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
    setUpSession();
    if (EDITOR_ONLY) openEditor();
    else startOverlay();
    if (TEST_SCRIPT) require(TEST_SCRIPT)({ app, overlay: () => overlay, editor: () => editorWin, startOverlay, openSettings, openEditor, setAdjusting, setVisible, resizeOverlay, placeBottom, menu: () => menuTemplate, keyboard: () => keyboard });
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

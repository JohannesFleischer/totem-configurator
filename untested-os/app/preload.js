// Gives the pages a small, fixed set of things they can ask the overlay app to do.
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

const host = {
    version: ipcRenderer.sendSync("ovl:version"),
    setAdjusting: (on) => ipcRenderer.send("ovl:adjust", !!on),
    resizeTo: (width, height) => ipcRenderer.send("ovl:resize", Number(width), Number(height)),
    moveBy: (dx, dy) => ipcRenderer.send("ovl:move", Number(dx), Number(dy)),
    getBounds: () => ipcRenderer.invoke("ovl:bounds"),
    placeBottom: () => ipcRenderer.send("ovl:bottom"),
    setVisible: (on) => ipcRenderer.send("ovl:visible", !!on),
    openSettings: () => ipcRenderer.send("ovl:settings"),
    openEditor: () => ipcRenderer.send("ovl:editor"),
    onAdjusting: (fn) => {
        ipcRenderer.on("ovl:adjusting", (_e, on) => fn(!!on));
    },
    unlock: () => ipcRenderer.send("ovl:unlock"),
    lock: () => ipcRenderer.send("ovl:lock"),
    reportState: (s) => ipcRenderer.send("ovl:state", { connected: !!s.connected, supported: !!s.supported, unlocked: !!s.unlocked }),
    setUnlocking: (on) => ipcRenderer.send("ovl:unlocking", !!on),
    onCommand: (fn) => {
        ipcRenderer.on("ovl:command", (_e, c) => (c === "unlock" || c === "lock") && fn(c));
    },
    // the window itself: where the app draws its own title bar (ownBar), the page shows it
    window: Object.assign(ipcRenderer.sendSync("win:info") || {}, {
        minimize: () => ipcRenderer.send("win:minimize"),
        toggleMaximize: () => ipcRenderer.send("win:maximize"),
        toggleFullscreen: () => ipcRenderer.send("win:fullscreen"),
        close: () => ipcRenderer.send("win:close"),
        onState: (fn) => {
            ipcRenderer.on("win:state", (_e, s) => fn({ maximized: !!(s && s.maximized), fullscreen: !!(s && s.fullscreen) }));
        },
    }),
    // folders and .vil files, for the page's own "Open a layout" (no system file dialog needed)
    files: {
        list: (dir) => ipcRenderer.invoke("files:list", dir == null ? null : String(dir)),
        read: (file) => ipcRenderer.invoke("files:read", String(file)),
    },
    onSaved: (fn) => {
        ipcRenderer.on("ovl:saved", (_e, r) => fn(r && r.file ? { file: String(r.file) } : { error: String((r && r.error) || "failed") }));
    },
};

// Tests only: the app was started with a simulated TOTEM, which goes into the page itself.
// (The editor window keeps the real navigator.hid, so a test also covers picking a device.)
const mock = location.hash ? ipcRenderer.sendSync("ovl:test-mock") : "";
if (mock) {
    window.eval(mock);
    if (window.__mock) window.__mock.permitted = true;
    window.overlayHost = host;
} else if (process.contextIsolated) {
    contextBridge.exposeInMainWorld("overlayHost", host);
} else {
    window.overlayHost = host;
}

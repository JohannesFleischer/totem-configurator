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

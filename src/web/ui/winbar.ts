// The window's title bar, drawn by the page where the overlay app's windows have no frame
// (under niri: see the app's main.js). The bar moves the window; a double-click on it maximizes
// (Chromium does both for a drag region); the buttons and F11 ask the app.
import { overlayHost } from "../overlay-settings";
import { h, icon } from "./dom";

const I = {
    min: '<path d="M5 12h14"/>',
    max: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    restore: '<rect x="5" y="8" width="11" height="11" rx="2"/><path d="M9 8V6a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-2"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
};

export function initWindowBar() {
    const win = overlayHost()?.window;
    if (!win) return;
    // F11: full screen, with or without the app's own bar
    window.addEventListener("keydown", (e) => {
        if (e.key !== "F11") return;
        e.preventDefault();
        win.toggleFullscreen();
    });
    if (!win.ownBar) return;
    const maxBtn = h("button", { class: "winbtn", "aria-label": "Maximize", title: "Maximize (or double-click the bar)", onClick: () => win.toggleMaximize() }, icon(I.max, 16));
    const title = h("span", { class: "winbar-title" }, document.title);
    const bar = h(
        "div",
        { class: "winbar" },
        title,
        h(
            "div",
            { class: "winbar-buttons" },
            win.canMinimize ? h("button", { class: "winbtn", "aria-label": "Minimize", title: "Minimize", onClick: () => win.minimize() }, icon(I.min, 16)) : null,
            maxBtn,
            h("button", { class: "winbtn close", "aria-label": "Close", title: "Close", onClick: () => win.close() }, icon(I.close, 16)),
        ),
    );
    document.documentElement.classList.add("has-winbar");
    document.body.prepend(bar);
    new MutationObserver(() => (title.textContent = document.title)).observe(document.querySelector("title")!, { childList: true });
    win.onState((s) => {
        const big = s.maximized || s.fullscreen;
        maxBtn.replaceChildren(icon(big ? I.restore : I.max, 16));
        maxBtn.title = s.fullscreen ? "Leave full screen" : big ? "Restore" : "Maximize (or double-click the bar)";
        maxBtn.setAttribute("aria-label", big ? "Restore" : "Maximize");
    });
}

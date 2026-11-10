import { initOverlay } from "./ui/overlay-view";
import { initOverlaySettings } from "./ui/overlay-settings-page";
import { initShell } from "./ui/shell";
import { initWindowBar } from "./ui/winbar";

// One file, three pages: the editor, and (in the overlay app) the overlay and its settings.
const app = document.getElementById("app")!;
const page = location.hash.slice(1);
if (page === "overlay") initOverlay(app);
else if (page === "overlay-settings") initOverlaySettings(app);
else initShell(app);
if (page !== "overlay") initWindowBar();

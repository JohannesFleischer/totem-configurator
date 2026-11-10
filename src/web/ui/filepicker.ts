// "Open a layout" in the overlay app: its own little file browser. On some Linux desktops
// (niri) the system file dialog never shows up, and a file dropped from a Wayland app doesn't
// reach the app's (X11) window; so the app lists folders and reads the file itself. In a
// browser, the browser's file dialog.
import { overlayHost, type FolderListing } from "../overlay-settings";
import { h, icon } from "./dom";

const FOLDER = '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>';
const FILE = '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8"/>';
const UP = '<path d="m18 15-6-6-6 6"/>';

/** Pick a .vil (or .json) file; `input` is the page's file input, used where the app can't list files (a browser). */
export function pickLayoutFile(input: HTMLInputElement, onFile: (f: File) => void) {
    const files = overlayHost()?.files;
    if (!files) return input.click();
    void browse(files, input).then((f) => f && onFile(f));
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
const when = (ms?: number) => (ms ? new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");
let lastDir: string | null = null; // where the browser was last time

function browse(files: NonNullable<ReturnType<typeof overlayHost>>["files"] & object, input: HTMLInputElement): Promise<File | null> {
    return new Promise((resolve) => {
        let done = false;
        const close = (f: File | null) => {
            if (done) return;
            done = true;
            wrap.remove();
            window.removeEventListener("keydown", onKey, true);
            resolve(f);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            close(null);
        };
        const pathIn = h("input", { class: "fp-path", type: "text", spellcheck: "false", "aria-label": "Folder or file", placeholder: "~/Downloads" });
        const places = h("div", { class: "fp-places" });
        const list = h("div", { class: "fp-list", role: "list" });
        const msg = h("div", { class: "small muted fp-msg", role: "status" });
        const row = (cls: string, svg: string, name: string, meta: string, act: () => void, title?: string) =>
            h("button", { class: ["fp-row", cls], title: title ?? name, onClick: act }, icon(svg, 16), h("span", { class: "name" }, name), h("span", { class: "meta" }, meta));

        async function go(dir: string | null) {
            let r: FolderListing;
            try {
                r = await files.list(dir);
            } catch (e) {
                msg.textContent = message(e);
                return;
            }
            if (done) return;
            pathIn.value = r.dir;
            places.replaceChildren(
                ...r.places.map(([label, p]) => h("button", { class: ["pill", "sm", p !== r.dir && "ghost"], onClick: () => go(p) }, label)),
            );
            if (r.error) {
                list.replaceChildren();
                msg.textContent = r.error;
                return;
            }
            lastDir = r.dir;
            const entries = r.entries ?? [];
            list.replaceChildren(
                ...(r.parent ? [row("up", UP, "..", "up a folder", () => go(r.parent!), r.parent)] : []),
                ...entries.map((e) => (e.dir ? row("dir", FOLDER, e.name, "", () => go(e.path)) : row("file", FILE, e.name, when(e.mtime), () => open(e.path), e.path))),
            );
            msg.textContent = entries.some((e) => !e.dir) ? "" : "No .vil files in this folder.";
            (list.querySelector<HTMLElement>(".fp-row.file") ?? list.querySelector<HTMLElement>(".fp-row"))?.focus();
        }
        async function open(file: string) {
            try {
                const { name, text } = await files.read(file);
                close(new File([text], name, { type: "application/json" }));
            } catch (e) {
                msg.textContent = message(e);
            }
        }
        // a folder (the list goes there) or a .vil file (opens it); ~ is the home folder
        const typed = () => {
            const v = pathIn.value.trim();
            if (/\.(vil|json)$/i.test(v)) void open(v);
            else void go(v);
        };
        pathIn.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), typed()));

        const wrap = h(
            "div",
            { class: "overlay", onClick: (e: Event) => e.target === wrap && close(null) },
            h(
                "div",
                { class: "modal wide fp", role: "dialog", "aria-label": "Open a layout" },
                h("h2", null, "Open a layout"),
                places,
                h("div", { class: "fp-pathrow" }, pathIn, h("button", { class: "pill sm ghost", onClick: typed }, "Go")),
                list,
                msg,
                h(
                    "div",
                    { class: "actions" },
                    h(
                        "button",
                        {
                            class: "pill ghost fp-system",
                            title: "Your desktop's own file dialog (if it shows up)",
                            onClick: () => {
                                close(null);
                                input.click();
                            },
                        },
                        "System dialog…",
                    ),
                    h("span", { style: "flex:1" }),
                    h("button", { class: "pill ghost", onClick: () => close(null) }, "Cancel"),
                ),
            ),
        );
        window.addEventListener("keydown", onKey, true);
        document.body.appendChild(wrap);
        void go(lastDir);
    });
}

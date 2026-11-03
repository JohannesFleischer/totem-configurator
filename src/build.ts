// Build: bundle web/main.ts and inline it, with the CSS, into one self-contained HTML file,
// then put the ready-to-use files where people use them:
//
//   ../untested-os/totem-keybard.html   the configurator on its own (Chrome, Edge, Brave …)
//   ../untested-os/app/                 the overlay app for the start scripts (Electron)
//   ../nix/app/                         the same app, for nix/totem-keybard.nix and nix/shell.nix
//
// Run with Bun (https://bun.sh) in this folder:  bun run build.ts   (--dev: not minified)
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const minify = !process.argv.includes("--dev");
let rev = "";
try {
    rev = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
} catch {}
// A fixed stamp (TOTEM_KEYBARD_STAMP) keeps the build reproducible.
const stamp = process.env.TOTEM_KEYBARD_STAMP || `${new Date().toISOString().slice(0, 10)}${rev ? " · " + rev : ""}`;

const result = await Bun.build({
    entrypoints: ["web/main.ts"],
    target: "browser",
    format: "iife",
    minify,
    define: { __BUILD__: JSON.stringify(stamp) },
});
if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
}
const js = (await result.outputs[0].text()).replace(/<\/script/gi, "<\\/script");
const css = readFileSync("web/styles.css", "utf8");
const template = readFileSync("web/index.html", "utf8");
const html = template.replace("/*STYLES*/", () => css).replace("/*SCRIPT*/", () => js);

const write = (path: string, data: string) => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, data);
};
write("../untested-os/totem-keybard.html", html);
// the overlay app: the Electron files from electron/ plus the page
for (const dir of ["../untested-os/app", "../nix/app"]) {
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync("electron")) copyFileSync(join("electron", f), join(dir, f));
    writeFileSync(join(dir, "totem-keybard.html"), html);
}
console.log(`totem-keybard.html  ${(html.length / 1024).toFixed(1)} KB  (${stamp})  -> untested-os/, untested-os/app/, nix/app/`);

# totem-keybard

An unofficial, minimal configurator for the [GEIST TOTEM](https://github.com/GEIGEIGEIST/TOTEM)
split keyboard running [Vial](https://get.vial.today), modelled on Svalboard's
[keybard](https://github.com/svalboard/keybard), plus a see-through desktop overlay that shows
your layout and follows the layer you're on — handy while you learn a new layout.
Not affiliated with Svalboard or GEIST.

> **Disclaimer:** this project is vibecoded (written with an AI assistant) and will probably
> be unmaintained. Use it at your own risk, and save your layout as a `.vil` file before flashing.

## What's here

| Folder         |                                                                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`         | the source: the web app (`web/`), the overlay's Electron files (`electron/`), tests, data generators, `build.ts`                                            |
| `nix/`         | NixOS: `totem-keybard.nix` (a dendritic flake part), `shell.nix`, and `app/` with the prebuilt files both run                                               |
| `untested-os/` | everything else: `totem-keybard.html` (the configurator as a single file) and start scripts for the overlay on Windows, macOS and other Linux distributions |
| `firmware/`    | TOTEM Vial firmware with mouse and media keys and the overlay's layer report; patch and build notes                                                         |

`nix/app/` and `untested-os/` are built from `src/` and checked in, so nothing has to be built to use them.

## Usage

**Configurator:** run `totem-keybard` (NixOS), or open `untested-os/totem-keybard.html` in
Chrome, Edge or Brave (it needs WebHID). Click Connect, click a key, then pick or type its new
one; changes are written to the keyboard at once. Layouts load and save as Vial `.vil` files.

**Overlay:** run `totem-overlay` (NixOS) or the start script for your system in `untested-os/`
(the first start downloads Electron 44.9.0 from GitHub and checks its SHA-256). Its settings and
"Move and resize" are in its tray icon. It follows your layers only with the firmware below.
Held keys light up while the keyboard is unlocked: tray → "Unlock to show held keys…" (or the
button in its settings) turns the overlay into a prompt showing the two keys to hold.

**NixOS:** copy `nix/totem-keybard.nix` and `nix/app/` into your flake-parts modules folder,
then in your host:

```nix
imports = [ self.nixosModules.totem-keybard ];
services.udev.packages = with pkgs; [ vial ]; # Vial's udev rule: access to the keyboard
```

This also adds "TOTEM keybard" and "TOTEM Overlay" to your app launcher. You can also try it
with `nix-shell nix/shell.nix`.

**Other Linux distributions:** `untested-os/start-overlay-linux.sh --add-to-launcher` adds the
same two launcher entries for your user (`--remove-from-launcher` takes them out; run it again
if you move the folder). You also need
[Vial's udev rule](https://get.vial.today/manual/linux-udev.html).

## Firmware

`firmware/` has current vial-qmk for the TOTEM with mouse keys, media keys, dynamic macros and a
small read-only report of the active layer for the overlay. To flash: save your layout as a
`.vil`; double-tap the reset button on the left half's XIAO RP2040 and copy
`totem_vial_keybard_left.uf2` onto the `RPI-RP2` drive; do the same for the right half with
`totem_vial_keybard_right.uf2`; reconnect and open your `.vil` to write your layout back.
Source, patch and details: [`firmware/BUILD.md`](firmware/BUILD.md).

## Development

```bash
cd src
bun run build.ts                        # -> nix/app/, untested-os/totem-keybard.html, untested-os/app/
bun test                                # unit tests
python3 test/e2e.py                     # UI tests against a simulated TOTEM (Playwright)
test/overlay-app.sh <electron folder>   # the overlay app itself, under Xvfb
```

No npm dependencies; [Bun](https://bun.sh) builds it.

## Licence and credits

totem-keybard is free software under the GNU General Public License, version 2 or (at your
option) any later version — see [`LICENSE.md`](LICENSE.md). It has to be: it contains data
from the Vial GUI, which is GPL-2.0-or-later.

- [keybard](https://github.com/svalboard/keybard) by Svalboard — the look and way of working
  this is modelled on. No keybard code or artwork is included.
- [Vial GUI](https://github.com/vial-kb/vial-gui) — keycode tables and the QMK settings schema
  (GPL-2.0-or-later).
- [vial-qmk](https://github.com/vial-kb/vial-qmk) / [QMK](https://github.com/qmk/qmk_firmware) —
  the firmware, and what each key types on 69 computer keyboard layouts (GPL-2.0-or-later).
- [TOTEM](https://github.com/GEIGEIGEIST/TOTEM) by GEIST — the key layout, default keymap and
  Vial definition (CERN-OHL-P-2.0; the keymap GPL-2.0-or-later).
- [Lucide](https://lucide.dev) — several icons are adapted from Lucide (ISC), some of which come
  from [Feather](https://feathericons.com) (MIT); notices below.
- [Electron](https://www.electronjs.org) (MIT) — the overlay's runtime. Not included: nixpkgs or
  the start scripts provide it.

<details>
<summary>Lucide and Feather licence notices</summary>

```
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

```
The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>

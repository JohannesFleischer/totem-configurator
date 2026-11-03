# TOTEM Vial firmware for totem-keybard

| File | For | SHA-256 |
|---|---|---|
| `totem_vial_keybard_left.uf2` | left half | `4a4738f34b400e59eb9b1712235a0fd10a9381eb0add11852be1a244853e3b91` |
| `totem_vial_keybard_right.uf2` | right half | `08ea76a9a60a75d6d248c593959fcff4029baaee9c909d461cabeac1916f3475` |

How to flash: see "Firmware" in the README. Save your layout as a `.vil`
first; a new firmware resets the keymap.

## What it is

- Source: [vial-kb/vial-qmk](https://github.com/vial-kb/vial-qmk) at commit
  `dd43959ae5c08d8a28d38a1acf7b04e86b14a344` (2026-07-27), keyboard `geigeigeist/totem`, keymap `vial`.
- Changes (`vial-qmk-totem-keybard.patch`), all in `keyboards/geigeigeist/totem/keymaps/vial/`:
  - `rules.mk`:
    - `MOUSEKEY_ENABLE = yes` — mouse keys (cursor, buttons, wheel, acceleration)
    - `EXTRAKEY_ENABLE = yes` — media and system keys (volume, play/pause, sleep, …)
    - `DYNAMIC_MACRO_ENABLE = yes` — dynamic macro recording (DM_REC1/DM_PLY1), as in the TOTEM repo's Vial build
    - `SRC += overlay_report.c`
  - `overlay_report.c` (new) — the overlay report, below.
- `keymaps/vial/vial.json` replaced by the one from
  [GEIGEIGEIST/TOTEM](https://github.com/GEIGEIGEIST/TOTEM) (commit `410e566`,
  `firmware/QMK/VIAL_source/totem/keymaps/vial/vial.json`): same keys and matrix, but the Vial
  app draws the halves the right way round.
- Everything else as in vial-qmk: Vial protocol 6, 16 layers, Vial keyboard UID
  `CB 37 36 FE EE ED EE 77`, unlock keys = the two top outer keys, split over serial with
  handedness stored on each half (EE_HANDS).
- Each file is built with `INIT_EE_HANDS_LEFT` or `INIT_EE_HANDS_RIGHT`, so it also tells its half
  which side it is (that's why there are two files).

## The overlay report

`overlay_report.c` implements `raw_hid_receive_kb()`, which VIA calls for command ids it doesn't
know. It answers one new, read-only command on the same Raw HID interface VIA and Vial use:

```
request  [0] 0xF0  [1..4] "TKOV"  [5] what  [6] client tag  [7] 0  [8..] arguments
reply    the same 32 bytes, [7] = 1 (report version), the answer from [8]
```

| what | answer |
|---|---|
| `0x01` state | layer state (u32 LE), default layer state (u32), held modifiers, flags (Caps Lock, Caps Word, unlocked, held keys included), held keys per matrix row — **only while the keyboard is unlocked** |
| `0x02` info | layer and macro counts, rows, cols, tap dance / combo / key override / alt repeat counts and feature bits (as Vial reports them), keyboard UID, Vial protocol |
| `0x03` keymap | up to 20 bytes of the dynamic keymap from an offset (like VIA's `dynamic_keymap_get_buffer`) |
| `0x04` keymap checksum | Fletcher-16 over the whole keymap, so the overlay notices edits made by any program |

The tag lets two programs share the keyboard (the keyboard sends each reply to every program
that has it open): the overlay takes only replies with its own tag, the editor skips tagged
ones. A reply with `[7] == 0` wasn't handled (Vial ignores other commands while an unlock is in
progress); an older firmware answers `[0] == 0xFF`. Nothing in the report changes the keyboard,
and held keys follow Vial's rule for its key tester (`id_switch_matrix_state`): only after an
unlock.

## Checks

- After building: the image contains the keyboard, mouse, system-control, consumer and Raw HID
  descriptors; Vial's settings table lists the mouse key settings (ids 9–17); the built-in keymap
  uses the current keycode numbering; the UF2 targets the RP2040 at `0x10000000`;
  `raw_hid_receive_kb` is the overlay report's (the weak default is replaced).
- `overlay_report.c` was also compiled for the host against stand-ins for QMK's functions and
  its replies checked byte for byte (states locked and unlocked, info, keymap reads, checksum,
  unknown requests, foreign commands).
- It has **not** been run on a physical TOTEM. If anything is off, flash another firmware back
  the same way — an RP2040 can always be put into its bootloader with the B button.

## Rebuild it yourself

With a normal QMK setup ([docs](https://docs.qmk.fm/newbs_getting_started)):

```bash
git clone --recurse-submodules https://github.com/vial-kb/vial-qmk.git
cd vial-qmk
git checkout dd43959ae5c08d8a28d38a1acf7b04e86b14a344
git apply /path/to/vial-qmk-totem-keybard.patch
# optional: copy the TOTEM repo's vial.json into keyboards/geigeigeist/totem/keymaps/vial/
make geigeigeist/totem:vial:uf2-split-left    # flash the left half when asked
make geigeigeist/totem:vial:uf2-split-right   # then the right half
```

Toolchain used here: xPack GNU Arm Embedded GCC 13.3.1 (`arm-none-eabi-gcc` 13.3.1 20240614).

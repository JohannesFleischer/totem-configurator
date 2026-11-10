# TOTEM Vial firmware for totem-keybard

| File | For | SHA-256 |
|---|---|---|
| `totem_vial_keybard_left.uf2` | left half | `74706110d49589382f7794d57e2935c7ad27a3d9bb222fc5e2729b04bc00ae72` |
| `totem_vial_keybard_right.uf2` | right half | `ca1e410851e33f88d222b7efdac9782f866445af69e6be5010caccaae721f289` |

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
    - `WS2812_DRIVER_REQUIRED = yes`, `WS2812_DRIVER = vendor`, `SRC += layer_lights.c` — layer lights
  - `config.h`: the LED on `GP12` (one LED, driven by PIO1: the link between the halves uses
    PIO0), 69 bytes of EEPROM for the lights (`EECONFIG_USER_DATA_SIZE`), and a split
    transaction (`TOTEM_LIGHTS_SYNC`) that sends the colour to the other half
  - `overlay_report.c` (new) — the overlay report, below.
  - `layer_lights.c`, `layer_lights.h` (new) — the layer lights, below.
- `keymaps/vial/vial.json` replaced by the one from
  [GEIGEIGEIST/TOTEM](https://github.com/GEIGEIGEIST/TOTEM) (commit `410e566`,
  `firmware/QMK/VIAL_source/totem/keymaps/vial/vial.json`): same keys and matrix, but the Vial
  app draws the halves the right way round.
- Everything else as in vial-qmk: Vial protocol 6, 16 layers, Vial keyboard UID
  `CB 37 36 FE EE ED EE 77`, unlock keys = the two top outer keys, split over serial with
  handedness stored on each half (EE_HANDS).
- Each file is built with `INIT_EE_HANDS_LEFT` or `INIT_EE_HANDS_RIGHT`, so it also tells its half
  which side it is (that's why there are two files).

## Layer lights

Each half's XIAO RP2040 has an RGB LED (WS2812, data on GPIO12, power switched by GPIO11;
neither pin is used by the TOTEM). `layer_lights.c` lights it in the colour of the highest layer
that's on: per layer (16) a colour and an effect (steady, breathing in that colour, or a rainbow
round the colour wheel), plus a brightness, an effect speed (one round takes 8 s down to 1 s; the
rainbow three times as long) and an idle timeout, kept in EEPROM. With a timeout set, the LEDs go
dark after that many seconds without a key press and light again on the next one. Effects are
updated every 30 ms. The half on USB works out
the colour and sends it to the other half when it changes and every half second (in case that
half restarted). A colour set from the editor shows for 2.5 s whatever the layer, so you see what
you picked. Nothing is written to EEPROM until the editor saves (a moment after the last change).
The LEDs go dark while the computer sleeps. Until something is saved, the firmware uses its
defaults: base layer dark, then white, blue, green, magenta, … at brightness 48 of 255.

## The overlay report

`overlay_report.c` implements `raw_hid_receive_kb()`, which VIA calls for command ids it doesn't
know. It answers one new, read-only command on the same Raw HID interface VIA and Vial use:

```
request  [0] 0xF0  [1..4] "TKOV"  [5] what  [6] client tag  [7] 0  [8..] arguments
reply    the same 32 bytes, [7] = 3 (report version; 1 before the layer lights), the answer from [8]
```

| what | answer |
|---|---|
| `0x01` state | layer state (u32 LE), default layer state (u32), held modifiers, flags (Caps Lock, Caps Word, unlocked, held keys included), held keys per matrix row — **only while the keyboard is unlocked** |
| `0x02` info | layer and macro counts, rows, cols, tap dance / combo / key override / alt repeat counts and feature bits (as Vial reports them), keyboard UID, Vial protocol |
| `0x03` keymap | up to 20 bytes of the dynamic keymap from an offset (like VIA's `dynamic_keymap_get_buffer`) |
| `0x04` keymap checksum | Fletcher-16 over the whole keymap, so the overlay notices edits made by any program |
| `0x05` lights | from the layer in `[8]`: layer count, brightness, that layer, and the colours (R, G, B) of up to 7 layers |
| `0x06` set light | `[8]` layer and `[9..11]` R, G, B — or `[8] = 0xFF` and `[9]` the brightness; `[12] = 1` if done. Not saved yet |
| `0x07` save lights | keep the lights in EEPROM; `[8] = 1` |
| `0x08` light options | idle timeout in seconds (u16 LE, 0 = never), effect speed, then each layer's effect (0 steady, 1 breathe, 2 rainbow) |
| `0x09` set option | `[8] = 0`: timeout in `[9..10]`; `1`: speed in `[9]`; `2`: layer `[9]`, effect `[10]`; `[12] = 1` if done. Not saved yet |

The tag lets two programs share the keyboard (the keyboard sends each reply to every program
that has it open): the overlay takes only replies with its own tag, the editor skips tagged
ones. A reply with `[7] == 0` wasn't handled (Vial ignores other commands while an unlock is in
progress); an older firmware answers `[0] == 0xFF`. Nothing in the report changes the keymap
(the light commands only change the light colours),
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
- `layer_lights.c` likewise: defaults until saved, the idle timeout, breathing and rainbow, the colour of the highest layer at
  the brightness, sending to the other half (at once on a change, again every 500 ms, retried
  when it fails), the 2.5 s preview, saving and reading back from EEPROM, dark while asleep, the
  other half showing what it receives. The editor's protocol code was run against this same C
  code too.
- In the image: the LED driver uses PIO1 and the split serial link PIO0; the light hooks
  (`keyboard_post_init_user`, `housekeeping_task_user`, `suspend_*_user`) replace QMK's empty
  defaults.
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

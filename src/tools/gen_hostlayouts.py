#!/usr/bin/env python3
"""Generate web/hostlayouts-data.ts: what each key types on the computer's keyboard layout.

Source: QMK's per-layout keycode data (data/constants/keycodes/extras/keycodes_*_0.0.1.hjson,
the same data behind QMK's keymap_extras headers) and its basic keycode table. Read as data
with a small HJSON-subset parser; no code from QMK is executed.

    python3 -I tools/gen_hostlayouts.py <qmk>/data/constants/keycodes <qmk>/docs/reference_keymap_extras.md > web/hostlayouts-data.ts
"""
import json
import re
import sys
from pathlib import Path

KEYCODES_DIR = Path(sys.argv[1])
DOCS = Path(sys.argv[2])


# ---------------------------------------------------------------- HJSON subset parser
def parse_hjson(text):
    """Objects, quoted strings, numbers/bare words; comments (// # /* */); optional commas."""
    i = 0
    n = len(text)

    def ws():
        nonlocal i
        while i < n:
            c = text[i]
            if c in " \t\r\n,":
                i += 1
            elif text.startswith("//", i) or c == "#":
                while i < n and text[i] != "\n":
                    i += 1
            elif text.startswith("/*", i):
                i = text.index("*/", i) + 2
            else:
                break

    def string():
        nonlocal i
        assert text[i] == '"', text[i : i + 30]
        j = i + 1
        out = []
        while text[j] != '"':
            if text[j] == "\\":
                out.append(json.loads('"' + text[j : j + (6 if text[j + 1] == "u" else 2)] + '"'))
                j += 6 if text[j + 1] == "u" else 2
            else:
                out.append(text[j])
                j += 1
        i = j + 1
        return "".join(out)

    def value():
        nonlocal i
        ws()
        c = text[i]
        if c == "{":
            i += 1
            obj = {}
            while True:
                ws()
                if text[i] == "}":
                    i += 1
                    return obj
                k = string()
                ws()
                assert text[i] == ":", text[i : i + 30]
                i += 1
                obj[k] = value()
        if c == "[":
            i += 1
            arr = []
            while True:
                ws()
                if text[i] == "]":
                    i += 1
                    return arr
                arr.append(value())
        if c == '"':
            return string()
        m = re.compile(r"[^\s,\]}]+").match(text, i)
        i = m.end()
        w = m.group(0)
        return {"true": True, "false": False, "null": None}.get(w, w)

    return value()


# ---------------------------------------------------------------- basic keycodes
basic = parse_hjson((KEYCODES_DIR / "keycodes_0.0.1_basic.hjson").read_text())["keycodes"]
NAME_TO_CODE = {}
for hexcode, d in basic.items():
    code = int(hexcode, 16)
    for name in [d["key"], *d.get("aliases", [])]:
        NAME_TO_CODE[name] = code

# US shifted names (KC_LT, KC_EXLM, ...) some layouts build on
_us = parse_hjson((KEYCODES_DIR / "extras" / "keycodes_us_0.0.1.hjson").read_text())["aliases"]

MODS = {"S": 0x0200, "LSFT": 0x0200, "ALGR": 0x1400, "RALT": 0x1400, "A": 0x0400, "LALT": 0x0400, "RCTL": 0x1100, "C": 0x0100, "LCTL": 0x0100}

# ---------------------------------------------------------------- display names
header_names = {}
for line in DOCS.read_text().splitlines():
    m = re.match(r"\|([^|]+)\|`keymap_(\w+)\.h`", line)
    if m:
        name, header = m.group(1).strip(), m.group(2)
        header_names[header] = header_names[header] + " / " + name if header in header_names else name
header_names["belgian"] = "Belgian (Dutch / French)"
header_names["us"] = "English (US)"
header_names["nordic"] = "Nordic"
SKIP = {"plover", "plover_dvorak", "nordic"}  # stenography; shared base of the Nordic layouts


def resolve(expr, local):
    """'S(ALGR(DE_Q))' -> 16-bit keycode."""
    m = re.fullmatch(r"(\w+)\((.+)\)", expr)
    if m:
        return MODS[m.group(1)] | resolve(m.group(2), local)
    if expr in NAME_TO_CODE:
        return NAME_TO_CODE[expr]
    return local[expr]


for _expr, _d in _us.items():
    for _name in [_d["key"], *_d.get("aliases", [])]:
        NAME_TO_CODE.setdefault(_name, resolve(_expr, {}))

# Base characters on a US keyboard (QMK's basic table labels), for the US layout itself.
US_BASE = {}
for hexcode, d in basic.items():
    code = int(hexcode, 16)
    if d.get("group") == "basic" and (0x04 <= code <= 0x38) and code not in (0x28, 0x29, 0x2A, 0x2B, 0x2C, 0x32):
        US_BASE[code] = d["label"]

layouts = []
unresolved = 0
for path in sorted((KEYCODES_DIR / "extras").glob("keycodes_*_0.0.1.hjson")):
    lid = path.name[len("keycodes_") : -len("_0.0.1.hjson")]
    if lid in SKIP:
        continue
    aliases = parse_hjson(path.read_text())["aliases"]
    local = {}  # layout alias (DE_Q) -> code, built as we go (entries only refer backwards)
    entries = {}
    for expr, d in aliases.items():
        try:
            code = resolve(expr, local)
        except KeyError as e:
            print(f"// {lid}: cannot resolve {expr} ({e})", file=sys.stderr)
            unresolved += 1
            continue
        local[d["key"]] = code
        for a in d.get("aliases", []) if isinstance(d.get("aliases"), list) else []:
            local[a] = code
        label = d.get("label")
        if label is None or code in entries:
            continue
        entries[code] = label
    if lid == "us":
        entries = {**US_BASE, **entries}
    name = header_names.get(lid, lid.replace("_", " ").title())
    mac = "mac" in lid or "macOS" in name
    layouts.append({"id": lid, "name": name, "mac": mac, "iso": 0x64 in entries, "keys": entries})

# US first, then by name
layouts.sort(key=lambda l: (l["id"] != "us", l["name"].lower()))

print("// GENERATED by tools/gen_hostlayouts.py from QMK's keycode extras data")
print("// (data/constants/keycodes/extras/keycodes_*_0.0.1.hjson, GPL-2.0-or-later). Do not edit.")
print("// Each layout maps 16-bit keycodes (KC_x, LSFT(KC_x), RALT(KC_x), ...) to the character")
print("// that keycode types when the computer uses that layout. Entries are 'hexcode\\tlabel', '\\n'-joined.")
print("export interface HostLayoutData { id: string; name: string; mac: boolean; iso: boolean; keys: string }")
print("export const HOST_LAYOUTS: HostLayoutData[] = [")
for l in layouts:
    keys = "\n".join(f"{code:x}\t{label}" for code, label in sorted(l["keys"].items()))
    print(f"    {{ id: {json.dumps(l['id'])}, name: {json.dumps(l['name'], ensure_ascii=False)}, mac: {json.dumps(l['mac'])}, iso: {json.dumps(l['iso'])}, keys: {json.dumps(keys, ensure_ascii=False)} }},")
print("];")
print(f"// {len(layouts)} layouts, {unresolved} unresolved entries", file=sys.stderr)

"""End-to-end test of ../untested-os/totem-keybard.html (built by build.ts) against the simulated TOTEM (test/mock-totem.js).

    python3 test/e2e.py [screenshot-dir]

Uses Playwright for Python with Chromium.
"""
import json
import os
import re
import sys
import tempfile

from playwright.sync_api import sync_playwright, expect

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file://" + os.path.normpath(os.path.join(ROOT, "..", "untested-os", "totem-keybard.html"))
SHOTS = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp()
os.makedirs(SHOTS, exist_ok=True)
COLS = 5
passed = []


def ok(name):
    passed.append(name)
    print("  ok -", name)


def shot(pg, name):
    pg.screenshot(path=os.path.join(SHOTS, name))


def mock(pg, expr):
    return pg.evaluate(f"() => {{ const m = window.__mock; return {expr}; }}")


def key(pg, r, c):
    return pg.locator(f'.stage .board .key[data-row="{r}"][data-col="{c}"]').first


def pick(pg, code):
    """Click a picker key in the side panel by keycode number."""
    pg.locator(f'.panel .pk[data-code="{code}"]').first.click()
    pg.wait_for_timeout(60)


def slot(pg, label):
    """The slot button in the editor row whose label is exactly `label`."""
    return pg.locator(".panel .slot-row").filter(has=pg.locator("label", has_text=re.compile(f"^{re.escape(label)}$"))).locator(".slot")


def nav(pg, label):
    pg.locator(".nav-item", has_text=label).click()
    pg.wait_for_timeout(80)


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    pg = ctx.new_page()
    errors = []
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
    pg.add_init_script(path=ROOT + "/test/mock-totem.js")
    pg.goto(URL)

    # --- connect and read
    pg.get_by_role("button", name="Connect TOTEM").click()
    pg.wait_for_selector(".stage .board .key")
    expect(pg.locator(".stage .board .key")).to_have_count(38)
    expect(pg.locator(".status")).to_contain_text("live")
    assert pg.locator(".layer-tab").count() == 5
    # keymap read back correctly: matrix (0,0) is KC_A, (1,0) LGUI_T(KC_A), (3,2) MO(1), (7,2) LT1(KC_SPACE)
    assert key(pg, 0, 0).inner_text().strip() == "A"
    assert "LGUI_T" in key(pg, 1, 0).inner_text()
    assert "MO" in key(pg, 3, 2).inner_text() and "1" in key(pg, 3, 2).inner_text()
    assert "LT1" in key(pg, 7, 2).inner_text() and "SPACE" in key(pg, 7, 2).inner_text()
    ok("connects, reads 5 layers and shows the keymap")
    nav_counts = pg.locator(".nav").inner_text()
    assert "Tap Dances" in nav_counts
    shot(pg, "e2e-01-connected.png")

    # --- assign a basic key from the picker
    key(pg, 0, 1).click()
    expect(key(pg, 0, 1)).to_have_class("key sel")
    pick(pg, 0x05)  # KC_B
    assert mock(pg, "m.keymap[0][1]") == 0x05
    ok("picker assigns KC_B and writes it to the keyboard")

    # --- mod-tap: Ctrl + A
    pg.locator(".wrapbox .chip", has_text="Mod-Tap").click()
    pg.locator(".wrapbox .chip", has_text="Ctrl").click()
    expect(pg.locator(".wrapbox")).to_contain_text("LCTL_T(KC_A)")
    key(pg, 1, 1).click()
    pick(pg, 0x04)
    assert mock(pg, f"m.keymap[0][{1*COLS+1}]") == 0x2104, hex(mock(pg, f"m.keymap[0][{1*COLS+1}]"))
    # right-hand mods: RSFT_T(KC_J)
    pg.locator(".wrapbox .chip", has_text="Ctrl").click()
    pg.locator(".wrapbox .chip", has_text="Shift").click()
    pg.locator(".wrapbox .seg button", has_text="Right").click()
    key(pg, 5, 1).click()
    pick(pg, 0x0D)
    assert mock(pg, f"m.keymap[0][{5*COLS+1}]") == 0x320D
    assert "RSFT_T" in key(pg, 5, 1).inner_text()
    ok("mod-tap wrapping (LCTL_T, RSFT_T)")

    # --- layer-tap
    pg.locator(".wrapbox .chip", has_text="Layer-Tap").click()
    pg.locator(".wrapbox .chip", has_text="2").first.click()
    key(pg, 3, 4).click()
    pick(pg, 0x2C)  # space
    assert mock(pg, f"m.keymap[0][{3*COLS+4}]") == 0x422C
    pg.locator(".wrapbox .chip", has_text="Plain").click()
    ok("layer-tap wrapping (LT2(KC_SPACE))")

    # --- typing assigns keys, with shift -> LSFT(kc)
    key(pg, 0, 2).click()
    pg.keyboard.press("x")
    pg.wait_for_timeout(80)
    assert mock(pg, "m.keymap[0][2]") == 0x1B
    key(pg, 0, 3).click()
    pg.keyboard.press("Shift+1")
    pg.wait_for_timeout(80)
    assert mock(pg, "m.keymap[0][3]") == 0x21E, hex(mock(pg, "m.keymap[0][3]"))
    assert key(pg, 0, 3).inner_text().strip() == "!"
    key(pg, 0, 4).click()
    pg.keyboard.down("Control")
    pg.keyboard.up("Control")
    pg.wait_for_timeout(80)
    assert mock(pg, "m.keymap[0][4]") == 0xE0
    ok("typing assigns keys (x, Shift+1 -> !, lone Ctrl)")

    # --- layers panel
    nav(pg, "Layer Keys")
    key(pg, 4, 4).click()
    pg.locator('.panel .pk[data-code="%d"]' % 0x5223).click()  # MO(3)
    pg.wait_for_timeout(60)
    assert mock(pg, f"m.keymap[0][{4*COLS+4}]") == 0x5223
    shot(pg, "e2e-02-layer-keys.png")
    ok("layer keys panel assigns MO(3)")

    # --- switch layer, edit on layer 2
    pg.locator(".layer-tab", has_text="2").click()
    expect(pg.locator(".layer-title")).to_contain_text("Layer 2")
    assert "BOOT" in key(pg, 0, 0).inner_text().upper()
    key(pg, 2, 2).click()
    nav(pg, "Standard Keys")
    pick(pg, 0x52)  # KC_UP
    assert mock(pg, f"m.keymap[2][{2*COLS+2}]") == 0x52
    ok("edits land on the selected layer")

    # --- special keys + custom expression
    nav(pg, "Special Keys")
    key(pg, 2, 3).click()
    pg.locator('.panel .pk[data-code="%d"]' % 0xA8).first.click()  # KC_MUTE (168)
    pg.wait_for_timeout(60)
    assert mock(pg, f"m.keymap[2][{2*COLS+3}]") == 0xA8
    inp = pg.locator('.panel input[placeholder^="e.g. LT"]')
    inp.fill("LCTL(LSFT(KC_ESC))")
    inp.press("Enter")
    pg.wait_for_timeout(80)
    assert mock(pg, f"m.keymap[2][{2*COLS+3}]") == 0x0329, hex(mock(pg, f"m.keymap[2][{2*COLS+3}]"))
    ok("special keys and the 'any keycode' field (LCTL(LSFT(KC_ESC)))")

    # --- QK_BOOT needs an unlock (mock auto-holds the keys)
    key(pg, 1, 4).click()
    pg.locator('.panel .pk[data-code="%d"]' % 0x7C00).first.click()
    pg.wait_for_selector("text=Unlock your TOTEM")
    shot(pg, "e2e-03-unlock.png")
    pg.wait_for_selector("text=Unlock your TOTEM", state="detached", timeout=10000)
    pg.wait_for_timeout(150)
    assert mock(pg, "m.unlocked") is True
    assert mock(pg, f"m.keymap[2][{1*COLS+4}]") == 0x7C00
    ok("QK_BOOT triggers the Vial unlock, then is written")

    # lock again through Settings
    nav(pg, "Settings")
    pg.locator(".panel button", has_text="Lock").click()
    pg.wait_for_timeout(100)
    assert mock(pg, "m.unlocked") is False
    ok("settings panel locks the keyboard")

    # --- QMK settings: tapping term
    tt = pg.locator(".panel .kv", has_text="Tapping Term").locator('input[type="number"]').first
    assert tt.input_value() == "200"
    tt.fill("175")
    tt.press("Tab")
    pg.wait_for_timeout(100)
    assert mock(pg, "m.settings[7]") == 175
    cb = pg.locator(".panel .kv", has_text="Time out period for combos")
    shot(pg, "e2e-04-settings.png")
    ok("QMK settings read (200) and written (175)")

    # --- tap dance editor
    pg.locator(".layer-tab", has_text="0").click()
    nav(pg, "Tap Dances")
    assert pg.locator(".panel .item").count() == 8
    pg.locator(".panel .item").nth(1).locator(".icon-btn").click()
    expect(pg.locator(".panel-head h2")).to_have_text("Tap Dance 1")
    pick(pg, 0x29)  # Esc on tap (slot "Tap" is selected by default)
    slot(pg, "Hold").click()
    pick(pg, 0xE1)  # LShift on hold
    term = pg.locator('.panel input[type="number"]')
    term.fill("250")
    term.press("Tab")
    pg.wait_for_timeout(100)
    assert mock(pg, "m.td[1]") == [0x29, 0xE1, 0, 0, 250], mock(pg, "m.td[1]")
    shot(pg, "e2e-05-tapdance.png")
    # assign TD(1) to a key
    pg.locator(".panel-head .icon-btn").first.click()  # back
    key(pg, 2, 0).click()
    pg.locator('.panel .pk[data-code="%d"]' % (0x5700 + 1)).click()
    pg.wait_for_timeout(60)
    assert mock(pg, f"m.keymap[0][{2*COLS}]") == 0x5701
    ok("tap dance editor writes entry 1 and TD(1) can be assigned")

    # --- combo editor: click TOTEM keys to fill inputs
    nav(pg, "Combos")
    pg.locator(".panel .item").nth(1).click()
    expect(pg.locator(".panel-head h2")).to_have_text("Combo 1")
    expect(pg.locator(".stage .board")).to_have_class("board transmit")
    key(pg, 0, 0).click()  # KC_A -> key 1, advances
    key(pg, 0, 1).click()  # KC_B -> key 2
    slot(pg, "Output").click()
    pick(pg, 0x2A)  # backspace
    assert mock(pg, "m.combos[1]") == [0x04, 0x05, 0, 0, 0x2A], mock(pg, "m.combos[1]")
    shot(pg, "e2e-06-combo.png")
    ok("combo editor: inputs copied from the TOTEM, output from the picker")

    # --- key override editor
    nav(pg, "Overrides")
    assert "LSft" in pg.locator(".panel .item").first.inner_text()
    pg.locator(".panel .item").nth(1).click()
    pick(pg, 0x2A)  # trigger backspace
    slot(pg, "Replacement").click()
    pick(pg, 0x4C)  # delete
    pg.locator(".panel .mods8").first.locator(".chip", has_text="LSft").click()
    pg.wait_for_timeout(100)
    ko = mock(pg, "m.ko[1]")
    assert ko["trigger"] == 0x2A and ko["replacement"] == 0x4C and ko["tm"] == 0x02 and ko["opt"] & 0x80 and ko["layers"] == 0x1F, ko
    shot(pg, "e2e-07-override.png")
    ok("key override editor (Shift+Bksp -> Del, enabled, layers 0-4)")

    # --- macros: existing macro decoded, edit and save (needs unlock again)
    nav(pg, "Macros")
    assert "hello" in pg.locator(".panel .item").first.inner_text()
    pg.locator(".panel .item").nth(1).locator(".icon-btn").click()
    pg.locator(".panel .chip", has_text="+ Text").click()
    t = pg.locator('.panel .action input[type="text"]')
    t.fill("abc")
    t.press("Tab")
    pg.locator(".panel .chip", has_text="+ Tap keys").click()
    pick(pg, 0x28)  # Enter into the new tap action
    pg.locator(".panel .chip", has_text="+ Delay").click()
    shot(pg, "e2e-08-macro.png")
    pg.locator(".panel .pill", has_text="Save to keyboard").click()
    pg.wait_for_selector("text=Unlock your TOTEM")
    pg.wait_for_selector("text=Unlock your TOTEM", state="detached", timeout=10000)
    pg.wait_for_timeout(300)
    buf = mock(pg, "Array.from(m.macroBuf.slice(0, 32))")
    expected0 = [104, 101, 108, 108, 111, 1, 1, 0x28, 0]  # "hello" + tap(Enter), NUL
    expected1 = [97, 98, 99, 1, 1, 0x28, 1, 4, 101, 1, 0]  # "abc" tap(Enter) delay(100ms), NUL
    assert buf[: len(expected0) + len(expected1)] == expected0 + expected1, buf
    assert pg.locator("text=Macro changes are not on the keyboard yet").count() == 0
    ok("macro editor encodes text/tap/delay and writes after unlock")

    # --- key tester
    nav(pg, "Key Tester")
    pg.locator(".panel .pill", has_text="Start key tester").click()
    pg.wait_for_timeout(200)
    pg.evaluate("() => { window.__mock.pressed.add('0,0'); window.__mock.pressed.add('7,4'); }")
    pg.wait_for_timeout(300)
    assert "pressed" in key(pg, 0, 0).get_attribute("class") and "pressed" in key(pg, 7, 4).get_attribute("class")
    shot(pg, "e2e-09-tester.png")
    pg.evaluate("() => window.__mock.pressed.clear()")
    pg.wait_for_timeout(200)
    assert "pressed" not in key(pg, 0, 0).get_attribute("class") and "seen" in key(pg, 0, 0).get_attribute("class")
    expect(pg.locator(".panel")).to_contain_text("2 of 38 keys seen")
    nav(pg, "Standard Keys")
    ok("key tester shows held and seen keys")

    # --- save .vil
    with pg.expect_download() as dl:
        pg.locator('.topbar button[title^="Save the layout"]').click()
    path = dl.value.path()
    vil = json.load(open(path))
    expect(pg.locator('.toast[data-id="saved"]')).to_contain_text("to your browser's downloads folder")
    assert vil["version"] == 1 and vil["uid"] == 0x77EEEDEEFE3637CB, vil["uid"]
    assert len(vil["layout"]) == 5 and len(vil["layout"][0]) == 8 and len(vil["layout"][0][0]) == 5
    assert vil["layout"][0][1][1] == "LCTL_T(KC_A)", vil["layout"][0][1][1]
    assert vil["layout"][0][3][4] == "LT2(KC_SPACE)", vil["layout"][0][3][4]
    assert vil["layout"][0][3][1] == -1  # no switch at matrix 3,1
    assert vil["layout"][0][0][3] == "LSFT(KC_1)"
    assert vil["layout"][0][2][0] == "TD(1)"
    assert vil["tap_dance"][1] == ["KC_ESCAPE", "KC_LSHIFT", "KC_NO", "KC_NO", 250]
    assert vil["combo"][1] == ["KC_A", "KC_B", "KC_NO", "KC_NO", "KC_BSPACE"]
    assert vil["key_override"][1]["trigger"] == "KC_BSPACE" and vil["key_override"][1]["trigger_mods"] == 2
    assert vil["macro"][1] == [["text", "abc"], ["tap", "KC_ENTER"], ["delay", 100]], vil["macro"][1]
    assert vil["settings"]["7"] == 175
    vil_path = os.path.join(SHOTS, "saved.vil")
    open(vil_path, "w").write(open(path).read())
    ok("saves a Vial-compatible .vil (names, uid, -1 for missing keys)")

    # --- disconnect, reopen the file offline
    pg.locator(".topbar .pill", has_text="Disconnect").click()
    expect(pg.locator(".status")).to_contain_text("offline")
    pg.locator('.topbar button[title^="Close this layout"]').click()
    expect(pg.get_by_role("button", name="Connect TOTEM")).to_be_visible()
    with pg.expect_file_chooser() as fc:
        pg.get_by_role("button", name="Open a .vil layout").click()
    fc.value.set_files(vil_path)
    pg.wait_for_selector(".stage .board .key")
    assert "LCTL_T" in key(pg, 1, 1).inner_text()
    assert "LT2" in key(pg, 3, 4).inner_text()
    nav(pg, "Macros")
    assert "abc" in pg.locator(".panel .item").nth(1).inner_text()
    ok("opens the saved .vil offline")

    # closing with unsaved offline edits asks first
    key(pg, 0, 0).click()
    nav(pg, "Standard Keys")
    pick(pg, 0x14)  # Q
    pg.locator('.topbar button[title^="Close this layout"]').click()
    expect(pg.locator(".modal")).to_contain_text("Close without saving?")
    pg.locator(".modal .pill", has_text="Close anyway").click()
    ok("asks before discarding unsaved offline edits")
    pg.evaluate("() => { const m = window.__mock; m.keymap[0][0] = 4; m.keymap[0][1] = 4; m.combos[1] = [0,0,0,0,0]; }")
    pg.get_by_role("button", name="Connect TOTEM").click()
    pg.wait_for_selector(".stage .board .key")
    assert key(pg, 0, 1).inner_text().strip() == "A"
    log_before = mock(pg, "m.log.length")
    with pg.expect_file_chooser() as fc:
        pg.locator('.topbar button[title^="Open a .vil layout and write"]').click()
    fc.value.set_files(vil_path)
    pg.locator(".modal .pill", has_text="Write to keyboard").click()
    pg.wait_for_timeout(1500)
    assert mock(pg, "m.keymap[0][1]") == 0x05
    assert mock(pg, "m.combos[1]") == [4, 5, 0, 0, 0x2A]
    writes = mock(pg, f"m.log.slice({log_before}).filter(r => r[0] === 5).length")
    assert writes <= 3, f"expected only changed keys to be written, got {writes}"
    ok(f"writes a .vil to the keyboard, sending only differences ({writes} key writes)")

    # --- offline edits are offered to the keyboard when connecting
    pg.locator(".topbar .pill", has_text="Disconnect").click()
    key(pg, 0, 2).click()
    pick(pg, 0x1C)  # Y, offline
    assert mock(pg, "m.keymap[0][2]") != 0x1C
    pg.locator(".topbar .pill", has_text="Connect").click()
    expect(pg.locator(".modal")).to_contain_text("Write your edited layout to the keyboard?")
    pg.locator(".modal .pill", has_text="Write to keyboard").click()
    pg.wait_for_timeout(1500)
    assert mock(pg, "m.keymap[0][2]") == 0x1C
    assert key(pg, 0, 2).inner_text().strip() == "Y"
    ok("offline edits can be written when connecting")

    # --- unplug while connected
    pg.evaluate("() => window.__mock.unplug()")
    pg.wait_for_timeout(200)
    expect(pg.locator(".status")).to_contain_text("offline")
    ok("handles unplugging")

    # --- demo layout + small window
    pg.locator('.topbar button[title^="Close this layout"]').click()
    pg.get_by_role("button", name="Explore the demo layout").click()
    pg.wait_for_selector(".stage .board .key")
    assert "LGUI_T" in key(pg, 1, 0).inner_text()
    assert key(pg, 0, 0).inner_text().strip() == "Q" and key(pg, 4, 0).inner_text().strip() == "P"
    shot(pg, "e2e-10-demo.png")
    pg.set_viewport_size({"width": 1000, "height": 760})
    pg.wait_for_timeout(300)
    shot(pg, "e2e-11-narrow.png")
    ok("demo layout (Q at left pinky, P at right pinky)")

    # --- a board left mid-unlock by an earlier session is unlocked first, then read
    pg2 = ctx.new_page()
    pg2.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
    pg2.add_init_script("window.__mockConfig = { startUnlocking: true, layers: 16 }")
    pg2.add_init_script(path=ROOT + "/test/mock-totem.js")
    pg2.goto(URL)
    pg2.get_by_role("button", name="Connect TOTEM").click()
    pg2.wait_for_selector("text=Unlock your TOTEM")
    pg2.wait_for_selector(".stage .board .key", timeout=15000)
    assert pg2.locator(".layer-tab").count() == 16
    assert pg2.evaluate("() => window.__mock.blocked") > 0
    shot(pg2, "e2e-12-16-layers.png")
    ok("finishes an unlock left in progress, then reads all 16 layers")

    # ===================================================================== names
    pg3 = ctx.new_page()
    pg3.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
    pg3.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg3.add_init_script(path=ROOT + "/test/mock-totem.js")
    pg3.goto(URL)
    pg = pg3
    pg.get_by_role("button", name="Connect TOTEM").click()
    pg.wait_for_selector(".stage .board .key")
    pg.locator(".layer-name").click()
    expect(pg.locator(".layer-name-input")).to_be_focused()
    pg.keyboard.type("Base")
    pg.keyboard.press("Enter")
    pg.wait_for_timeout(100)
    expect(pg.locator(".layer-tab").first).to_have_text("Base")
    expect(pg.locator(".layer-title")).to_contain_text("Base")
    pg.locator(".layer-tab").nth(1).dblclick()
    pg.locator(".layer-name-input").fill("Nav")
    pg.locator(".layer-name-input").press("Enter")
    pg.locator(".layer-tab").first.click()
    pg.wait_for_timeout(100)
    assert key(pg, 3, 2).inner_text().split("\n") == ["MO 1", "Nav"], key(pg, 3, 2).inner_text()
    ok("layers are named from the title or by double-clicking a tab; MO keys show the name")

    for nav_label, kind, name in [("Tap Dances", "tapdance", "Esc/Ctrl"), ("Macros", "macros", "Hello"), ("Combos", "combos", "JK esc"), ("Overrides", "overrides", "Shift del")]:
        nav(pg, nav_label)
        pg.locator(".panel .item").first.click()
        f = pg.locator(".panel .name-row input")
        f.fill(name)
        f.press("Enter")
        pg.wait_for_timeout(100)
        expect(pg.locator(".panel-head h2")).to_have_text(name)
        pg.locator(".panel-head .icon-btn").first.click()  # back to the list
        expect(pg.locator(".panel .item").first).to_contain_text(name)
    nav(pg, "Tap Dances")
    key(pg, 0, 0).click()
    pg.locator('.panel .pk[data-code="%d"]' % 0x5700).click()
    pg.wait_for_timeout(100)
    assert key(pg, 0, 0).inner_text().split("\n") == ["TD 0", "Esc/Ctrl"], key(pg, 0, 0).inner_text()
    # names keep their spelling on keycaps: no CSS capitals, so ß stays ß (not "SS")
    pg.locator(".panel .item").nth(1).click()  # Tap Dances panel is still open
    f = pg.locator(".panel .name-row input")
    f.fill("Grüße")
    f.press("Enter")
    pg.wait_for_timeout(100)
    expect(pg.locator(".panel-head h2")).to_have_text("Grüße")
    pg.locator(".panel-head .icon-btn").first.click()
    assert pg.locator('.panel .pk[data-code="%d"]' % 0x5701).inner_text().split("\n") == ["TD 1", "Grüße"], pg.locator('.panel .pk[data-code="%d"]' % 0x5701).inner_text()
    key(pg, 0, 1).click()
    pg.locator('.panel .pk[data-code="%d"]' % 0x5701).click()
    pg.wait_for_timeout(100)
    assert key(pg, 0, 1).inner_text().split("\n") == ["TD 1", "Grüße"], key(pg, 0, 1).inner_text()
    pg.locator(".layer-name").click()
    pg.keyboard.press("Control+a")
    pg.keyboard.type("Straße")
    pg.keyboard.press("Enter")
    pg.wait_for_timeout(100)
    expect(pg.locator(".layer-tab").first).to_have_text("Straße")
    pg.locator(".layer-tab").nth(1).click()
    key(pg, 3, 3).click()
    nav(pg, "Layer Keys")
    pg.locator('.panel .pk[data-code="%d"]' % 0x5220).click()  # MO(0)
    pg.wait_for_timeout(100)
    assert key(pg, 3, 3).inner_text().split("\n") == ["MO 0", "Straße"], key(pg, 3, 3).inner_text()
    shot(pg, "e2e-18-sz-names.png")
    pg.keyboard.press("Control+z")  # undo MO(0), the layer rename and the TD changes so later checks are unaffected
    pg.keyboard.press("Control+z")
    pg.keyboard.press("Control+z")
    pg.keyboard.press("Control+z")
    pg.wait_for_timeout(300)
    pg.locator(".layer-tab").first.click()
    expect(pg.locator(".layer-tab").first).to_have_text("Base")
    nav(pg, "Tap Dances")
    ok("tap dances, macros, combos and overrides are named in their editors; keys show names as typed (ß stays ß)")

    with pg.expect_download() as dl:
        pg.locator('.topbar button[title^="Save the layout"]').click()
    named_vil = json.load(open(dl.value.path()))
    assert named_vil["cosmetic"] == {
        "layer": {"0": "Base", "1": "Nav"}, "macros": {"0": "Hello"}, "tapdances": {"0": "Esc/Ctrl"},
        "combos": {"0": "JK esc"}, "overrides": {"0": "Shift del"},
    }, named_vil["cosmetic"]
    named_path = os.path.join(SHOTS, "named.vil")
    open(named_path, "w").write(open(dl.value.path()).read())
    shot(pg, "e2e-13-names.png")
    ok("names are saved in the .vil (keybard's cosmetic block)")

    pg.reload()
    pg.get_by_role("button", name="Connect TOTEM").click()
    pg.wait_for_selector(".stage .board .key")
    expect(pg.locator(".layer-tab").first).to_have_text("Base")
    nav(pg, "Macros")
    expect(pg.locator(".panel .item").first).to_contain_text("Hello")
    ok("names are remembered for this TOTEM after a reload")

    # ===================================================================== undo / redo
    undo_btn = pg.locator('.topbar button[aria-label="Undo"]')
    redo_btn = pg.locator('.topbar button[aria-label="Redo"]')
    assert undo_btn.is_disabled() and redo_btn.is_disabled()
    nav(pg, "Standard Keys")
    key(pg, 0, 2).click()
    pick(pg, 0x1B)  # X over C
    assert mock(pg, "m.keymap[0][2]") == 0x1B
    assert "KC_C → KC_X" in undo_btn.get_attribute("title")
    undo_btn.click()
    pg.wait_for_timeout(150)
    assert mock(pg, "m.keymap[0][2]") == 0x06 and key(pg, 0, 2).inner_text().strip() == "C"
    expect(pg.locator(".toast", has_text="Undone")).to_be_visible()
    redo_btn.click()
    pg.wait_for_timeout(150)
    assert mock(pg, "m.keymap[0][2]") == 0x1B
    ok("undo/redo buttons revert and re-apply a key change on the keyboard")

    # keyboard shortcuts win over 'typing assigns keys', and undo jumps to the layer
    pg.locator(".layer-tab").nth(3).click()
    key(pg, 1, 1).click()
    pg.keyboard.press("q")
    pg.wait_for_timeout(100)
    assert mock(pg, f"m.keymap[3][{1*COLS+1}]") == 0x14
    pg.locator(".layer-tab").first.click()
    pg.keyboard.press("Control+z")
    pg.wait_for_timeout(150)
    assert mock(pg, f"m.keymap[3][{1*COLS+1}]") == 0
    expect(pg.locator(".layer-title")).to_contain_text("Layer 3")
    expect(key(pg, 1, 1)).to_have_class("key blank sel")
    pg.keyboard.press("Control+Shift+z")
    pg.wait_for_timeout(150)
    assert mock(pg, f"m.keymap[3][{1*COLS+1}]") == 0x14
    pg.keyboard.press("Control+z")
    pg.keyboard.press("Control+y")
    pg.wait_for_timeout(200)
    assert mock(pg, f"m.keymap[3][{1*COLS+1}]") == 0x14
    ok("Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y work, show the changed layer and don't assign Ctrl+Z")

    # several steps, and a new edit clears redo
    pg.locator(".layer-tab").first.click()
    key(pg, 0, 4).click()
    for code in (0x10, 0x11, 0x12):  # M, N, O on layer 0 (0,4)
        pick(pg, code)
    pg.keyboard.press("Escape")
    pg.keyboard.press("Control+z")
    pg.keyboard.press("Control+z")
    pg.wait_for_timeout(200)
    assert mock(pg, "m.keymap[0][4]") == 0x10
    expect(key(pg, 0, 4)).to_have_class("key sel")  # undo selects the key it changed
    pick(pg, 0x04)
    assert redo_btn.is_disabled()
    ok("multi-step undo; a new edit clears the redo list")

    # tap dance, combo, override, setting and names are undoable too
    nav(pg, "Tap Dances")
    pg.locator(".panel .item").first.click()
    term = pg.locator('.panel input[type="number"]')
    term.fill("333")
    term.press("Tab")
    pg.wait_for_timeout(100)
    assert mock(pg, "m.td[0][4]") == 333
    undo_btn.click()
    pg.wait_for_timeout(150)
    assert mock(pg, "m.td[0][4]") == 200
    expect(pg.locator('.panel input[type="number"]')).to_have_value("200")
    nav(pg, "Combos")
    pg.locator(".panel .item").nth(2).click()
    key(pg, 0, 0).click()
    pg.wait_for_timeout(100)
    assert mock(pg, "m.combos[2][0]") != 0
    undo_btn.click()
    pg.wait_for_timeout(150)
    assert mock(pg, "m.combos[2]") == [0, 0, 0, 0, 0]
    nav(pg, "Overrides")
    pg.locator(".panel .item").first.click()
    pg.locator(".panel .mods8").first.locator(".chip", has_text="LCtl").click()
    pg.wait_for_timeout(100)
    assert mock(pg, "m.ko[0]['tm']") == 0x23
    undo_btn.click()
    pg.wait_for_timeout(150)
    assert mock(pg, "m.ko[0]['tm']") == 0x22
    f = pg.locator(".panel .name-row input")
    f.fill("Renamed")
    f.press("Enter")
    pg.wait_for_timeout(100)
    undo_btn.click()
    pg.wait_for_timeout(150)
    expect(pg.locator(".panel-head h2")).to_have_text("Shift del")
    nav(pg, "Settings")
    tt = pg.locator(".panel .kv", has_text="Tapping Term").locator('input[type="number"]').first
    tt.fill("190")
    tt.press("Tab")
    pg.wait_for_timeout(100)
    assert mock(pg, "m.settings[7]") == 190
    undo_btn.click()
    pg.wait_for_timeout(150)
    assert mock(pg, "m.settings[7]") == 200
    ok("tap dance, combo, override, name and setting changes are undoable")

    # macros: undo a text edit; the 'not saved' bar follows what's on the keyboard
    nav(pg, "Macros")
    pg.locator(".panel .item").first.locator(".icon-btn").click()
    t = pg.locator('.panel .action input[type="text"]').first
    t.fill("hello world")
    t.press("Tab")
    pg.wait_for_timeout(100)
    expect(pg.locator(".panel")).to_contain_text("Macro changes are not on the keyboard yet")
    undo_btn.click()
    pg.wait_for_timeout(150)
    expect(pg.locator('.panel .action input[type="text"]').first).to_have_value("hello")
    assert pg.locator("text=Macro changes are not on the keyboard yet").count() == 0
    redo_btn.click()
    pg.wait_for_timeout(150)
    expect(pg.locator('.panel .action input[type="text"]').first).to_have_value("hello world")
    pg.locator(".panel .pill", has_text="Revert").click()
    pg.wait_for_timeout(150)
    expect(pg.locator('.panel .action input[type="text"]').first).to_have_value("hello")
    ok("macro edits undo/redo; Revert is undoable and clears the unsaved state")

    # QK_BOOT coming back through undo asks for the unlock first
    pg.evaluate("() => { window.__mock.unlocked = false; }")
    pg.locator(".layer-tab").nth(2).click()
    key(pg, 0, 0).click()
    nav(pg, "Standard Keys")
    pick(pg, 0x04)
    assert mock(pg, "m.keymap[2][0]") == 0x04
    undo_btn.click()
    pg.wait_for_selector("text=Unlock your TOTEM")
    pg.wait_for_selector("text=Unlock your TOTEM", state="detached", timeout=10000)
    pg.wait_for_timeout(150)
    assert mock(pg, "m.keymap[2][0]") == 0x7C00
    ok("undoing back to QK_BOOT unlocks the keyboard first")

    # writing a whole .vil is one undo step
    before = mock(pg, "m.keymap.map(l => l.slice())")
    with pg.expect_file_chooser() as fc:
        pg.locator('.topbar button[title^="Open a .vil layout and write"]').click()
    fc.value.set_files(vil_path)
    pg.locator(".modal .pill", has_text="Write to keyboard").click()
    pg.wait_for_timeout(1500)
    assert mock(pg, "m.keymap.map(l => l.slice())") != before
    assert "Write saved.vil" in undo_btn.get_attribute("title")
    undo_btn.click()
    pg.wait_for_timeout(1500)
    assert mock(pg, "m.keymap.map(l => l.slice())") == before
    expect(pg.locator(".layer-tab").first).to_have_text("Base")  # names came back too
    shot(pg, "e2e-14-undo.png")
    ok("writing a .vil file is a single undo step (keys and names restored)")

    # ===================================================================== several keys: multi-select, swap, lock key
    pg = browser.new_context(viewport={"width": 1440, "height": 900}).new_page()
    pg.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.add_init_script(path=ROOT + "/test/mock-totem.js")
    pg.goto(URL)
    pg.get_by_role("button", name="Connect TOTEM").click()
    pg.wait_for_selector(".stage .board .key")
    undo_btn = pg.get_by_role("button", name="Undo")
    redo_btn = pg.get_by_role("button", name="Redo")
    sel = pg.locator(".stage .board .key.sel")
    tool = lambda name: pg.locator(".edit-tools .tool", has_text=name)
    banner = pg.locator(".edit-tools.mode")
    L0 = lambda: mock(pg, "m.keymap[0].slice()")
    orig = L0()  # layer 0: position i holds 4 + i % 26 (KC_A + i), plus a few mod-taps / layer keys

    def center(loc):
        for _ in range(20):  # the board may be redrawn at that very moment
            b = loc.bounding_box()
            if b:
                return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
            pg.wait_for_timeout(50)
        raise AssertionError("no bounding box")

    def drag(src, dst, hover=None, steps=12):
        x0, y0 = center(src)
        pg.mouse.move(x0, y0)
        pg.mouse.down()
        if hover is not None:  # pause over something on the way (a layer tab)
            hx, hy = center(hover)
            pg.mouse.move(hx, hy, steps=steps)
            pg.wait_for_timeout(700)
        x1, y1 = center(dst) if not isinstance(dst, tuple) else dst
        pg.mouse.move(x1, y1, steps=steps)
        pg.mouse.up()
        pg.wait_for_timeout(150)

    # --- Ctrl/Shift-click selects several keys; a picked key goes on all of them as one undo step
    key(pg, 0, 0).click()
    key(pg, 0, 1).click(modifiers=["Control"])
    key(pg, 0, 2).click(modifiers=["Control"])
    expect(sel).to_have_count(3)
    expect(pg.locator(".edit-tools .sel-count")).to_contain_text("3 selected")
    key(pg, 0, 1).click(modifiers=["Control"])  # out again
    expect(sel).to_have_count(2)
    key(pg, 0, 1).click(modifiers=["Shift"])  # and back in
    expect(sel).to_have_count(3)
    assert L0() == orig, "holding Ctrl/Shift to click must not assign the modifier"
    expect(pg.locator(".hint")).to_contain_text("3 keys selected")
    shot(pg, "e2e-20-multiselect.png")
    pick(pg, 0x1B)  # KC_X
    assert L0()[0:3] == [0x1B] * 3 and L0()[3:] == orig[3:]
    assert "KC_X on 3 keys" in undo_btn.get_attribute("title"), undo_btn.get_attribute("title")
    undo_btn.click()
    pg.wait_for_timeout(150)
    assert L0() == orig
    redo_btn.click()
    pg.wait_for_timeout(150)
    assert L0()[0:3] == [0x1B] * 3
    undo_btn.click()
    pg.wait_for_timeout(150)
    ok("Ctrl/Shift-click selects several keys; picking a key sets all of them in one undo step")

    # typing goes to all selected keys too
    key(pg, 0, 3).click()
    key(pg, 0, 4).click(modifiers=["Shift"])
    pg.keyboard.press("z")
    pg.wait_for_timeout(120)
    assert L0()[3:5] == [0x1D, 0x1D] and L0()[0:3] == orig[0:3]
    undo_btn.click()
    pg.wait_for_timeout(150)
    assert L0() == orig
    # Esc clears the selection; a plain click on one of several selected keys selects just it
    key(pg, 0, 3).click()
    key(pg, 0, 4).click(modifiers=["Control"])
    key(pg, 0, 4).click()
    expect(sel).to_have_count(1)
    pg.keyboard.press("Escape")
    expect(sel).to_have_count(0)
    # "Select multiple" toggle: plain clicks add and remove (for touch screens)
    tool("Select multiple").click()
    expect(tool("Select multiple")).to_have_attribute("aria-pressed", "true")
    key(pg, 1, 1).click()
    key(pg, 2, 1).click()
    key(pg, 2, 2).click()
    expect(sel).to_have_count(3)
    key(pg, 2, 1).click()
    expect(sel).to_have_count(2)
    pg.keyboard.press("Escape")  # clears the selection
    expect(sel).to_have_count(0)
    pg.keyboard.press("Escape")  # then turns the toggle off
    expect(tool("Select multiple")).to_have_attribute("aria-pressed", "false")
    ok("typing sets all selected keys; Esc clears; 'Select multiple' toggle adds and removes with plain clicks")

    # --- dragging a box on empty space selects the keys inside it (left half = 19 keys)
    board = pg.locator(".stage .board").bounding_box()
    stage = pg.locator(".stage").bounding_box()
    start = (max(stage["x"] + 4, board["x"] - 30), board["y"] + 2)
    end = (board["x"] + board["width"] / 2, board["y"] + board["height"] - 2)
    assert pg.evaluate("([x, y]) => !document.elementFromPoint(x, y).closest('.key')", list(start))
    pg.mouse.move(*start)
    pg.mouse.down()
    pg.mouse.move(*end, steps=10)
    expect(pg.locator(".marquee")).to_have_count(1)
    expect(pg.locator(".stage .key.marq")).to_have_count(19)
    shot(pg, "e2e-21-box-select.png")
    pg.mouse.up()
    pg.wait_for_timeout(120)
    expect(pg.locator(".marquee")).to_have_count(0)
    expect(sel).to_have_count(19)
    # with Shift held a box adds to the selection
    pg.keyboard.press("Escape")
    key(pg, 4, 0).click()
    pg.keyboard.down("Shift")
    pg.mouse.move(*start)
    pg.mouse.down()
    pg.mouse.move(*end, steps=10)
    pg.mouse.up()
    pg.keyboard.up("Shift")
    pg.wait_for_timeout(120)
    expect(sel).to_have_count(20)
    assert L0() == orig
    pick(pg, 0x1E)  # KC_1 on all 20
    left = [r * COLS + c for r in range(4) for c in range(5) if (r, c) != (3, 1)]
    pg.wait_for_function("() => window.__mock.keymap[0].filter(c => c === 0x1E).length >= 20")  # 20 writes to the keyboard
    after = L0()
    assert all(after[i] == 0x1E for i in left + [20]) and after[21] == orig[21], after
    undo_btn.click()
    pg.wait_for_function("(o) => JSON.stringify(window.__mock.keymap[0]) === JSON.stringify(o)", arg=orig)
    pg.keyboard.press("Escape")
    ok("dragging a box selects the keys inside it; with Shift it adds to the selection")

    # --- drag a key onto another to swap them
    drag(key(pg, 0, 0), key(pg, 0, 4))
    assert L0()[0] == orig[4] and L0()[4] == orig[0], L0()[:5]
    assert "Swap KC_A ↔ KC_E" in undo_btn.get_attribute("title"), undo_btn.get_attribute("title")
    expect(sel).to_have_count(1)
    expect(key(pg, 0, 4)).to_have_class(re.compile(r"\bsel\b"))  # the selection follows the dragged key
    undo_btn.click()
    pg.wait_for_timeout(150)
    assert L0() == orig
    # while dragging: a ghost key follows the pointer, the target is highlighted
    x0, y0 = center(key(pg, 1, 1))
    pg.mouse.move(x0, y0)
    pg.mouse.down()
    pg.mouse.move(*center(key(pg, 1, 3)), steps=10)
    expect(pg.locator("body > .key.ghost")).to_have_count(1)
    expect(key(pg, 1, 1)).to_have_class(re.compile(r"\bdragging\b"))
    expect(key(pg, 1, 3)).to_have_class(re.compile(r"\bdrop\b"))
    shot(pg, "e2e-22-drag-swap.png")
    pg.keyboard.press("Escape")  # cancels the drag
    pg.mouse.up()
    pg.wait_for_timeout(120)
    expect(pg.locator(".key.ghost")).to_have_count(0)
    assert L0() == orig
    # Alt while dropping copies instead
    pg.keyboard.down("Alt")
    drag(key(pg, 0, 1), key(pg, 0, 2))
    pg.keyboard.up("Alt")
    assert L0()[1] == orig[1] and L0()[2] == orig[1], L0()[:5]
    assert "Copy KC_B onto KC_C" in undo_btn.get_attribute("title"), undo_btn.get_attribute("title")
    undo_btn.click()
    pg.wait_for_timeout(150)
    # holding the key over a layer tab switches layers: swap across layers
    drag(key(pg, 0, 3), key(pg, 0, 3), hover=pg.locator(".layer-tab").nth(2))
    expect(pg.locator(".layer-tab").nth(2)).to_have_class(re.compile(r"\bon\b"))
    assert mock(pg, "m.keymap[2][3]") == orig[3] and L0()[3] == 0, (mock(pg, "m.keymap[2][3]"), L0()[3])
    undo_btn.click()
    pg.wait_for_timeout(150)
    assert L0() == orig and mock(pg, "m.keymap[2][3]") == 0
    expect(pg.locator(".layer-tab").nth(2)).to_have_class(re.compile(r"\bon\b"))  # undo stays on the layer you're on
    ok("drag a key onto another to swap (Alt: copy, Esc: cancel, over a layer tab: across layers)")

    # --- Swap button: two selected keys swap at once; one key waits for the second (any layer)
    pg.locator(".layer-tab").first.click()
    pg.keyboard.press("Escape")
    # swap mode stays on: pair after pair, until Stop or Esc
    tool("Swap").click()
    expect(banner).to_contain_text("click two keys")
    expect(pg.locator(".hint")).to_contain_text("Click two keys to swap them, then the next two")
    key(pg, 0, 1).click()
    expect(key(pg, 0, 1)).to_have_class(re.compile(r"\bswap-src\b"))
    expect(pg.locator(".hint")).to_contain_text("Click the key to swap with (any layer)")
    shot(pg, "e2e-23-swap-mode.png")
    key(pg, 0, 2).click()
    pg.wait_for_function(f"() => window.__mock.keymap[0][1] === {orig[2]} && window.__mock.keymap[0][2] === {orig[1]}")
    expect(banner).to_contain_text("click two keys")  # still swapping
    key(pg, 0, 3).click()
    key(pg, 0, 3).click()  # the first key again: taken back
    expect(pg.locator(".key.swap-src")).to_have_count(0)
    key(pg, 0, 0).click()  # next pair, across layers
    pg.locator(".layer-tab").nth(3).click()
    key(pg, 1, 1).click()
    pg.wait_for_function(f"() => window.__mock.keymap[3][{1*COLS+1}] === {orig[0]} && window.__mock.keymap[0][0] === 0")
    expect(banner).to_contain_text("Swap")
    pg.keyboard.press("Escape")
    expect(banner).to_have_count(0)
    assert "layers 0 and 3" in undo_btn.get_attribute("title"), undo_btn.get_attribute("title")
    undo_btn.click()
    pg.wait_for_timeout(150)
    undo_btn.click()
    pg.wait_for_timeout(150)
    assert L0() == orig and mock(pg, f"m.keymap[3][{1*COLS+1}]") == 0
    # turned on with two keys selected: those swap first, and the mode stays on
    pg.locator(".layer-tab").first.click()
    key(pg, 0, 1).click()
    key(pg, 0, 2).click(modifiers=["Control"])
    tool("Swap").click()
    pg.wait_for_function(f"() => window.__mock.keymap[0][1] === {orig[2]}")
    expect(banner).to_contain_text("click two keys")
    banner.locator("button", has_text="Stop").click()
    expect(banner).to_have_count(0)
    undo_btn.click()
    pg.wait_for_function(f"() => window.__mock.keymap[0][1] === {orig[1]} && window.__mock.keymap[0][2] === {orig[2]}")
    assert L0() == orig
    ok("Swap mode: every two keys clicked swap (also across layers) until Stop or Esc; two selected keys swap first")

    # the wrap (Mod + key, …) belongs to Standard Keys: other tabs stay usable
    if pg.locator(".panel .wrapbox").count() == 0 or not pg.locator(".panel .wrapbox").is_visible():
        nav(pg, "Standard Keys")
    pg.locator(".panel .wrapbox .chip", has_text="Mod + key").click()
    expect(pg.locator(".panel .wrap-note")).to_contain_text("Greyed-out keys")
    nav(pg, "Layer Keys")
    assert pg.locator(".panel .pk:disabled").count() == 0, "layer keys greyed out by a wrap chosen in Standard Keys"
    nav(pg, "Special Keys")
    assert pg.locator(".panel .pk:disabled").count() == 0
    nav(pg, "Standard Keys")
    pg.locator(".panel .wrapbox .chip", has_text="Plain").click()
    ok("a wrap chosen in Standard Keys doesn't grey out keys in the other tabs; a note says why keys are greyed")

    # --- Lock key: pick a key once, then every click puts it on a key, until Esc or Stop
    pg.locator(".layer-tab").first.click()
    pg.keyboard.press("Escape")
    tool("Lock key").click()
    expect(banner).to_contain_text("Locked")
    expect(banner).to_contain_text("pick a key")
    pick(pg, 0x1B)  # KC_X becomes the locked key; nothing changes yet
    assert L0() == orig
    expect(banner.locator(".slot")).to_have_text("X")
    for c in (0, 1, 2):
        key(pg, 0, c).click()
    pg.wait_for_timeout(100)
    assert L0()[0:3] == [0x1B] * 3 and L0()[3:] == orig[3:]
    expect(pg.locator(".stage .key.sel")).to_have_count(0)
    shot(pg, "e2e-24-lock-key.png")
    undo_btn.click()  # one click = one undo step
    pg.wait_for_timeout(150)
    assert L0()[0:2] == [0x1B] * 2 and L0()[2] == orig[2]
    expect(banner).to_contain_text("Locked")  # still locked after undo
    # typing changes the locked key; Alt-click takes it from a key
    pg.keyboard.press("q")
    expect(banner.locator(".slot")).to_have_text("Q")
    key(pg, 0, 3).click()
    pg.wait_for_timeout(80)
    assert L0()[3] == 0x14
    key(pg, 2, 1).click(modifiers=["Alt"])  # KC_L
    expect(banner.locator(".slot")).to_have_text("L")
    assert L0()[11] == orig[11]
    key(pg, 0, 4).click()
    pg.wait_for_timeout(80)
    assert L0()[4] == orig[11]
    # switching layers while locked
    pg.locator(".layer-tab").nth(4).click()
    key(pg, 0, 0).click()
    pg.wait_for_timeout(80)
    assert mock(pg, "m.keymap[4][0]") == orig[11]
    # Stop button ends it; clicks select again
    banner.get_by_role("button", name="Stop locking").click()
    expect(banner).to_have_count(0)
    key(pg, 0, 1).click()
    expect(sel).to_have_count(1)
    assert mock(pg, "m.keymap[4][1]") == 0
    # starting with a key selected locks that key; Esc stops
    pg.locator(".layer-tab").first.click()
    key(pg, 2, 2).click()
    tool("Lock key").click()
    expect(banner.locator(".slot")).to_have_text("M")  # position 12 = KC_M
    key(pg, 2, 3).click()
    pg.wait_for_timeout(80)
    assert L0()[13] == orig[12]
    pg.keyboard.press("Escape")
    expect(banner).to_have_count(0)
    key(pg, 2, 4).click()
    assert L0()[14] == orig[14]
    # with nothing picked yet, the first key clicked is the one to copy
    pg.keyboard.press("Escape")
    tool("Lock key").click()
    key(pg, 3, 2).click()  # MO(1)
    pg.wait_for_timeout(80)
    assert L0()[17] == orig[17]
    expect(banner.locator(".slot")).to_contain_text("MO")
    key(pg, 3, 3).click()
    pg.wait_for_timeout(80)
    assert L0()[18] == orig[17] == 0x5221
    pg.keyboard.press("Escape")
    ok("Lock key: picked/typed/Alt-clicked key goes on every clicked key (any layer) until Stop or Esc")

    # ===================================================================== mouse keys
    def mouse_page(cfg):
        page = browser.new_context(viewport={"width": 1440, "height": 900}).new_page()
        page.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
        page.add_init_script(f"window.__mockConfig = {cfg}")
        page.add_init_script(path=ROOT + "/test/mock-totem.js")
        page.goto(URL)
        page.get_by_role("button", name="Connect TOTEM").click()
        page.wait_for_selector(".stage .board .key")
        page.locator(".nav-item", has_text="Special Keys").click()
        page.wait_for_timeout(100)
        return page
    pg5 = mouse_page("{ noMouseKeys: true }")
    mouse_sec = pg5.locator(".panel section", has_text="Mouse").filter(has=pg5.locator('.pk[data-code="%d"]' % 0xCD))
    expect(mouse_sec).to_contain_text("Your TOTEM's firmware has no mouse keys")
    key(pg5, 0, 0).click()
    mouse_sec.locator('.pk[data-code="%d"]' % 0xCD).click()  # Mouse Up
    pg5.wait_for_timeout(100)
    assert pg5.evaluate("() => window.__mock.keymap[0][0]") == 0xCD
    assert "unsupported" in key(pg5, 0, 0).get_attribute("class")
    assert "no mouse keys" in key(pg5, 0, 0).get_attribute("title")
    shot(pg5, "e2e-19-no-mousekeys.png")
    pg6 = mouse_page("{}")
    assert pg6.locator("text=Your TOTEM's firmware has no mouse keys").count() == 0
    key(pg6, 0, 0).click()
    pg6.locator('.panel .pk[data-code="%d"]' % 0xD1).first.click()  # Mouse 1
    pg6.wait_for_timeout(100)
    assert "unsupported" not in key(pg6, 0, 0).get_attribute("class")
    pg6.locator(".nav-item", has_text="Settings").click()
    expect(pg6.locator(".panel")).to_contain_text("Mouse keys")
    ok("warns when the firmware has no mouse keys (and only then)")

    # ===================================================================== computer keyboard layout
    GERMAN_MAP = """
      (() => {
        const m = new Map();
        for (let i = 0; i < 26; i++) m.set("Key" + String.fromCharCode(65 + i), String.fromCharCode(97 + i));
        for (let i = 0; i <= 9; i++) m.set("Digit" + i, String(i));
        Object.entries({ KeyY: "z", KeyZ: "y", Minus: "ß", Equal: "´", BracketLeft: "ü", BracketRight: "+", Backslash: "#",
          Semicolon: "ö", Quote: "ä", Backquote: "^", Comma: ",", Period: ".", Slash: "-", IntlBackslash: "<" }).forEach(([k, v]) => m.set(k, v));
        Object.defineProperty(Navigator.prototype, "keyboard", { configurable: true, get: () => ({ getLayoutMap: async () => m }) });
      })();
    """
    pg4 = browser.new_context(viewport={"width": 1440, "height": 900}).new_page()
    pg4.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
    pg4.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg4.add_init_script(GERMAN_MAP)
    pg4.add_init_script(path=ROOT + "/test/mock-totem.js")
    pg4.goto(URL)
    pg = pg4
    pg.get_by_role("button", name="Connect TOTEM").click()
    pg.wait_for_selector(".stage .board .key")
    # mock keymap: matrix 4,4 is KC_Y and 5,0 is KC_Z
    expect(key(pg, 4, 4)).to_have_text("Z")
    expect(key(pg, 5, 0)).to_have_text("Y")
    expect(pg.locator(".panel .layout-select")).to_have_value("auto")
    expect(pg.locator(".panel .layout-select option").first).to_have_text("Automatic: German")
    ok("detects a German computer layout automatically: KC_Y shows Z, KC_Z shows Y")

    # ISO picker with the <> key, and the symbols German types with Shift / AltGr
    grid = pg.locator(".panel .kgrid").first
    assert grid.locator('.pk[data-code="%d"]' % 0x64).count() == 1
    expect(grid.locator('.pk[data-code="%d"]' % 0x64)).to_contain_text("<")
    expect(grid.locator('.pk[data-code="%d"]' % 0x1C)).to_have_text("Z")
    expect(pg.locator(".panel section", has_text="Symbols on German")).to_contain_text("AltGr")
    key(pg, 0, 0).click()
    pg.locator('.panel .pk[data-code="%d"]' % 0x1414).click()  # @ = AltGr+Q
    pg.wait_for_timeout(100)
    assert mock(pg, "m.keymap[0][0]") == 0x1414
    expect(key(pg, 0, 0)).to_have_text("@")
    ok("picker is QWERTZ with the ISO key; Symbols lists AltGr characters (@ = RALT(KC_Q))")

    # typing with AltGr on the computer keyboard
    key(pg, 0, 1).click()
    pg.evaluate("""() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyE", key: "€", ctrlKey: true, altKey: true, modifierAltGraph: true, bubbles: true }))""")
    pg.wait_for_timeout(100)
    assert mock(pg, "m.keymap[0][1]") == 0x1408, hex(mock(pg, "m.keymap[0][1]"))
    expect(key(pg, 0, 1)).to_have_text("€")
    key(pg, 0, 2).click()
    pg.evaluate("""() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit2", key: '"', shiftKey: true, bubbles: true }))""")
    pg.wait_for_timeout(100)
    assert mock(pg, "m.keymap[0][2]") == 0x021F
    expect(key(pg, 0, 2)).to_have_text('"')
    ok("typing AltGr+E assigns RALT(KC_E) and shows €; Shift+2 shows \"")

    # macro text that would come out wrong on German is converted to key taps
    nav(pg, "Macros")
    pg.locator(".panel .item").nth(2).locator(".icon-btn").click()
    pg.locator(".panel .chip", has_text="+ Text").click()
    t = pg.locator('.panel .action input[type="text"]')
    t.fill("yes, Grüße")
    expect(pg.locator(".panel .layout-fix")).to_contain_text("On German this types “zes, Gr")
    pg.locator(".panel .layout-fix .chip").click()
    pg.wait_for_timeout(150)
    expect(pg.locator(".panel .action select").first).to_have_value("tap")
    assert mock(pg, "1") == 1
    shot(pg, "e2e-15-german-macro.png")
    pg.locator(".panel .pill", has_text="Save to keyboard").click()
    pg.wait_for_selector("text=Unlock your TOTEM")
    pg.wait_for_selector("text=Unlock your TOTEM", state="detached", timeout=10000)
    pg.wait_for_timeout(300)
    buf = mock(pg, "Array.from(m.macroBuf.slice(0, 80))")
    m2 = bytes(buf).split(b"\x00")[2]
    # y=KC_Z, e, s, ",", space, G with Shift (16-bit), r, ü=KC_LBRC, ß=KC_MINUS, e
    assert list(m2) == [1, 1, 0x1D, 1, 1, 0x08, 1, 1, 0x16, 1, 1, 0x36, 1, 1, 0x2C, 1, 5, 0x0A, 0x02, 1, 1, 0x15, 1, 1, 0x2F, 1, 1, 0x2D, 1, 1, 0x08], list(m2)
    ok("macro text: warns what German really types and converts it to key taps (incl. ü ß)")

    # choosing a layout by hand wins over detection and is remembered
    nav(pg, "Settings")
    pg.locator(".panel .layout-select").select_option("french")
    pg.wait_for_timeout(150)
    expect(key(pg, 4, 4)).to_have_text("Y")
    expect(key(pg, 0, 4)).to_have_text("E")  # mock KC_E stays E on AZERTY
    expect(pg.locator(".panel")).to_contain_text("Detected from this computer's keyboard layout")
    shot(pg, "e2e-16-settings-layout.png")
    pg.reload()
    pg.get_by_role("button", name="Connect TOTEM").click()
    pg.wait_for_selector(".stage .board .key")
    expect(pg.locator(".panel-head h2")).to_have_text("Standard Keys")
    expect(pg.locator(".panel .layout-select")).to_have_value("french")
    expect(pg.locator(".panel .kgrid").first.locator('.pk[data-code="%d"]' % 0x14)).to_have_text("A")  # KC_Q is A on AZERTY
    pg.locator(".panel .layout-select").select_option("us")
    pg.wait_for_timeout(150)
    expect(key(pg, 4, 4)).to_have_text("Y")
    expect(key(pg, 5, 0)).to_have_text("Z")
    expect(pg.locator(".panel .layout-select")).to_have_value("us")
    shot(pg, "e2e-17-us-again.png")
    ok("a chosen layout overrides detection and is remembered after a reload")

    # ===================================================================== desktop overlay
    def overlay_page(cfg="{}", page="overlay", ctx=None):
        c = ctx or browser.new_context(viewport={"width": 760, "height": 280})
        p2 = c.new_page()
        p2.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
        p2.on("console", lambda m: m.type == "error" and errors.append(m.text))
        p2.add_init_script(f"window.__mockConfig = {cfg}")
        p2.add_init_script(path=ROOT + "/test/mock-totem.js")
        p2.add_init_script("window.__mock.permitted = true")  # the overlay app allows the TOTEM up front
        p2.goto(URL + "#" + page)
        return p2
    ev = lambda page, js: page.evaluate(f"() => {{ const m = window.__mock; {js}; }}")
    okey = lambda page, pos: page.locator(f'.ovl .key[data-pos="{pos}"]')
    olbl = lambda page, pos: page.locator(f'.ovl .key[data-pos="{pos}"] .lbl')  # main legend

    # replies for another program (the editor) arrive in between; the overlay must ignore them
    ov = overlay_page("{ crossTalk: 'untagged' }")
    ov.wait_for_selector(".ovl .key")
    expect(ov.locator(".ovl-status")).to_have_count(0)
    expect(ov.locator(".ovl .key")).to_have_count(38)
    expect(ov.locator(".ovl")).to_have_attribute("data-layer", "0")
    expect(okey(ov, 0)).to_have_text("A")
    assert ov.evaluate("() => getComputedStyle(document.body).backgroundColor") == "rgba(0, 0, 0, 0)"
    assert ov.evaluate("() => window.__mock.foreign") > 20
    ok("overlay: see-through page, finds the TOTEM through its own tagged requests, draws the base layer")

    ev(ov, "m.keymap[2][0] = 0x1e; m.keymap[0][3] = 0x1e; m.layerState = 1 << 2")  # layer 2 on, and keys changed elsewhere
    expect(ov.locator(".ovl")).to_have_attribute("data-layer", "2")
    expect(ov.locator(".ovl-title")).to_contain_text("Layer 2")
    expect(olbl(ov, 0)).to_have_text("1", timeout=6000)  # re-read after the keymap checksum changed
    ev(ov, "m.layerState = 1 << 1")  # layer 1 is all transparent: shows layer 0, dimmed
    expect(ov.locator(".ovl")).to_have_attribute("data-layer", "1")
    expect(okey(ov, 0)).to_have_text("A")
    expect(okey(ov, 0)).to_have_class(re.compile(r"\bthrough\b"))
    shot(ov, "e2e-25-overlay-layer1.png")
    ok("overlay follows the layer, shows transparent keys' fallthrough dimmed, and re-reads changed keys")

    ev(ov, "m.layerState = 0; m.mods = 0x02")  # Shift held: KC_1 (position 3 now) shows !
    expect(okey(ov, 3)).to_have_text("!")  # just the shifted character
    expect(ov.locator(".ovl-title .ovl-mod")).to_have_text("⇧")
    ev(ov, "m.mods = 0")
    expect(olbl(ov, 3)).to_have_text("1")
    ev(ov, "m.pressed.add('0,2')")
    ov.wait_for_timeout(300)
    expect(ov.locator(".ovl .key.held")).to_have_count(0)  # locked: the firmware keeps held keys to itself
    ev(ov, "m.unlocked = true")
    expect(ov.locator(".ovl .key.held")).to_have_count(1)
    expect(okey(ov, 2)).to_have_class(re.compile(r"\bheld\b"))
    ev(ov, "m.pressed.clear(); m.unlocked = false")
    ok("overlay: Shift legends; held keys light up only while the keyboard is unlocked")

    # the settings page (same app, same storage) changes the overlay at once
    sp = ov.context.new_page()
    sp.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
    sp.set_viewport_size({"width": 800, "height": 1400})
    sp.goto(URL + "#overlay-settings")
    expect(sp.locator(".ov-preview .key")).to_have_count(38)
    expect(sp.locator(".ov-preview-wrap")).to_contain_text("as the overlay last read it")
    sp.locator(".ov-settings .chip", has_text="High contrast").click()
    expect(okey(ov, 0)).to_have_css("background-color", "rgba(0, 0, 0, 0.92)")
    sp.locator(".ov-settings .seg button", has_text="Only on other layers").click()
    expect(ov.locator(".ovl")).to_have_class(re.compile(r"\bovl-away\b"))
    ev(ov, "m.layerState = 1 << 3")
    expect(ov.locator(".ovl")).not_to_have_class(re.compile(r"\bovl-away\b"))
    ev(ov, "m.layerState = 0")
    sp.locator(".ov-settings label.check", has_text="Lowercase letters").locator("input").check()
    expect(okey(ov, 0)).to_have_text("a")
    ev(ov, "m.capsLock = true")
    expect(okey(ov, 0)).to_have_text("A")
    ev(ov, "m.capsLock = false")
    shot(sp, "e2e-26-overlay-settings.png")
    ok("overlay settings page: live preview of the TOTEM's layout; style, show-only-on-layers and lowercase reach the overlay")

    # layer names from a .vil file (saved earlier, with layer 0 named "Base")
    ev(ov, "m.layerState = 0")
    with sp.expect_file_chooser() as fc:
        sp.locator(".ov-settings .pill", has_text="Load names from a .vil file").click()
    fc.value.set_files(named_path)
    expect(sp.locator(".ov-settings")).to_contain_text("Loaded")
    sp.locator(".ov-settings .seg button", has_text="Always").click()
    expect(ov.locator(".ovl-title")).to_contain_text("Base")
    sp.locator(".ov-settings .pill", has_text="Reset to defaults").click()
    expect(okey(ov, 0)).to_have_text("A")
    ok("layer names load from a .vil into the overlay; Reset to defaults")

    # unlocking from the overlay (for held keys): it shows the keys to hold, then the layout again
    ul = overlay_page("{ crossTalk: 'untagged', autoHold: false }")
    ul.wait_for_selector(".ovl .key")
    expect(ul.locator(".ovl-status")).to_have_count(0)
    ul.evaluate("() => window.__overlayCommand('unlock')")
    expect(ul.locator(".ovl-unlock.hold")).to_be_visible()
    expect(ul.locator(".ovl-unlock")).to_contain_text("Hold the two highlighted keys")
    assert ul.eval_on_selector_all(".ovl-unlock .key.unlock", "els => els.map(e => e.dataset.pos)") == ["0", "20"]
    assert ul.evaluate("() => getComputedStyle(document.querySelector('.ovl-unlock')).backgroundColor") != "rgba(0, 0, 0, 0)"
    ul.wait_for_timeout(500)
    expect(ul.locator(".ovl-unlock-bar > div")).to_have_attribute("style", re.compile(r"width: 0%"))  # not held yet
    ev(ul, "m.hold = true")
    expect(ul.locator(".ovl-unlock.done")).to_be_visible(timeout=8000)
    shot(ul, "e2e-28-overlay-unlocked.png")
    expect(ul.locator(".ovl-unlock")).to_have_count(0, timeout=6000)
    assert ul.evaluate("() => window.__mock.unlocked")
    ev(ul, "m.pressed.add('1,1')")
    expect(ul.locator(".ovl .key.held")).to_have_count(1)
    assert ul.evaluate("() => JSON.parse(localStorage.getItem('totem-keybard:overlay-status')).unlocked")
    ul.evaluate("() => window.__overlayCommand('lock')")
    expect(ul.locator(".ovl .key.held")).to_have_count(0)
    assert not ul.evaluate("() => window.__mock.unlocked")
    ok("overlay unlock: opaque panel with the two keys to hold and a bar; held keys after; Lock hides them again")

    # firmware without the overlay report: base layer only, and says why
    old = overlay_page("{ noOverlay: true }")
    expect(old.locator(".ovl-status")).to_contain_text("can't report layers")
    expect(old.locator(".ovl .key")).to_have_count(38)
    expect(old.locator('.ovl .key[data-pos="0"]')).to_have_text("A")
    old.evaluate("() => window.__overlayCommand('unlock')")
    expect(old.locator(".ovl-unlock.error")).to_contain_text("can't show held keys")
    expect(old.locator(".ovl-unlock")).to_have_count(0, timeout=6000)
    ok("overlay on a firmware without the report: shows the base layer and explains (also when asked to unlock)")

    # the editor while an overlay runs alongside: overlay replies arrive in between and are ignored
    ed = overlay_page("{ crossTalk: 'tagged' }", page="")
    ed.set_viewport_size({"width": 1440, "height": 900})
    ed.wait_for_selector(".stage .board .key")  # reconnects by itself: the TOTEM was allowed before
    expect(ed.locator(".overlay")).to_have_count(0)
    assert key(ed, 0, 0).inner_text().strip() == "A" and "LGUI_T" in key(ed, 1, 0).inner_text()
    key(ed, 0, 1).click()
    ed.locator('.panel .pk[data-code="%d"]' % 0x1B).first.click()
    ed.wait_for_function("() => window.__mock.keymap[0][1] === 0x1b")
    ed.locator(".nav-item", has_text="Tap Dances").click()
    expect(ed.locator(".panel .item").first).to_contain_text(re.compile("esc", re.I))
    ed.locator(".nav-item", has_text="Overlay").click()
    expect(ed.locator('.panel .notice[data-support="yes"]')).to_be_visible()
    assert ed.evaluate("() => window.__mock.foreign") > 40
    shot(ed, "e2e-27-editor-overlay-panel.png")
    ed2 = overlay_page("{ noOverlay: true }", page="")
    ed2.wait_for_selector(".stage .board .key")
    expect(ed2.locator(".overlay")).to_have_count(0)
    ed2.locator(".nav-item", has_text="Overlay").click()
    expect(ed2.locator('.panel .notice[data-support="no"]')).to_contain_text("totem_vial_keybard_left.uf2")
    ok("editor works with overlay traffic in between; its Overlay panel checks the firmware")

    # ===================================================================== stored layers
    sp = overlay_page("{}", page="")
    sp.set_viewport_size({"width": 1440, "height": 900})
    sp.wait_for_selector(".stage .board .key")
    nav(sp, "Stored Layers")
    expect(sp.locator(".panel .notice")).to_contain_text("Nothing stored yet")
    km = lambda l: mock(sp, f"m.keymap[{l}].join()")
    L0, L1 = km(0), km(1)
    sp.locator(".panel .sl-store select").select_option("1")
    sp.locator(".panel .sl-store button").click()
    cards = sp.locator(".panel .sl-card")
    named = lambda t: cards.filter(has=sp.locator(".sl-name", has_text=t))
    expect(cards).to_have_count(1)
    expect(cards.first.locator(".sl-name")).to_have_text("Layer 1")
    sp.locator(".panel .sl-store button").click()
    expect(sp.locator('.toast[data-id="stored"]')).to_contain_text("stored already")
    expect(cards).to_have_count(1)
    ok("Store this layer: keeps a copy of a layer (once: storing the same keys again says so)")

    cards.first.locator(".sl-actions select").select_option("0")
    cards.first.locator(".sl-load").click()
    sp.wait_for_function(f"() => window.__mock.keymap[0].join() === {json.dumps(L1)}")
    expect(sp.locator('.toast[data-id="stored"]')).to_contain_text("What was there is stored as “Layer 0”")
    expect(cards).to_have_count(2)
    assert km(1) == L1
    expect(sp.locator(".layer-tab").first).not_to_have_text("Layer 1")  # a plain "Layer N" doesn't name the layer
    shot(sp, "e2e-31-stored-layers.png")
    undo_s = sp.locator('.topbar button[title^="Undo"]')
    undo_s.click()
    sp.wait_for_function(f"() => window.__mock.keymap[0].join() === {json.dumps(L0)}")
    expect(cards).to_have_count(2)  # undo doesn't lose any stored layer
    ok("Load into layer 0: writes the stored keys, stores what was there first; Undo restores the layer and keeps both stored")

    old = named("Layer 0")
    old.locator("button", has_text="Rename").click()
    sp.locator(".panel .sl-rename").fill("Colemak")
    sp.keyboard.press("Enter")
    expect(named("Colemak")).to_have_count(1)
    neo = named("Layer 1")
    neo.locator(".sl-name").click()
    sp.locator(".panel .sl-rename").fill("Neo")
    sp.keyboard.press("Enter")
    neo = named("Neo")
    neo.locator(".sl-actions select").select_option("0")
    neo.locator(".sl-load").click()
    sp.wait_for_function(f"() => window.__mock.keymap[0].join() === {json.dumps(L1)}")
    expect(sp.locator(".layer-tab").first).to_have_text("Neo")  # a real name names the layer
    expect(cards).to_have_count(2)  # the old layer 0 is stored already (as Colemak)
    named("Colemak").locator(".sl-load").click()  # its target is layer 0 as well
    sp.wait_for_function(f"() => window.__mock.keymap[0].join() === {json.dumps(L0)}")
    expect(sp.locator(".layer-tab").first).to_have_text("Colemak")
    expect(cards).to_have_count(2)
    ok("switching layer 0 between “Colemak” and “Neo”: keys and layer name follow, nothing piles up")

    sp.locator(".panel .stored input[type=file]").set_input_files(named_path)
    expect(sp.locator('.toast[data-id="stored"]')).to_contain_text("from “named.vil”")
    expect(cards.filter(has_text="named.vil").first).to_be_visible()
    assert named("Base").count() >= 1 or named("Nav").count() >= 1
    n = cards.count()
    page2 = overlay_page("{}", page="", ctx=sp.context)  # the same browser storage, reloaded
    page2.set_viewport_size({"width": 1440, "height": 900})
    page2.wait_for_selector(".stage .board .key")
    nav(page2, "Stored Layers")
    expect(page2.locator(".panel .sl-card")).to_have_count(n)
    page2.close()
    named("Colemak").locator(".sl-delete").click()
    sp.locator(".modal .pill", has_text="Delete").click()
    expect(cards).to_have_count(n - 1)
    expect(named("Colemak")).to_have_count(0)
    ok(f"Store layers from a .vil (named after its layers), kept across reloads ({n} stored), Delete asks first")

    # ===================================================================== open by dropping a file
    dp = browser.new_context(viewport={"width": 1440, "height": 900}).new_page()
    dp.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
    dp.goto(URL)
    expect(dp.locator(".welcome")).to_be_visible()
    def drop(page, name, text):
        page.evaluate("""([name, text]) => {
            const dt = new DataTransfer();
            dt.items.add(new File([text], name, { type: "application/json" }));
            window.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
            window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
        }""", [name, text])
    drop(dp, "notes.txt", "hello")
    expect(dp.locator(".toast.error")).to_contain_text("notes.txt isn't a .vil layout")
    drop(dp, "named.vil", open(named_path).read())
    dp.wait_for_selector(".stage .board .key")
    expect(dp.locator(".topbar")).to_contain_text("named.vil · offline")
    expect(dp.locator(".layer-tab").first).to_have_text("Base")
    ok("a .vil dropped on the window opens (no file dialog needed); other files are refused")

    # ===================================================================== layer lights
    lt = overlay_page("{ crossTalk: 'tagged' }", page="")
    lt.set_viewport_size({"width": 1440, "height": 900})
    lt.wait_for_selector(".stage .board .key")
    nav(lt, "Layer Lights")
    rows = lt.locator(".panel .light-row")
    expect(rows).to_have_count(5)  # the mock TOTEM has 5 layers
    expect(lt.locator(".panel .ov-val").first).to_have_text("19 %")  # 48 of 255
    expect(rows.nth(0)).to_have_class(re.compile(r"\boff\b"))
    expect(rows.nth(2)).to_have_attribute("data-color", "#005aff")
    shot(lt, "e2e-28-layer-lights.png")
    ok("Layer Lights panel: reads the colours and brightness from the TOTEM, one row per layer, base layer off")

    def pick_color(row, value):
        lt.locator(f'.panel .light-row[data-layer="{row}"] input[type=color]').evaluate(
            "(e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }", value)
    inp2 = lt.locator('.panel .light-row[data-layer="2"] input[type=color]').element_handle()
    pick_color(2, "#ff0000")
    lt.wait_for_function("() => window.__mock.lights.colors[2].join() === '255,0,0'")
    assert mock(lt, "m.ledColor().join()") == "48,0,0", mock(lt, "m.ledColor()")  # shown for a moment on layer 0
    expect(lt.locator(".panel .lights-note")).to_have_text("✓ Saved on your TOTEM", timeout=4000)
    assert mock(lt, "m.lightsSaved.colors[2].join()") == "255,0,0"
    assert inp2.evaluate("e => e.isConnected"), "the colour input was replaced while picking (would close the picker)"
    expect(lt.locator('.panel .light-row[data-layer="2"]')).to_have_attribute("data-color", "#ff0000")
    ok("picking a colour: shows on the keyboard at once (preview), saved on it after a moment; the picker stays open")

    saves = mock(lt, "m.lightSaves")
    sets = mock(lt, "m.lightSets")
    lt.locator('.panel .light-row[data-layer="1"] input[type=color]').evaluate(
        """e => { for (let i = 0; i < 30; i++) { e.value = '#' + [i * 8, 255 - i * 8, 0].map(v => v.toString(16).padStart(2, '0')).join('');
                  e.dispatchEvent(new Event('input', { bubbles: true })); } }""")  # a quick drag: 30 colours at once
    lt.wait_for_function("() => window.__mock.lights.colors[1].join() === '232,23,0'")
    expect(lt.locator(".panel .lights-note")).to_have_text("✓ Saved on your TOTEM", timeout=4000)
    assert mock(lt, "m.lightsSaved.colors[1].join()") == "232,23,0"
    d_sets, d_saves = mock(lt, "m.lightSets") - sets, mock(lt, "m.lightSaves") - saves
    assert d_sets < 30 and d_saves <= 2, (d_sets, d_saves)
    ok(f"dragging through 30 colours: the keyboard gets {d_sets} updates (latest only) and {d_saves} save, ending on the last colour")

    off3 = lt.locator('.panel .light-row[data-layer="3"] .light-off')
    off3.click()
    lt.wait_for_function("() => window.__mock.lights.colors[3].join() === '0,0,0'")
    expect(lt.locator('.panel .light-row[data-layer="3"]')).to_have_class(re.compile(r"\boff\b"))
    expect(lt.locator('.panel .light-row[data-layer="3"] .light-off')).to_have_attribute("aria-pressed", "true")
    lt.locator('.panel .light-row[data-layer="3"] .light-off').click()
    lt.wait_for_function("() => window.__mock.lights.colors[3].join() === '0,255,60'")
    expect(lt.locator('.panel .light-row[data-layer="3"]')).not_to_have_class(re.compile(r"\boff\b"))  # re-rendered
    ok("Off turns a layer's light off and back on with its colour")

    lt.locator('.panel input[aria-label="Brightness"]').evaluate("e => { e.value = '100'; e.dispatchEvent(new Event('input', { bubbles: true })); }")
    lt.wait_for_function("() => window.__mock.lights.brightness === 255")
    expect(lt.locator(".panel .ov-val").first).to_have_text("100 %")
    ok("brightness slider sets the LEDs' brightness")

    # turn off after a while without a key press; effects per layer and their speed
    expect(lt.locator(".panel .light-timeout")).to_have_value("0")
    lt.locator(".panel .light-timeout").select_option("300")
    lt.wait_for_function("() => window.__mock.lights.timeout === 300")
    lt.locator('.panel .light-row[data-layer="2"] .light-effect').select_option("1")
    lt.wait_for_function("() => window.__mock.lights.effects[2] === 1")
    lt.locator('.panel .light-row[data-layer="4"] .light-effect').select_option("2")
    lt.wait_for_function("() => window.__mock.lights.effects[4] === 2")
    expect(lt.locator('.panel .light-row[data-layer="4"] .light-rainbow')).to_be_visible()
    expect(lt.locator('.panel .light-row[data-layer="4"] input[type=color]')).to_have_count(0)
    lt.locator('.panel input[aria-label="Effect speed"]').evaluate("e => { e.value = '80'; e.dispatchEvent(new Event('input', { bubbles: true })); }")
    lt.wait_for_function("() => window.__mock.lights.speed === 204")
    expect(lt.locator(".panel .lights-note")).to_have_text("✓ Saved on your TOTEM", timeout=4000)
    assert mock(lt, "m.lightsSaved.timeout === 300 && m.lightsSaved.effects[2] === 1 && m.lightsSaved.effects[4] === 2 && m.lightsSaved.speed === 204")
    lt.locator('.panel .light-row[data-layer="4"] .light-off').click()  # off: a rainbow would ignore the colour
    lt.wait_for_function("() => window.__mock.lights.effects[4] === 0 && window.__mock.lights.colors[4].join() === '0,0,0'")
    lt.locator('.panel .light-row[data-layer="4"] .light-off').click()
    lt.wait_for_function("() => window.__mock.lights.colors[4].join() === '255,0,180'")
    lt.locator('.panel .light-row[data-layer="4"] .light-effect').select_option("2")
    lt.wait_for_function("() => window.__mock.lights.effects[4] === 2")
    shot(lt, "e2e-28b-layer-lights-effects.png")
    ok("turn off after 5 minutes idle; breathe and rainbow per layer; effect speed; all saved on the keyboard")

    lt.locator(".panel button", has_text="Editor's layer colours").click()
    lt.wait_for_function("() => window.__mock.lights.colors[1].join() === '55,156,215'")  # the editor's layer 1 (#379cd7)
    assert mock(lt, "m.lights.colors[0].join()") == "0,0,0" and mock(lt, "m.lights.colors[4].join()") == "181,80,138"
    lt.locator(".panel button", has_text="Defaults").click()
    lt.wait_for_function("() => window.__mock.lights.brightness === 48 && window.__mock.lights.colors[2].join() === '0,90,255' && window.__mock.lights.timeout === 0 && window.__mock.lights.speed === 128 && window.__mock.lights.effects.every(e => e === 0)")
    expect(lt.locator(".panel .lights-note")).to_have_text("✓ Saved on your TOTEM", timeout=4000)
    assert mock(lt, "JSON.stringify(m.lightsSaved) === JSON.stringify(m.lights)")
    lt.locator(".panel button", has_text="All off").click()
    lt.wait_for_function("() => window.__mock.lights.colors.slice(0, 5).every(c => c.join() === '0,0,0')")
    expect(lt.locator(".panel .light-row.off")).to_have_count(5)
    ok("Editor's layer colours (base layer kept), Defaults and All off; all saved")

    lt.emulate_media(color_scheme="dark")
    lt.locator(".panel button", has_text="Defaults").click()
    lt.wait_for_timeout(300)
    shot(lt, "e2e-29-layer-lights-dark.png")
    lt.set_viewport_size({"width": 390, "height": 844})
    lt.wait_for_timeout(200)
    shot(lt, "e2e-30-layer-lights-phone.png")

    nolight = overlay_page("{ noLights: true }", page="")
    nolight.set_viewport_size({"width": 1440, "height": 900})
    nolight.wait_for_selector(".stage .board .key")
    nav(nolight, "Layer Lights")
    expect(nolight.locator('.panel .notice[data-lights="no"]')).to_contain_text("totem_vial_keybard_left.uf2")
    expect(nolight.locator(".panel .light-row")).to_have_count(0)
    noreport = overlay_page("{ noOverlay: true }", page="")
    noreport.set_viewport_size({"width": 1440, "height": 900})
    noreport.wait_for_selector(".stage .board .key")
    nav(noreport, "Layer Lights")
    expect(noreport.locator('.panel .notice[data-lights="no"]')).to_be_visible()
    ok("older firmware (overlay report without lights, or no report): says to flash the new firmware")

    assert not errors, errors
    print(f"\nALL {len(passed)} CHECKS PASSED  (screenshots in {SHOTS})")
    browser.close()

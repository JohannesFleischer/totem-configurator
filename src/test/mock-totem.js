// A simulated TOTEM running vial-qmk, exposed through a fake navigator.hid.
// Behaviour follows vial-qmk's quantum/via.c and quantum/vial.c (protocol 6):
// VIA replies echo the command byte, Vial (0xFE) replies overwrite the buffer,
// macros/matrix/QK_BOOT need an unlock, and during an unlock only a few commands work.
// Load before the app (Playwright add_init_script). State lives on window.__mock.
(() => {
    const cfg = Object.assign({ layers: 5, macros: 16, macroBuf: 900, td: 8, combos: 8, ko: 8, ar: 0, autoHold: true, productName: "TOTEM" }, window.__mockConfig || {});
    const ROWS = 8, COLS = 5;
    const keymap = [];
    for (let l = 0; l < cfg.layers; l++) {
        const layer = [];
        for (let i = 0; i < ROWS * COLS; i++) layer.push(l === 0 ? 4 + (i % 26) : l === 1 ? 1 : 0);
        keymap.push(layer);
    }
    keymap[0][3 * COLS + 2] = 0x5221; // MO(1) on a thumb
    keymap[0][1 * COLS + 0] = 0x2804; // LGUI_T(KC_A)
    keymap[0][7 * COLS + 2] = 0x412c; // LT1(KC_SPACE)
    if (cfg.layers > 2) keymap[2][0] = 0x7c00; // QK_BOOT

    const macroBuf = new Uint8Array(cfg.macroBuf);
    const initMacro = [..."hello"].map((c) => c.charCodeAt(0)).concat([1, 1, 0x28]); // "hello" + tap(Enter)
    macroBuf.set(initMacro, 0);
    const td = Array.from({ length: cfg.td }, () => [0, 0, 0, 0, 200]);
    td[0] = [0x29, 0xe0, 0, 0, 200];
    const combos = Array.from({ length: cfg.combos }, () => [0, 0, 0, 0, 0]);
    combos[0] = [0x0d, 0x0e, 0, 0, 0x29];
    const ko = Array.from({ length: cfg.ko }, () => ({ trigger: 0, replacement: 0, layers: 0, tm: 0, nm: 0, sm: 0, opt: 0 }));
    ko[0] = { trigger: 0x2a, replacement: 0x4c, layers: 0xffff, tm: 0x22, nm: 0, sm: 0x22, opt: 0x87 };
    const widths = { 1: 1, 2: 2, 3: 1, 4: 2, 5: 1, 6: 2, 7: 2, 8: 1, 9: 2, 10: 2, 11: 2, 12: 2, 13: 2, 14: 2, 15: 2, 16: 2, 17: 2, 18: 2, 19: 2, 20: 1, 21: 4, 22: 1, 23: 1, 24: 1, 25: 2, 26: 1, 27: 2 };
    // the setting ids current vial-qmk declares (quantum/qmk_settings.c)
    const settings = { 1: 0, 2: 50, 3: 0, 4: 175, 5: 5, 6: 5000, 7: 200, 9: 10, 10: 16, 11: 8, 12: 10, 13: 30, 14: 10, 15: 80, 16: 8, 17: 40, 18: 0, 19: 80, 20: 5, 21: 0, 22: 0, 23: 0, 24: 0, 25: 200, 26: 0, 27: 0 };
    // A firmware built without mouse keys doesn't list their settings (ids 9-17).
    if (cfg.noMouseKeys) for (let q = 9; q <= 17; q++) delete settings[q];
    const LIGHT_DEFAULTS = [[0, 0, 0], [255, 255, 255], [0, 90, 255], [0, 255, 60], [255, 0, 180], [255, 130, 0], [140, 0, 255], [0, 220, 220], [255, 210, 0], [255, 0, 0], [120, 255, 0], [0, 170, 255], [255, 80, 80], [90, 90, 255], [0, 255, 160], [255, 170, 110]];
    const mock = (window.__mock = {
        cfg, keymap, macroBuf, td, combos, ko, settings,
        unlocked: false, inProgress: !!cfg.startUnlocking, counter: 50, hold: cfg.autoHold,
        pressed: new Set(), log: [], blocked: 0,
        // live state reported to the overlay (firmware/overlay_report.c)
        layerState: 0, defaultLayerState: 1, mods: 0, capsLock: false, capsWord: false,
        // layer lights (firmware/layer_lights.c): what's set, what's saved, what the LED shows
        lights: { brightness: 48, colors: LIGHT_DEFAULTS.map((c) => [...c]), timeout: 0, speed: 128, effects: new Array(16).fill(0) },
        lightsSaved: { brightness: 48, colors: LIGHT_DEFAULTS.map((c) => [...c]), timeout: 0, speed: 128, effects: new Array(16).fill(0) },
        lightSets: 0, lightSaves: 0, lightPreview: null,
    });

    const le16 = (d, o) => d[o] | (d[o + 1] << 8);
    /** What the LED shows now: the highest layer that's on (or the one just set), scaled by the brightness. */
    mock.ledColor = () => {
        const all = (mock.layerState | mock.defaultLayerState) >>> 0;
        let layer = all ? 31 - Math.clz32(all) : 0;
        if (mock.lightPreview && Date.now() < mock.lightPreview.until) layer = mock.lightPreview.layer;
        const c = mock.lights.colors[layer] || [0, 0, 0];
        return c.map((v) => Math.floor((v * mock.lights.brightness + 127) / 255));
    };
    function handle(req) {
        const d = new Uint8Array(32);
        d.set(req.slice(0, 32));
        const cmd = d[0];
        mock.log.push(Array.from(d.slice(0, 6)));
        if (mock.inProgress) {
            const ok = cmd === 0xfe && [0x00, 0x01, 0x02, 0x05, 0x06, 0x07].includes(d[1]);
            if (!ok) {
                mock.blocked++;
                return d; // skip: echo
            }
        }
        switch (cmd) {
            case 0x01: d[1] = 0x00; d[2] = 0x09; return d;
            case 0x02:
                if (d[1] === 0x03) {
                    if (!mock.unlocked) return d;
                    for (let r = 0; r < ROWS; r++) {
                        let bits = 0;
                        for (let c = 0; c < COLS; c++) if (mock.pressed.has(`${r},${c}`)) bits |= 1 << c;
                        d[2 + r] = bits;
                    }
                    return d;
                }
                return d;
            case 0x05: {
                let kc = (d[4] << 8) | d[5];
                if (kc === 0x7c00 && !mock.unlocked) kc = 0; // vial_keycode_firewall
                keymap[d[1]][d[2] * COLS + d[3]] = kc;
                return d;
            }
            case 0x0c: d[1] = cfg.macros; return d;
            case 0x0d: d[1] = cfg.macroBuf >> 8; d[2] = cfg.macroBuf & 0xff; return d;
            case 0x0e: {
                const off = (d[1] << 8) | d[2], sz = d[3];
                if (sz <= 28) for (let i = 0; i < sz; i++) d[4 + i] = macroBuf[off + i] ?? 0;
                return d;
            }
            case 0x0f: {
                if (!mock.unlocked) return d; // skip
                const off = (d[1] << 8) | d[2], sz = d[3];
                for (let i = 0; i < sz; i++) if (off + i < macroBuf.length) macroBuf[off + i] = d[4 + i];
                return d;
            }
            case 0x11: d[1] = cfg.layers; return d;
            case 0x12: {
                const off = (d[1] << 8) | d[2], sz = d[3];
                for (let i = 0; i < sz; i++) {
                    const b = off + i, k = b >> 1, v = keymap[Math.floor(k / (ROWS * COLS))]?.[k % (ROWS * COLS)] ?? 0;
                    d[4 + i] = b & 1 ? v & 0xff : v >> 8;
                }
                return d;
            }
            case 0xfe: return vial(d);
            case 0xf0: return overlay(d);
            default: d[0] = 0xff; return d;
        }
    }
    // The overlay report of this project's firmware (firmware/overlay_report.c).
    function keymapByte(b) {
        const k = b >> 1, v = keymap[Math.floor(k / (ROWS * COLS))]?.[k % (ROWS * COLS)] ?? 0;
        return b & 1 ? v & 0xff : v >> 8;
    }
    function overlay(d) {
        if (cfg.noOverlay || d[1] !== 0x54 || d[2] !== 0x4b || d[3] !== 0x4f || d[4] !== 0x56) { d[0] = 0xff; return d; }
        const put32 = (o, v) => { d[o] = v & 0xff; d[o + 1] = (v >>> 8) & 0xff; d[o + 2] = (v >>> 16) & 0xff; d[o + 3] = (v >>> 24) & 0xff; };
        switch (d[5]) {
            case 1: {
                d.fill(0, 8);
                put32(8, mock.layerState); put32(12, mock.defaultLayerState);
                d[16] = mock.mods;
                let flags = (mock.capsLock ? 1 : 0) | (mock.capsWord ? 2 : 0);
                if (mock.unlocked) {
                    flags |= 4 | 8;
                    for (let r = 0; r < ROWS; r++) {
                        let bits = 0;
                        for (let c = 0; c < COLS; c++) if (mock.pressed.has(`${r},${c}`)) bits |= 1 << c;
                        d[18 + r] = bits;
                    }
                }
                d[17] = flags;
                break;
            }
            case 2: {
                d.fill(0, 8);
                d.set([cfg.layers, cfg.macros, ROWS, COLS, cfg.td, cfg.combos, cfg.ko, cfg.ar, 0b01], 8);
                d.set([0xcb, 0x37, 0x36, 0xfe, 0xee, 0xed, 0xee, 0x77], 17);
                put32(25, 6);
                break;
            }
            case 3: {
                const off = (d[8] << 8) | d[9], sz = Math.min(d[10], 20), total = cfg.layers * ROWS * COLS * 2;
                d[10] = sz;
                for (let i = 0; i < sz; i++) d[11 + i] = off + i < total ? keymapByte(off + i) : 0;
                break;
            }
            case 4: {
                const total = cfg.layers * ROWS * COLS * 2;
                let a = 0, b = 0;
                for (let i = 0; i < total; i++) { a = (a + keymapByte(i)) % 255; b = (b + a) % 255; }
                d.fill(0, 8);
                d.set([a, b, total >> 8, total & 0xff], 8);
                break;
            }
            case 5: case 6: case 7: case 8: case 9: {
                if (cfg.noLights) return d; // an older firmware: not handled
                const p = (i) => 8 + i;
                if (d[5] === 5) {
                    const first = d[p(0)];
                    d.fill(0, 8);
                    d[p(0)] = 16; d[p(1)] = mock.lights.brightness; d[p(2)] = first;
                    for (let i = 0; i < 7 && first + i < 16; i++) d.set(mock.lights.colors[first + i], p(3 + i * 3));
                } else if (d[5] === 6) {
                    const which = d[p(0)];
                    let ok = 1;
                    if (which === 0xff) mock.lights.brightness = d[p(1)];
                    else if (which < 16) {
                        mock.lights.colors[which] = [d[p(1)], d[p(2)], d[p(3)]];
                        mock.lightPreview = { layer: which, until: Date.now() + 2500 };
                    } else ok = 0;
                    d[p(4)] = ok;
                    d.fill(0, p(5));
                    mock.lightSets++;
                } else if (d[5] === 8) {
                    d.fill(0, 8);
                    d[p(0)] = mock.lights.timeout & 0xff; d[p(1)] = mock.lights.timeout >> 8; d[p(2)] = mock.lights.speed;
                    d.set(mock.lights.effects, p(3));
                } else if (d[5] === 9) {
                    let ok = 1;
                    if (d[p(0)] === 0) mock.lights.timeout = d[p(1)] | (d[p(2)] << 8);
                    else if (d[p(0)] === 1) mock.lights.speed = d[p(1)];
                    else if (d[p(0)] === 2 && d[p(1)] < 16 && d[p(2)] < 3) {
                        mock.lights.effects[d[p(1)]] = d[p(2)];
                        mock.lightPreview = { layer: d[p(1)], until: Date.now() + 2500 };
                    } else ok = 0;
                    d[p(4)] = ok;
                    d.fill(0, p(5));
                    mock.lightSets++;
                } else {
                    mock.lightsSaved = JSON.parse(JSON.stringify(mock.lights));
                    mock.lightSaves++;
                    d.fill(0, 8);
                    d[p(0)] = 1;
                }
                break;
            }
            default: return d; // not handled: status stays 0
        }
        mock.overlayRequests = (mock.overlayRequests || 0) + 1;
        d[7] = cfg.noLights ? 1 : 3;
        return d;
    }
    // Replies meant for another program that has the keyboard open too: the keyboard sends
    // every reply to everyone. "tagged" = an overlay running alongside; "untagged" = an editor.
    let foreignN = 0;
    function foreignReply() {
        const d = new Uint8Array(32);
        const n = foreignN++;
        if (cfg.crossTalk === "tagged") {
            d.set([n % 3 === 2 ? 0xff : 0xf0, 0x54, 0x4b, 0x4f, 0x56, 1 + (n % 4), 0xee, 1]);
            for (let i = 8; i < 32; i++) d[i] = (n * 13 + i) & 0xff;
        } else {
            const kinds = [[0x12, 0x04, 0x00, 28], [0x05, 2, 1, 1, 0x00, 0x2c], [0x06, 1, 0, 0, 0, 0, 0]];
            d.set(kinds[n % kinds.length]);
            for (let i = 8; i < 32; i++) d[i] = (n * 7 + i) & 0xff;
        }
        return d;
    }
    function vial(d) {
        const sub = d[1];
        switch (sub) {
            case 0x00: {
                d.fill(0);
                d.set([6, 0, 0, 0, 0xcb, 0x37, 0x36, 0xfe, 0xee, 0xed, 0xee, 0x77], 0);
                return d;
            }
            case 0x01: d.set([0xe8, 0x03, 0, 0], 0); return d;
            case 0x05: {
                d.fill(0xff);
                d[0] = mock.unlocked ? 1 : 0;
                d[1] = mock.inProgress ? 1 : 0;
                d.set([0, 0, 4, 0], 2);
                return d;
            }
            case 0x06: mock.inProgress = true; mock.counter = 50; return d;
            case 0x07: {
                if (mock.inProgress) {
                    if (mock.hold) {
                        mock.counter = Math.max(0, mock.counter - 10);
                        if (mock.counter === 0) { mock.inProgress = false; mock.unlocked = true; }
                    } else mock.counter = 50;
                }
                d[0] = mock.unlocked ? 1 : 0; d[1] = mock.inProgress ? 1 : 0; d[2] = mock.counter;
                return d;
            }
            case 0x08: mock.unlocked = false; return d;
            case 0x09: {
                const gt = le16(d, 2);
                d.fill(0xff);
                let o = 0;
                for (const q of Object.keys(settings).map(Number).sort((a, b) => a - b)) if (q > gt && o < 32) { d[o++] = q & 0xff; d[o++] = q >> 8; }
                return d;
            }
            case 0x0a: {
                const q = le16(d, 2);
                if (!(q in settings)) { d[0] = 0xff; return d; }
                d[0] = 0;
                let v = settings[q];
                for (let b = 0; b < widths[q]; b++) { d[1 + b] = v & 0xff; v = Math.floor(v / 256); }
                return d;
            }
            case 0x0b: {
                const q = le16(d, 2);
                let v = 0;
                for (let b = widths[q] - 1; b >= 0; b--) v = v * 256 + d[4 + b];
                settings[q] = v;
                d[0] = 0;
                return d;
            }
            case 0x0d: return dyn(d);
            default: return d;
        }
    }
    const fw = (kc) => (kc === 0x7c00 && !mock.unlocked ? 0 : kc);
    function dyn(d) {
        const op = d[2], i = d[3];
        const p = d.slice(4);
        const out = new Uint8Array(32);
        const put16 = (o, v) => { out[o] = v & 0xff; out[o + 1] = v >> 8; };
        switch (op) {
            case 0x00: out.set([cfg.td, cfg.combos, cfg.ko, cfg.ar]); out[31] = 0b01; return out;
            case 0x01: { const t = td[i]; if (!t) { out[0] = 1; return out; } t.forEach((v, j) => put16(1 + j * 2, v)); return out; }
            case 0x02: { td[i] = [fw(le16(p, 0)), fw(le16(p, 2)), fw(le16(p, 4)), fw(le16(p, 6)), le16(p, 8)]; return out; }
            case 0x03: { const c = combos[i]; if (!c) { out[0] = 1; return out; } c.forEach((v, j) => put16(1 + j * 2, v)); return out; }
            case 0x04: { combos[i] = [le16(p, 0), le16(p, 2), le16(p, 4), le16(p, 6), fw(le16(p, 8))]; return out; }
            case 0x05: { const k = ko[i]; if (!k) { out[0] = 1; return out; } put16(1, k.trigger); put16(3, k.replacement); put16(5, k.layers); out[7] = k.tm; out[8] = k.nm; out[9] = k.sm; out[10] = k.opt; return out; }
            case 0x06: { ko[i] = { trigger: le16(p, 0), replacement: fw(le16(p, 2)), layers: le16(p, 4), tm: p[6], nm: p[7], sm: p[8], opt: p[9] }; return out; }
            default: out[0] = 1; return out;
        }
    }

    class FakeDevice extends EventTarget {
        constructor() {
            super();
            this.opened = false;
            this.vendorId = 0x3a3c;
            this.productId = 0x0002;
            this.productName = cfg.productName;
            this.collections = [{ usagePage: 0xff60, usage: 0x61 }];
        }
        async open() { this.opened = true; }
        async close() { this.opened = false; }
        async sendReport(_id, data) {
            if (!this.opened) throw new Error("device not open");
            const bytes = new Uint8Array(data.buffer ? data.buffer.slice(data.byteOffset || 0, (data.byteOffset || 0) + data.byteLength) : data);
            if (bytes.length !== 32) throw new Error("reports must be 32 bytes, got " + bytes.length);
            const resp = handle(bytes);
            const deliver = (r) => {
                const ev = new Event("inputreport");
                Object.defineProperty(ev, "data", { value: new DataView(r.buffer) });
                Object.defineProperty(ev, "device", { value: this });
                Object.defineProperty(ev, "reportId", { value: 0 });
                this.dispatchEvent(ev);
            };
            if (cfg.crossTalk) {
                setTimeout(() => this.opened && deliver(foreignReply()), 1);
                mock.foreign = (mock.foreign || 0) + 1;
            }
            setTimeout(() => deliver(resp), 2);
        }
    }
    const device = new FakeDevice();
    mock.device = device;
    class FakeHID extends EventTarget {
        async getDevices() { return mock.permitted ? [device] : []; }
        async requestDevice() { mock.permitted = true; return [device]; }
    }
    const hid = new FakeHID();
    mock.unplug = () => {
        device.opened = false;
        const ev = new Event("disconnect");
        Object.defineProperty(ev, "device", { value: device });
        hid.dispatchEvent(ev);
    };
    Object.defineProperty(Navigator.prototype, "hid", { get: () => hid, configurable: true });
})();

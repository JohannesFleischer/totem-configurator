// WebHID transport: one 32-byte request, one 32-byte reply, strictly in order.
//
// The keyboard sends every reply to every program that has it open, so the editor and
// the desktop overlay see each other's replies. The overlay's requests and replies are
// tagged ("TKOV", see overlay-protocol.ts); everyone else's are not. A request only
// takes a reply that fits it: untagged requests skip tagged replies (and VIA replies
// must echo the command), tagged ones take only their own.

export const REPORT_LEN = 32;
// Raw HID interface used by VIA and Vial.
export const VIAL_FILTERS: HIDDeviceFilter[] = [{ usagePage: 0xff60, usage: 0x61 }];

/** A reply to the overlay's tagged command (from this or another program). */
export function isTagged(d: Uint8Array): boolean {
    return (d[0] === 0xf0 || d[0] === 0xff) && d[1] === 0x54 && d[2] === 0x4b && d[3] === 0x4f && d[4] === 0x56;
}

/** Does `d` look like the reply to the untagged request `req`? */
function fitsUntagged(req: Uint8Array, d: Uint8Array): boolean {
    if (isTagged(d)) return false;
    const cmd = req[0];
    // VIA commands echo their id (0xFF: not supported); buffer reads also echo offset and size
    if (cmd >= 0x01 && cmd <= 0x13) {
        if (d[0] !== cmd && d[0] !== 0xff) return false;
        if (d[0] === cmd && (cmd === 0x12 || cmd === 0x0e) && (d[1] !== req[1] || d[2] !== req[2] || d[3] !== req[3])) return false;
        if (d[0] === cmd && cmd === 0x02 && d[1] !== req[1]) return false; // which value
    }
    return true; // Vial (0xFE) replies overwrite the buffer: nothing to compare
}

export class HidTransport {
    device: HIDDevice | null = null;
    onDisconnect: (() => void) | null = null;
    private queue: Promise<unknown> = Promise.resolve();
    private waiting: ((data: Uint8Array) => boolean) | null = null;

    static supported(): boolean {
        return typeof navigator !== "undefined" && "hid" in navigator;
    }

    /** Ask the user to pick a keyboard. Returns false if they cancelled. */
    async connect(): Promise<boolean> {
        const devices = await navigator.hid.requestDevice({ filters: VIAL_FILTERS });
        const dev = devices.find((d) => d.collections.some((c) => c.usagePage === 0xff60 && c.usage === 0x61)) ?? devices[0];
        if (!dev) return false;
        await this.attach(dev);
        return true;
    }

    /** Reconnect to an already-permitted device without a prompt (after a page reload). */
    async reconnect(): Promise<boolean> {
        const devices = await navigator.hid.getDevices();
        const dev = devices.find((d) => d.collections.some((c) => c.usagePage === 0xff60 && c.usage === 0x61));
        if (!dev) return false;
        await this.attach(dev);
        return true;
    }

    private async attach(dev: HIDDevice) {
        if (!dev.opened) await dev.open();
        this.device = dev;
        dev.addEventListener("inputreport", this.onReport);
        navigator.hid.addEventListener("disconnect", this.onHidDisconnect);
    }

    async close() {
        const dev = this.device;
        this.device = null;
        navigator.hid.removeEventListener("disconnect", this.onHidDisconnect);
        if (dev) {
            dev.removeEventListener("inputreport", this.onReport);
            try {
                await dev.close();
            } catch {
                /* already gone */
            }
        }
    }

    get productName(): string {
        return this.device?.productName ?? "";
    }

    private onReport = (ev: HIDInputReportEvent) => {
        const data = new Uint8Array(ev.data.buffer.slice(ev.data.byteOffset, ev.data.byteOffset + ev.data.byteLength));
        // a reply that doesn't fit the request is someone else's (or a late one): drop it
        if (this.waiting?.(data)) this.waiting = null;
    };

    private onHidDisconnect = (ev: HIDConnectionEvent) => {
        if (ev.device === this.device) {
            this.close();
            this.onDisconnect?.();
        }
    };

    /**
     * Send `bytes` (padded to 32) and resolve with the reply. Requests are serialized;
     * a request that gets no reply is sent again up to `retries` times.
     */
    request(bytes: ArrayLike<number>, opts: { timeout?: number; retries?: number; accept?: (reply: Uint8Array) => boolean } = {}): Promise<Uint8Array> {
        const run = () => this.send(bytes, opts.timeout ?? 600, opts.retries ?? 3, opts.accept);
        const p = this.queue.then(run, run);
        this.queue = p.catch(() => undefined);
        return p;
    }

    private async send(bytes: ArrayLike<number>, timeout: number, retries: number, accept?: (reply: Uint8Array) => boolean): Promise<Uint8Array> {
        if (bytes.length > REPORT_LEN) throw new Error("HID request too long");
        const msg = new Uint8Array(REPORT_LEN);
        msg.set(Array.from(bytes));
        const fits = accept ?? ((d: Uint8Array) => fitsUntagged(msg, d));
        for (let attempt = 0; ; attempt++) {
            const dev = this.device;
            if (!dev) throw new Error("Keyboard not connected");
            const reply = new Promise<Uint8Array | null>((resolve) => {
                const timer = setTimeout(() => {
                    this.waiting = null;
                    resolve(null);
                }, timeout);
                this.waiting = (d) => {
                    if (!fits(d)) return false;
                    clearTimeout(timer);
                    resolve(d);
                    return true;
                };
            });
            await dev.sendReport(0, msg);
            const data = await reply;
            if (data) return data;
            if (attempt >= retries) throw new Error(`Keyboard did not answer (command 0x${msg[0].toString(16)})`);
            // Let a late reply to this attempt arrive and be dropped before trying again.
            await new Promise((r) => setTimeout(r, 50));
        }
    }
}

// Minimal WebHID typings (only what this app uses).
interface HIDDeviceFilter {
    vendorId?: number;
    productId?: number;
    usagePage?: number;
    usage?: number;
}
interface HIDCollectionInfo {
    usagePage: number;
    usage: number;
}
interface HIDInputReportEvent extends Event {
    readonly device: HIDDevice;
    readonly reportId: number;
    readonly data: DataView;
}
interface HIDConnectionEvent extends Event {
    readonly device: HIDDevice;
}
interface HIDDevice extends EventTarget {
    readonly opened: boolean;
    readonly vendorId: number;
    readonly productId: number;
    readonly productName: string;
    readonly collections: HIDCollectionInfo[];
    open(): Promise<void>;
    close(): Promise<void>;
    sendReport(reportId: number, data: BufferSource): Promise<void>;
    addEventListener(type: "inputreport", listener: (ev: HIDInputReportEvent) => void): void;
    removeEventListener(type: "inputreport", listener: (ev: HIDInputReportEvent) => void): void;
}
interface HID extends EventTarget {
    getDevices(): Promise<HIDDevice[]>;
    requestDevice(options: { filters: HIDDeviceFilter[] }): Promise<HIDDevice[]>;
    addEventListener(type: "connect" | "disconnect", listener: (ev: HIDConnectionEvent) => void): void;
    removeEventListener(type: "connect" | "disconnect", listener: (ev: HIDConnectionEvent) => void): void;
}
interface Navigator {
    readonly hid: HID;
}

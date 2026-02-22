import { getAdb } from "./connection.js";
import { logInfo } from "../logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type DeviceInfo = {
    serial: string;
    model: string;
    manufacturer: string;
    androidVersion: string;
    sdkVersion: number;
    screenWidth: number;
    screenHeight: number;
    density: number;
    batteryLevel: number;
    batteryCharging: boolean;
    totalStorageMB: number;
    freeStorageMB: number;
    currentApp: string;
    locale: string;
    timezone: string;
    wifiConnected: boolean;
    ipAddress: string;
};

// ─── Collectors ──────────────────────────────────────────────────────────────

async function getProp(key: string): Promise<string> {
    const adb = getAdb();
    const result = await adb.shell(`getprop ${key}`);
    return result.stdout.trim();
}

async function getScreenSize(): Promise<{ width: number; height: number }> {
    const adb = getAdb();
    const result = await adb.shell("wm size");
    const match = result.stdout.match(/(\d+)x(\d+)/);
    if (!match) return { width: 1080, height: 2400 }; // fallback
    return { width: Number(match[1]), height: Number(match[2]) };
}

async function getDensity(): Promise<number> {
    const adb = getAdb();
    const result = await adb.shell("wm density");
    const match = result.stdout.match(/(\d+)/);
    return match ? Number(match[1]) : 420;
}

async function getBatteryInfo(): Promise<{ level: number; charging: boolean }> {
    const adb = getAdb();
    const result = await adb.shell("dumpsys battery");
    const levelMatch = result.stdout.match(/level:\s*(\d+)/);
    const statusMatch = result.stdout.match(/status:\s*(\d+)/);
    const level = levelMatch ? Number(levelMatch[1]) : -1;
    // Status: 2 = charging, 5 = full
    const charging = statusMatch ? [2, 5].includes(Number(statusMatch[1])) : false;
    return { level, charging };
}

async function getStorageInfo(): Promise<{ totalMB: number; freeMB: number }> {
    const adb = getAdb();
    const result = await adb.shell("df /data | tail -1");
    const parts = result.stdout.trim().split(/\s+/);
    // df output: Filesystem  1K-blocks  Used  Available  Use%  Mounted
    if (parts.length >= 4) {
        const totalKB = Number(parts[1]) || 0;
        const freeKB = Number(parts[3]) || 0;
        return {
            totalMB: Math.round(totalKB / 1024),
            freeMB: Math.round(freeKB / 1024),
        };
    }
    return { totalMB: 0, freeMB: 0 };
}

async function getCurrentApp(): Promise<string> {
    const adb = getAdb();
    // Try multiple methods for compatibility across Android versions
    const result = await adb.shell(
        "dumpsys activity activities 2>/dev/null | grep -E 'mResumedActivity|topResumedActivity' | head -1",
    );
    const match = result.stdout.match(/(?:u0|{)\s*([a-zA-Z0-9_.]+\/[a-zA-Z0-9_.]+)/);
    if (match) return match[1]!;

    // Fallback: dumpsys window
    const result2 = await adb.shell(
        "dumpsys window windows 2>/dev/null | grep -E 'mCurrentFocus|mFocusedApp' | head -1",
    );
    const match2 = result2.stdout.match(/([a-zA-Z0-9_.]+\/[a-zA-Z0-9_.]+)/);
    return match2?.[1] ?? "unknown";
}

async function getWifiInfo(): Promise<{ connected: boolean; ip: string }> {
    const adb = getAdb();
    const result = await adb.shell("ip addr show wlan0 2>/dev/null | grep 'inet '");
    const match = result.stdout.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
    return {
        connected: !!match,
        ip: match?.[1] ?? "0.0.0.0",
    };
}

// ─── Main ────────────────────────────────────────────────────────────────────

/**
 * Collect comprehensive device information.
 * Used to build the system prompt so the AI knows what phone it's controlling.
 */
export async function getDeviceInfo(): Promise<DeviceInfo> {
    const adb = getAdb();
    const serial = adb.getSerial() ?? "unknown";

    logInfo("Collecting device info...");

    // Run all collectors in parallel for speed
    const [
        model,
        manufacturer,
        androidVersion,
        sdkVersionStr,
        screen,
        density,
        battery,
        storage,
        currentApp,
        locale,
        timezone,
        wifi,
    ] = await Promise.all([
        getProp("ro.product.model"),
        getProp("ro.product.manufacturer"),
        getProp("ro.build.version.release"),
        getProp("ro.build.version.sdk"),
        getScreenSize(),
        getDensity(),
        getBatteryInfo(),
        getStorageInfo(),
        getCurrentApp(),
        getProp("persist.sys.locale").then((v) => v || getProp("ro.product.locale")),
        getProp("persist.sys.timezone"),
        getWifiInfo(),
    ]);

    const info: DeviceInfo = {
        serial,
        model: model || "Unknown",
        manufacturer: manufacturer || "Unknown",
        androidVersion: androidVersion || "Unknown",
        sdkVersion: Number(sdkVersionStr) || 0,
        screenWidth: screen.width,
        screenHeight: screen.height,
        density,
        batteryLevel: battery.level,
        batteryCharging: battery.charging,
        totalStorageMB: storage.totalMB,
        freeStorageMB: storage.freeMB,
        currentApp,
        locale: locale || "en-US",
        timezone: timezone || "UTC",
        wifiConnected: wifi.connected,
        ipAddress: wifi.ip,
    };

    logInfo(
        `Device: ${info.manufacturer} ${info.model} (Android ${info.androidVersion}), ` +
        `Screen: ${info.screenWidth}x${info.screenHeight}, Battery: ${info.batteryLevel}%`,
    );

    return info;
}

/**
 * Format device info as a human-readable string for the system prompt.
 */
export function formatDeviceInfo(info: DeviceInfo): string {
    return [
        `Device: ${info.manufacturer} ${info.model}`,
        `OS: Android ${info.androidVersion} (SDK ${info.sdkVersion}) — Linux-based`,
        `Screen: ${info.screenWidth}x${info.screenHeight} (${info.density}dpi)`,
        `Battery: ${info.batteryLevel}%${info.batteryCharging ? " (charging)" : ""}`,
        `Storage: ${info.freeStorageMB}MB free / ${info.totalStorageMB}MB total`,
        `Current App: ${info.currentApp}`,
        `WiFi: ${info.wifiConnected ? `connected (${info.ipAddress})` : "disconnected"}`,
        `Locale: ${info.locale} | Timezone: ${info.timezone}`,
    ].join("\n");
}

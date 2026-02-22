import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logDebug, logInfo } from "../logger.js";

const execFileAsync = promisify(execFile);

// ─── Types ───────────────────────────────────────────────────────────────────

export type AdbDevice = {
    serial: string;
    state: "device" | "offline" | "unauthorized" | "no permissions" | string;
    model?: string;
    transport?: string;
};

export type AdbExecResult = {
    stdout: string;
    stderr: string;
    exitCode: number | null;
};

export type AdbConnectionOptions = {
    serial?: string;
    adbPath?: string;
    defaultTimeoutMs?: number;
};

// ─── Errors ──────────────────────────────────────────────────────────────────

export class AdbError extends Error {
    constructor(
        message: string,
        public readonly command: string,
        public readonly stderr?: string,
        public readonly exitCode?: number | null,
    ) {
        super(message);
        this.name = "AdbError";
    }
}

export class AdbDeviceNotFoundError extends AdbError {
    constructor(serial?: string) {
        super(
            serial
                ? `Device "${serial}" not found. Run "adb devices" to check connected devices.`
                : "No ADB device connected. Connect a device via USB and enable USB Debugging.",
            "adb devices",
        );
        this.name = "AdbDeviceNotFoundError";
    }
}

export class AdbUnauthorizedError extends AdbError {
    constructor(serial: string) {
        super(
            `Device "${serial}" is unauthorized. Accept the USB debugging prompt on the phone.`,
            "adb devices",
        );
        this.name = "AdbUnauthorizedError";
    }
}

// ─── Connection ──────────────────────────────────────────────────────────────

export class AdbConnection {
    private serial: string | null = null;
    private readonly adbPath: string;
    private readonly defaultTimeoutMs: number;

    constructor(options: AdbConnectionOptions = {}) {
        this.serial = options.serial?.trim() || null;
        this.adbPath = options.adbPath?.trim() || "adb";
        this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
    }

    // ── Device Management ────────────────────────────────────────────────────

    /** List all connected ADB devices. */
    async listDevices(): Promise<AdbDevice[]> {
        const { stdout } = await this.rawExec(["devices", "-l"], 10_000);
        const lines = stdout.split("\n").slice(1); // skip header
        const devices: AdbDevice[] = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === "") continue;

            const parts = trimmed.split(/\s+/);
            if (parts.length < 2) continue;

            const serial = parts[0]!;
            const state = parts[1]!;
            const model = parts
                .find((p) => p.startsWith("model:"))
                ?.slice("model:".length);

            devices.push({ serial, state, model });
        }

        return devices;
    }

    /** Select and validate a device. Auto-detects if no serial provided. */
    async connect(): Promise<AdbDevice> {
        const devices = await this.listDevices();

        if (devices.length === 0) {
            throw new AdbDeviceNotFoundError(this.serial ?? undefined);
        }

        let target: AdbDevice | undefined;

        if (this.serial) {
            target = devices.find((d) => d.serial === this.serial);
            if (!target) {
                throw new AdbDeviceNotFoundError(this.serial);
            }
        } else {
            // Auto-detect: prefer USB devices, pick first available
            const usbDevices = devices.filter(
                (d) => d.state === "device" && !d.serial.includes(":"),
            );
            const tcpDevices = devices.filter(
                (d) => d.state === "device" && d.serial.includes(":"),
            );
            target = usbDevices[0] ?? tcpDevices[0] ?? devices[0];
        }

        if (!target) {
            throw new AdbDeviceNotFoundError();
        }

        if (target.state === "unauthorized") {
            throw new AdbUnauthorizedError(target.serial);
        }

        if (target.state === "offline") {
            throw new AdbError(
                `Device "${target.serial}" is offline. Reconnect the USB cable.`,
                "adb devices",
            );
        }

        if (target.state !== "device") {
            throw new AdbError(
                `Device "${target.serial}" is in unexpected state: ${target.state}`,
                "adb devices",
            );
        }

        this.serial = target.serial;
        logInfo(`ADB connected to device: ${target.serial} (${target.model ?? "unknown model"})`);
        return target;
    }

    /** Get the currently selected device serial. */
    getSerial(): string | null {
        return this.serial;
    }

    // ── Shell Execution ──────────────────────────────────────────────────────

    /**
     * Execute a shell command on the device.
     * Equivalent to `adb -s <serial> shell <command>`.
     */
    async shell(
        command: string,
        options: { timeoutMs?: number; maxBuffer?: number } = {},
    ): Promise<AdbExecResult> {
        this.ensureConnected();
        const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
        const maxBuffer = options.maxBuffer ?? 10 * 1024 * 1024; // 10MB

        const args = ["-s", this.serial!, "shell", command];
        logDebug(`adb shell: ${command}`);

        try {
            const { stdout, stderr } = await execFileAsync(this.adbPath, args, {
                timeout: timeoutMs,
                maxBuffer,
                encoding: "utf-8",
            });
            return { stdout, stderr, exitCode: 0 };
        } catch (err: unknown) {
            if (isExecError(err)) {
                // Shell command failed but ADB itself succeeded
                if (err.stdout !== undefined || err.stderr !== undefined) {
                    return {
                        stdout: err.stdout?.toString() ?? "",
                        stderr: err.stderr?.toString() ?? "",
                        exitCode: err.code ?? 1,
                    };
                }
            }
            const message = err instanceof Error ? err.message : String(err);
            throw new AdbError(`Shell command failed: ${message}`, command);
        }
    }

    /**
     * Execute a raw shell command and return stdout only.
     * Throws on non-zero exit code.
     */
    async shellStrict(command: string, timeoutMs?: number): Promise<string> {
        const result = await this.shell(command, { timeoutMs });
        if (result.exitCode !== 0) {
            throw new AdbError(
                `Command failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
                command,
                result.stderr,
                result.exitCode,
            );
        }
        return result.stdout;
    }

    // ── Screen Capture ───────────────────────────────────────────────────────

    /**
     * Capture the device screen as PNG bytes.
     * Uses `adb exec-out screencap -p` for binary-safe transfer.
     */
    async screencap(): Promise<Buffer> {
        this.ensureConnected();
        const args = ["-s", this.serial!, "exec-out", "screencap", "-p"];
        logDebug("adb screencap");

        try {
            const { stdout } = await execFileAsync(this.adbPath, args, {
                timeout: 15_000,
                maxBuffer: 50 * 1024 * 1024, // 50MB for high-res screens
                encoding: "buffer" as any,
            });
            const buf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
            if (buf.length < 100) {
                throw new AdbError("Screenshot returned empty or invalid data", "screencap");
            }
            return buf;
        } catch (err) {
            if (err instanceof AdbError) throw err;
            const message = err instanceof Error ? err.message : String(err);
            throw new AdbError(`Screenshot failed: ${message}`, "screencap");
        }
    }

    // ── Input Events ─────────────────────────────────────────────────────────

    async tap(x: number, y: number): Promise<void> {
        await this.shell(`input tap ${Math.round(x)} ${Math.round(y)}`);
        logDebug(`tap: (${x}, ${y})`);
    }

    async swipe(
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        durationMs: number = 300,
    ): Promise<void> {
        await this.shell(
            `input swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(x2)} ${Math.round(y2)} ${durationMs}`,
        );
        logDebug(`swipe: (${x1},${y1}) → (${x2},${y2}) in ${durationMs}ms`);
    }

    async type(text: string): Promise<void> {
        // ADB input text needs special escaping:
        // Spaces → %s, special chars need quoting
        const escaped = text
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/ /g, "%s")
            .replace(/'/g, "\\'")
            .replace(/&/g, "\\&")
            .replace(/</g, "\\<")
            .replace(/>/g, "\\>")
            .replace(/\|/g, "\\|")
            .replace(/;/g, "\\;")
            .replace(/\(/g, "\\(")
            .replace(/\)/g, "\\)")
            .replace(/\$/g, "\\$");
        await this.shell(`input text "${escaped}"`);
        logDebug(`type: "${text}"`);
    }

    async keyevent(keycode: number | string): Promise<void> {
        await this.shell(`input keyevent ${keycode}`);
        logDebug(`keyevent: ${keycode}`);
    }

    // Convenience key methods
    async pressBack(): Promise<void> { await this.keyevent(4); }
    async pressHome(): Promise<void> { await this.keyevent(3); }
    async pressEnter(): Promise<void> { await this.keyevent(66); }
    async pressRecent(): Promise<void> { await this.keyevent(187); }
    async pressPower(): Promise<void> { await this.keyevent(26); }
    async pressVolumeUp(): Promise<void> { await this.keyevent(24); }
    async pressVolumeDown(): Promise<void> { await this.keyevent(25); }

    // ── File Operations ──────────────────────────────────────────────────────

    async push(localPath: string, remotePath: string): Promise<void> {
        this.ensureConnected();
        await this.rawExec(["-s", this.serial!, "push", localPath, remotePath]);
        logDebug(`push: ${localPath} → ${remotePath}`);
    }

    async pull(remotePath: string, localPath: string): Promise<void> {
        this.ensureConnected();
        await this.rawExec(["-s", this.serial!, "pull", remotePath, localPath]);
        logDebug(`pull: ${remotePath} → ${localPath}`);
    }

    // ── App Management ───────────────────────────────────────────────────────

    async launchApp(packageName: string): Promise<string> {
        const result = await this.shell(
            `monkey -p ${packageName} -c android.intent.category.LAUNCHER 1 2>&1`,
        );
        logInfo(`Launched app: ${packageName}`);
        return result.stdout;
    }

    async stopApp(packageName: string): Promise<void> {
        await this.shell(`am force-stop ${packageName}`);
        logInfo(`Stopped app: ${packageName}`);
    }

    async listPackages(thirdPartyOnly: boolean = true): Promise<string[]> {
        const flag = thirdPartyOnly ? "-3" : "";
        const result = await this.shell(`pm list packages ${flag}`.trim());
        return result.stdout
            .split("\n")
            .map((line) => line.replace("package:", "").trim())
            .filter(Boolean);
    }

    async isInstalled(packageName: string): Promise<boolean> {
        const result = await this.shell(`pm path ${packageName}`);
        return result.stdout.includes("package:");
    }

    // ── Utilities ────────────────────────────────────────────────────────────

    async getCurrentActivity(): Promise<string> {
        // Works on Android 10+
        const result = await this.shell(
            "dumpsys activity activities | grep -E 'mResumedActivity|mCurrentFocus' | head -1",
        );
        return result.stdout.trim();
    }

    async isScreenOn(): Promise<boolean> {
        const result = await this.shell("dumpsys power | grep 'Display Power'");
        return result.stdout.includes("state=ON");
    }

    async wakeScreen(): Promise<void> {
        const on = await this.isScreenOn();
        if (!on) {
            await this.keyevent(26); // POWER
            await this.sleep(500);
            await this.swipe(540, 2000, 540, 800, 300); // swipe up to unlock
        }
    }

    /** Wait for the UI to settle after an action. */
    async waitForIdle(timeoutMs: number = 5000): Promise<void> {
        await this.shell(
            `uiautomator wait-for-idle ${timeoutMs}`,
            { timeoutMs: timeoutMs + 2000 },
        );
    }

    /** Sleep for the specified milliseconds (client-side wait). */
    sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    private ensureConnected(): void {
        if (!this.serial) {
            throw new AdbError(
                "Not connected to any device. Call connect() first.",
                "",
            );
        }
    }

    private async rawExec(
        args: string[],
        timeoutMs?: number,
    ): Promise<{ stdout: string; stderr: string }> {
        try {
            const { stdout, stderr } = await execFileAsync(this.adbPath, args, {
                timeout: timeoutMs ?? this.defaultTimeoutMs,
                encoding: "utf-8",
            });
            return { stdout, stderr };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new AdbError(
                `ADB command failed: ${message}`,
                `adb ${args.join(" ")}`,
            );
        }
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function isExecError(
    err: unknown,
): err is Error & { stdout?: string | Buffer; stderr?: string | Buffer; code?: number } {
    return err instanceof Error && ("stdout" in err || "stderr" in err);
}

// ── Singleton ──────────────────────────────────────────────────────────────

let _instance: AdbConnection | null = null;

export function getAdb(): AdbConnection {
    if (!_instance) {
        _instance = new AdbConnection({
            serial: process.env.ADB_DEVICE_SERIAL?.trim() || undefined,
        });
    }
    return _instance;
}

export function resetAdb(): void {
    _instance = null;
}

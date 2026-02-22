/**
 * Self-Healing — automatic recovery from ADB disconnects, app crashes,
 * and transient failures during autonomous task execution.
 *
 * Features:
 *  - ADB heartbeat: periodic ping to verify device is reachable
 *  - Auto-reconnect: kill-server + restart + re-detect device
 *  - Retry wrapper: exponential backoff for transient failures
 *  - Task recovery: detect ADB errors and heal before retrying
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getAdb } from "../adb/connection.js";
import { logDebug, logError, logInfo, logWarn } from "../logger.js";

const execFileAsync = promisify(execFile);

// ─── Types ───────────────────────────────────────────────────────────────────

export type HealthStatus = {
    adbOk: boolean;
    deviceReachable: boolean;
    screenOn: boolean;
    lastCheckAt: number;
    error?: string;
};

export type RetryOptions = {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    /** If true, attempt ADB reconnection between retries. */
    healOnFailure?: boolean;
    /** Only retry on these error types. Default: retry all. */
    retryableErrors?: string[];
};

// ─── Config ──────────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 60_000;     // 1 minute
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 2_000;      // 2 seconds
const DEFAULT_MAX_DELAY_MS = 30_000;      // 30 seconds
const ADB_PATH = process.env.ADB_PATH ?? "adb";

// ─── Self-Healer ─────────────────────────────────────────────────────────────

export class SelfHealer {
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private lastHealth: HealthStatus | null = null;
    private onDisconnect: (() => void) | null = null;
    private onReconnect: (() => void) | null = null;
    private consecutiveFailures = 0;

    /** Set callbacks for disconnect/reconnect events. */
    setCallbacks(options: {
        onDisconnect?: () => void;
        onReconnect?: () => void;
    }): void {
        this.onDisconnect = options.onDisconnect ?? null;
        this.onReconnect = options.onReconnect ?? null;
    }

    /** Get the last known health status. */
    getLastHealth(): HealthStatus | null {
        return this.lastHealth;
    }

    // ── Health Check ─────────────────────────────────────────────────────────

    async checkHealth(): Promise<HealthStatus> {
        const status: HealthStatus = {
            adbOk: false,
            deviceReachable: false,
            screenOn: false,
            lastCheckAt: Date.now(),
        };

        try {
            // 1. Check ADB server responds
            const adb = getAdb();
            const result = await adb.shell("echo __heartbeat_ok__", { timeoutMs: 5_000 });
            status.adbOk = true;
            status.deviceReachable = result.stdout.includes("__heartbeat_ok__");

            if (status.deviceReachable) {
                // 2. Check screen state
                try {
                    const screenResult = await adb.shell(
                        "dumpsys power | grep 'Display Power'",
                        { timeoutMs: 3_000 },
                    );
                    status.screenOn = screenResult.stdout.includes("state=ON");
                } catch {
                    // Non-critical — screen state check can fail
                }
            }
        } catch (err) {
            status.error = err instanceof Error ? err.message : String(err);
        }

        this.lastHealth = status;
        return status;
    }

    // ── ADB Reconnection ─────────────────────────────────────────────────────

    async reconnectAdb(): Promise<boolean> {
        logWarn("Attempting ADB reconnection...");

        // Step 1: Try simple reconnect
        try {
            await execFileAsync(ADB_PATH, ["reconnect"], {
                timeout: 10_000,
                encoding: "utf-8",
            });
            await sleep(3_000);

            const health = await this.checkHealth();
            if (health.deviceReachable) {
                logInfo("✅ ADB reconnected via 'adb reconnect'");
                return true;
            }
        } catch (err) {
            logDebug(`Simple reconnect failed: ${err instanceof Error ? err.message : err}`);
        }

        // Step 2: Kill and restart ADB server
        try {
            logWarn("Killing ADB server...");
            await execFileAsync(ADB_PATH, ["kill-server"], {
                timeout: 10_000,
                encoding: "utf-8",
            });
            await sleep(2_000);

            logInfo("Starting ADB server...");
            await execFileAsync(ADB_PATH, ["start-server"], {
                timeout: 15_000,
                encoding: "utf-8",
            });
            await sleep(5_000);

            // Re-detect device
            const adb = getAdb();
            await adb.connect();

            const health = await this.checkHealth();
            if (health.deviceReachable) {
                logInfo("✅ ADB reconnected via kill-server + start-server");
                return true;
            }
        } catch (err) {
            logError(`ADB restart failed: ${err instanceof Error ? err.message : err}`);
        }

        // Step 3: Last resort — wait and retry
        logWarn("ADB reconnection failed. Waiting 10 seconds before final attempt...");
        await sleep(10_000);

        try {
            const adb = getAdb();
            await adb.connect();
            const health = await this.checkHealth();
            if (health.deviceReachable) {
                logInfo("✅ ADB reconnected after wait");
                return true;
            }
        } catch {
            // Give up
        }

        logError("❌ ADB reconnection failed after all attempts");
        return false;
    }

    // ── Heartbeat ────────────────────────────────────────────────────────────

    startHeartbeat(): void {
        if (this.heartbeatTimer) return;
        logInfo(`Self-healing heartbeat started (interval: ${HEARTBEAT_INTERVAL_MS / 1000}s)`);

        this.heartbeatTimer = setInterval(() => {
            this.heartbeatTick().catch((err) =>
                logError(`Heartbeat error: ${err instanceof Error ? err.message : err}`),
            );
        }, HEARTBEAT_INTERVAL_MS);
    }

    stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
            logInfo("Self-healing heartbeat stopped");
        }
    }

    private async heartbeatTick(): Promise<void> {
        const health = await this.checkHealth();

        if (health.deviceReachable) {
            if (this.consecutiveFailures > 0) {
                logInfo("🩹 Device reconnected after failure");
                this.onReconnect?.();
            }
            this.consecutiveFailures = 0;
            return;
        }

        this.consecutiveFailures++;
        logWarn(`Heartbeat failed (${this.consecutiveFailures} consecutive failures)`);

        if (this.consecutiveFailures === 1) {
            this.onDisconnect?.();
        }

        // Try to heal after 2 consecutive failures
        if (this.consecutiveFailures >= 2) {
            const reconnected = await this.reconnectAdb();
            if (reconnected) {
                this.consecutiveFailures = 0;
                this.onReconnect?.();
            }
        }
    }

    // ── Retry Wrapper ────────────────────────────────────────────────────────

    /**
     * Execute a function with automatic retries and optional ADB healing.
     */
    async withRetry<T>(
        fn: () => Promise<T>,
        options: RetryOptions = {},
    ): Promise<T> {
        const {
            maxRetries = DEFAULT_MAX_RETRIES,
            baseDelayMs = DEFAULT_BASE_DELAY_MS,
            maxDelayMs = DEFAULT_MAX_DELAY_MS,
            healOnFailure = true,
            retryableErrors,
        } = options;

        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));

                // Check if this error is retryable
                if (retryableErrors && retryableErrors.length > 0) {
                    const isRetryable = retryableErrors.some(
                        (e) => lastError!.message.includes(e) || lastError!.name.includes(e),
                    );
                    if (!isRetryable) throw lastError;
                }

                if (attempt >= maxRetries) break;

                const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
                logWarn(
                    `Retry ${attempt + 1}/${maxRetries} after ${delay}ms: ${lastError.message.slice(0, 200)}`,
                );

                // Try to heal ADB before retrying
                if (healOnFailure && isAdbError(lastError)) {
                    logInfo("Detected ADB error — attempting recovery before retry...");
                    await this.reconnectAdb();
                }

                await sleep(delay);
            }
        }

        throw lastError ?? new Error("withRetry exhausted all attempts");
    }

    /**
     * High-level wrapper for task execution with recovery:
     * - If ADB error → reconnect ADB → retry
     * - If app crash → restart app → retry
     */
    async withRecovery<T>(
        fn: () => Promise<T>,
        context?: { appPackage?: string },
    ): Promise<T> {
        return this.withRetry(async () => {
            try {
                return await fn();
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));

                // Handle app crash — restart the app before the retry wrapper retries
                if (context?.appPackage && isAppCrash(error)) {
                    logWarn(`App crash detected for ${context.appPackage} — restarting...`);
                    try {
                        const adb = getAdb();
                        await adb.shell(`am force-stop ${context.appPackage}`);
                        await sleep(1_000);
                        await adb.launchApp(context.appPackage);
                        await sleep(2_000);
                    } catch (restartErr) {
                        logError(`App restart failed: ${restartErr instanceof Error ? restartErr.message : restartErr}`);
                    }
                }

                throw error;
            }
        }, {
            maxRetries: 2,
            healOnFailure: true,
            baseDelayMs: 3_000,
        });
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAdbError(err: Error): boolean {
    const msg = err.message.toLowerCase();
    return (
        err.name === "AdbError" ||
        err.name === "AdbDeviceNotFoundError" ||
        msg.includes("adb") ||
        msg.includes("device not found") ||
        msg.includes("no devices") ||
        msg.includes("cannot connect") ||
        msg.includes("connection refused") ||
        msg.includes("transport") ||
        msg.includes("offline")
    );
}

function isAppCrash(err: Error): boolean {
    const msg = err.message.toLowerCase();
    return (
        msg.includes("crash") ||
        msg.includes("has stopped") ||
        msg.includes("not responding") ||
        msg.includes("anr")
    );
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _healer: SelfHealer | null = null;

export function getSelfHealer(): SelfHealer {
    if (!_healer) _healer = new SelfHealer();
    return _healer;
}

export function resetSelfHealer(): void {
    _healer?.stopHeartbeat();
    _healer = null;
}

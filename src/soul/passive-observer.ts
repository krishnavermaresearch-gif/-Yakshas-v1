/**
 * Passive Observer — silently records the user's phone behavior.
 *
 * Captures:
 *  - Periodic screenshots (configurable interval)
 *  - Current foreground app + activity
 *  - Screen state (on/off)
 *  - Notification counts
 *
 * This is the "eyes" of the Digital Soul — it sees everything
 * the user does on their phone without interfering.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { resolve } from "path";
import { execSync } from "child_process";
import { logInfo, logDebug } from "../logger.js";
import { getSoulDB } from "./soul-db.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ObservationFrame {
    timestamp: number;
    /** Foreground app package name */
    appPackage: string;
    /** Activity name (screen within the app) */
    activity: string;
    /** Screenshot as base64 (optional — configurable) */
    screenshotBase64?: string;
    /** Screen on or off */
    screenOn: boolean;
    /** Notification count when observed */
    notificationCount?: number;
    /** Day of week (0=Sunday) */
    dayOfWeek: number;
    /** Hour of day (0-23) */
    hourOfDay: number;
    /** Minutes since midnight */
    minuteOfDay: number;
}

export interface ObservationSession {
    id: string;
    date: string; // YYYY-MM-DD
    frames: ObservationFrame[];
    appTransitions: AppTransition[];
    totalScreenTimeMs: number;
    startTime: number;
    endTime: number;
}

export interface AppTransition {
    timestamp: number;
    fromApp: string;
    toApp: string;
    durationInPreviousMs: number;
}

export interface ObserverConfig {
    /** Interval between observations in milliseconds (default: 30000 = 30s) */
    intervalMs: number;
    /** Whether to capture screenshots (large storage!) */
    captureScreenshots: boolean;
    /** Max observations per session before auto-saving */
    maxFramesPerSession: number;
    /** Data directory */
    dataDir: string;
}

export interface ObserverStats {
    totalSessions: number;
    totalFrames: number;
    totalAppsObserved: number;
    totalScreenTimeHours: number;
    oldestObservation?: string;
    newestObservation?: string;
    isRunning: boolean;
}

// ─── Observer ────────────────────────────────────────────────────────────────

export class PassiveObserver {
    private config: ObserverConfig;
    private running = false;
    private intervalHandle: ReturnType<typeof setInterval> | null = null;
    private currentSession: ObservationSession | null = null;
    private lastApp = "";
    private lastAppStart = 0;

    constructor(config?: Partial<ObserverConfig>) {
        this.config = {
            intervalMs: config?.intervalMs ?? 30_000,
            captureScreenshots: config?.captureScreenshots ?? false,
            maxFramesPerSession: config?.maxFramesPerSession ?? 2000,
            dataDir: config?.dataDir ?? resolve(process.cwd(), "data", "observations"),
        };
        if (!existsSync(this.config.dataDir)) mkdirSync(this.config.dataDir, { recursive: true });
    }

    /** Start passive observation */
    start(): void {
        if (this.running) return;
        this.running = true;
        this.startNewSession();

        this.intervalHandle = setInterval(() => {
            this.observe();
        }, this.config.intervalMs);

        logInfo(`👁️ Passive Observer started (interval: ${this.config.intervalMs}ms)`);
    }

    /** Stop observation and save current session */
    stop(): void {
        if (!this.running) return;
        this.running = false;
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
        this.saveCurrentSession();
        logInfo(`👁️ Passive Observer stopped`);
    }

    isRunning(): boolean { return this.running; }

    /** Take a single observation right now */
    observe(): ObservationFrame | null {
        try {
            const now = new Date();
            const appInfo = this.getCurrentApp();
            const screenOn = this.isScreenOn();

            const frame: ObservationFrame = {
                timestamp: now.getTime(),
                appPackage: appInfo.packageName,
                activity: appInfo.activity,
                screenOn,
                dayOfWeek: now.getDay(),
                hourOfDay: now.getHours(),
                minuteOfDay: now.getHours() * 60 + now.getMinutes(),
            };

            if (this.config.captureScreenshots && screenOn) {
                frame.screenshotBase64 = this.captureScreenshot();
            }

            // Track app transitions
            if (this.currentSession && this.lastApp && this.lastApp !== appInfo.packageName) {
                this.currentSession.appTransitions.push({
                    timestamp: now.getTime(),
                    fromApp: this.lastApp,
                    toApp: appInfo.packageName,
                    durationInPreviousMs: now.getTime() - this.lastAppStart,
                });
            }

            if (this.lastApp !== appInfo.packageName) {
                this.lastApp = appInfo.packageName;
                this.lastAppStart = now.getTime();
            }

            // Add to session
            if (this.currentSession) {
                this.currentSession.frames.push(frame);
                this.currentSession.endTime = now.getTime();
                if (screenOn) {
                    this.currentSession.totalScreenTimeMs += this.config.intervalMs;
                }

                // ── Write to SQLite in real-time ──
                try {
                    const db = getSoulDB();
                    db.insertObservation({
                        timestamp: frame.timestamp,
                        app: frame.appPackage,
                        activity: frame.activity,
                        screen_on: frame.screenOn ? 1 : 0,
                        hour: frame.hourOfDay,
                        minute: now.getMinutes(),
                        day_of_week: frame.dayOfWeek,
                        session_id: this.currentSession.id,
                    });

                    // Write transition to SQLite
                    if (this.lastApp && this.lastApp !== appInfo.packageName) {
                        db.insertTransition({
                            timestamp: now.getTime(),
                            from_app: this.lastApp,
                            to_app: appInfo.packageName,
                            duration_ms: now.getTime() - this.lastAppStart,
                            session_id: this.currentSession.id,
                        });
                    }
                } catch { /* SQLite write is best-effort */ }

                // Auto-save if session is large
                if (this.currentSession.frames.length >= this.config.maxFramesPerSession) {
                    this.saveCurrentSession();
                    this.startNewSession();
                }
            }

            return frame;
        } catch (err) {
            logDebug(`Observer error: ${err instanceof Error ? err.message : err}`);
            return null;
        }
    }

    /** Get statistics about all recorded observations */
    getStats(): ObserverStats {
        const sessions = this.listSessions();
        let totalFrames = 0;
        let totalScreenTimeMs = 0;
        const apps = new Set<string>();
        let oldest: string | undefined;
        let newest: string | undefined;

        for (const session of sessions) {
            totalFrames += session.frames.length;
            totalScreenTimeMs += session.totalScreenTimeMs;
            for (const frame of session.frames) {
                apps.add(frame.appPackage);
            }
            const date = session.date;
            if (!oldest || date < oldest) oldest = date;
            if (!newest || date > newest) newest = date;
        }

        return {
            totalSessions: sessions.length,
            totalFrames,
            totalAppsObserved: apps.size,
            totalScreenTimeHours: Math.round((totalScreenTimeMs / 3600000) * 100) / 100,
            oldestObservation: oldest,
            newestObservation: newest,
            isRunning: this.running,
        };
    }

    /** Load all sessions from disk */
    listSessions(): ObservationSession[] {
        try {
            const files = readdirSync(this.config.dataDir)
                .filter(f => f.startsWith("obs_") && f.endsWith(".json"));
            const sessions: ObservationSession[] = [];
            for (const file of files) {
                try {
                    const content = readFileSync(resolve(this.config.dataDir, file), "utf-8");
                    sessions.push(JSON.parse(content) as ObservationSession);
                } catch { /* skip corrupt */ }
            }
            return sessions;
        } catch {
            return [];
        }
    }

    /** Get the current session (for live monitoring) */
    getCurrentSession(): ObservationSession | null {
        return this.currentSession;
    }

    // ── ADB Helpers ──────────────────────────────────────────────────

    private getCurrentApp(): { packageName: string; activity: string } {
        try {
            const output = execSync(
                'adb shell "dumpsys activity activities | grep mResumedActivity"',
                { timeout: 5000, encoding: "utf-8" },
            ).trim();

            // Parse: mResumedActivity: ActivityRecord{xxx u0 com.package/.Activity t123}
            const match = output.match(/(\S+)\/(\S+)\s/);
            if (match) {
                return { packageName: match[1]!, activity: match[2]! };
            }
        } catch { /* ADB not available */ }
        return { packageName: "unknown", activity: "unknown" };
    }

    private isScreenOn(): boolean {
        try {
            const output = execSync(
                'adb shell "dumpsys power | grep mScreenOn"',
                { timeout: 3000, encoding: "utf-8" },
            ).trim();
            return output.includes("true");
        } catch {
            // Fallback: try Display Power State
            try {
                const output = execSync(
                    'adb shell "dumpsys display | grep mScreenState"',
                    { timeout: 3000, encoding: "utf-8" },
                ).trim();
                return output.includes("ON");
            } catch {
                return true; // assume on if we can't check
            }
        }
    }

    private captureScreenshot(): string | undefined {
        try {
            execSync('adb shell screencap -p /sdcard/obs_temp.png', { timeout: 5000 });
            const data = execSync('adb shell "base64 /sdcard/obs_temp.png"', { timeout: 5000, encoding: "utf-8" });
            execSync('adb shell rm /sdcard/obs_temp.png', { timeout: 3000 });
            return data.trim();
        } catch {
            return undefined;
        }
    }

    // ── Session Management ───────────────────────────────────────────

    private startNewSession(): void {
        const now = new Date();
        this.currentSession = {
            id: `obs_${now.toISOString().slice(0, 10)}_${Date.now().toString(36)}`,
            date: now.toISOString().slice(0, 10),
            frames: [],
            appTransitions: [],
            totalScreenTimeMs: 0,
            startTime: now.getTime(),
            endTime: now.getTime(),
        };
    }

    private saveCurrentSession(): void {
        if (!this.currentSession || this.currentSession.frames.length === 0) return;
        const filePath = resolve(this.config.dataDir, `${this.currentSession.id}.json`);
        writeFileSync(filePath, JSON.stringify(this.currentSession, null, 2), "utf-8");
        logInfo(`📝 Session saved: ${this.currentSession.id} (${this.currentSession.frames.length} frames)`);
    }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _observer: PassiveObserver | null = null;

export function getPassiveObserver(): PassiveObserver {
    if (!_observer) _observer = new PassiveObserver();
    return _observer;
}

export function resetPassiveObserver(): void {
    if (_observer?.isRunning()) _observer.stop();
    _observer = null;
}

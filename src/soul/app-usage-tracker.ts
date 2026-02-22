/**
 * App Usage Tracker — builds a detailed picture of how the user spends time on their phone.
 *
 * Analyzes observation data to produce:
 *  - Per-app usage time (daily/weekly/all-time)
 *  - App transition graph (what app do they go to after X?)
 *  - Time-of-day patterns (morning apps, night apps)
 *  - Usage frequency rankings
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { resolve } from "path";
import { logInfo } from "../logger.js";
import type { ObservationSession } from "./passive-observer.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AppUsageStats {
    appPackage: string;
    totalTimeMs: number;
    sessionCount: number;
    avgSessionMs: number;
    /** Which hours of day this app is most used (0-23) */
    peakHours: number[];
    /** What apps the user typically goes to after this one */
    transitionsTo: Record<string, number>;
    /** What apps the user typically comes from before this one */
    transitionsFrom: Record<string, number>;
    lastUsed: number;
}

export interface DailyRhythm {
    /** Hour of day (0-23) */
    hour: number;
    /** Most common apps during this hour */
    topApps: Array<{ app: string; frequency: number }>;
    /** Average screen-on percentage during this hour */
    screenOnPct: number;
}

export interface UsageProfile {
    /** Total screen time in hours */
    totalScreenTimeHours: number;
    /** Top 20 most-used apps by time */
    topApps: AppUsageStats[];
    /** Hourly rhythm (24 entries, one per hour) */
    dailyRhythm: DailyRhythm[];
    /** Weekday vs weekend behavior difference */
    weekdayAvgHours: number;
    weekendAvgHours: number;
    /** First active hour and last active hour */
    wakeHour: number;
    sleepHour: number;
    /** Generated timestamp */
    generatedAt: number;
}

// ─── Tracker ─────────────────────────────────────────────────────────────────

export class AppUsageTracker {
    private readonly dataDir: string;

    constructor(dataDir?: string) {
        this.dataDir = dataDir ?? resolve(process.cwd(), "data", "observations");
        if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
    }

    /** Build a complete usage profile from all observation sessions */
    buildProfile(sessions: ObservationSession[]): UsageProfile {
        const appMap = new Map<string, AppUsageStats>();
        const hourlyApps = new Map<number, Map<string, number>>();
        const hourlyScreenOn = new Map<number, { on: number; total: number }>();
        let totalScreenTimeMs = 0;
        const weekdayTimes: number[] = [];
        const weekendTimes: number[] = [];

        // Initialize hourly maps
        for (let h = 0; h < 24; h++) {
            hourlyApps.set(h, new Map());
            hourlyScreenOn.set(h, { on: 0, total: 0 });
        }

        for (const session of sessions) {
            totalScreenTimeMs += session.totalScreenTimeMs;

            // Check if weekend
            const sessionDate = new Date(session.date);
            const dow = sessionDate.getDay();
            if (dow === 0 || dow === 6) {
                weekendTimes.push(session.totalScreenTimeMs);
            } else {
                weekdayTimes.push(session.totalScreenTimeMs);
            }

            // Process frames
            for (const frame of session.frames) {
                const app = frame.appPackage;
                if (app === "unknown") continue;

                // Update app stats
                let stats = appMap.get(app);
                if (!stats) {
                    stats = {
                        appPackage: app,
                        totalTimeMs: 0,
                        sessionCount: 0,
                        avgSessionMs: 0,
                        peakHours: [],
                        transitionsTo: {},
                        transitionsFrom: {},
                        lastUsed: 0,
                    };
                    appMap.set(app, stats);
                }
                stats.sessionCount++;
                stats.lastUsed = Math.max(stats.lastUsed, frame.timestamp);

                // Hourly tracking
                const hourMap = hourlyApps.get(frame.hourOfDay)!;
                hourMap.set(app, (hourMap.get(app) ?? 0) + 1);

                // Screen-on tracking per hour
                const hourScreen = hourlyScreenOn.get(frame.hourOfDay)!;
                hourScreen.total++;
                if (frame.screenOn) hourScreen.on++;
            }

            // Process transitions
            for (const trans of session.appTransitions) {
                // Update "from" app
                const fromStats = appMap.get(trans.fromApp);
                if (fromStats) {
                    fromStats.totalTimeMs += trans.durationInPreviousMs;
                    fromStats.transitionsTo[trans.toApp] = (fromStats.transitionsTo[trans.toApp] ?? 0) + 1;
                }

                // Update "to" app
                const toStats = appMap.get(trans.toApp);
                if (toStats) {
                    toStats.transitionsFrom[trans.fromApp] = (toStats.transitionsFrom[trans.fromApp] ?? 0) + 1;
                }
            }
        }

        // Calculate avg session times
        for (const stats of appMap.values()) {
            stats.avgSessionMs = stats.sessionCount > 0 ? stats.totalTimeMs / stats.sessionCount : 0;
        }

        // Build peak hours for each app
        for (const [app, stats] of appMap) {
            const hourCounts: Array<{ hour: number; count: number }> = [];
            for (let h = 0; h < 24; h++) {
                const count = hourlyApps.get(h)!.get(app) ?? 0;
                if (count > 0) hourCounts.push({ hour: h, count });
            }
            hourCounts.sort((a, b) => b.count - a.count);
            stats.peakHours = hourCounts.slice(0, 3).map(h => h.hour);
        }

        // Build daily rhythm
        const dailyRhythm: DailyRhythm[] = [];
        for (let h = 0; h < 24; h++) {
            const hourMap = hourlyApps.get(h)!;
            const entries = Array.from(hourMap.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([app, frequency]) => ({ app, frequency }));

            const screenData = hourlyScreenOn.get(h)!;
            dailyRhythm.push({
                hour: h,
                topApps: entries,
                screenOnPct: screenData.total > 0
                    ? Math.round((screenData.on / screenData.total) * 100)
                    : 0,
            });
        }

        // Find wake/sleep hours
        let wakeHour = 7, sleepHour = 23;
        for (let h = 4; h < 12; h++) {
            if (dailyRhythm[h]!.screenOnPct > 30) { wakeHour = h; break; }
        }
        for (let h = 23; h > 18; h--) {
            if (dailyRhythm[h]!.screenOnPct > 20) { sleepHour = h; break; }
        }

        // Sort apps by total time
        const topApps = Array.from(appMap.values())
            .sort((a, b) => b.totalTimeMs - a.totalTimeMs)
            .slice(0, 20);

        return {
            totalScreenTimeHours: Math.round((totalScreenTimeMs / 3600000) * 100) / 100,
            topApps,
            dailyRhythm,
            weekdayAvgHours: weekdayTimes.length > 0
                ? Math.round((weekdayTimes.reduce((s, t) => s + t, 0) / weekdayTimes.length / 3600000) * 100) / 100
                : 0,
            weekendAvgHours: weekendTimes.length > 0
                ? Math.round((weekendTimes.reduce((s, t) => s + t, 0) / weekendTimes.length / 3600000) * 100) / 100
                : 0,
            wakeHour,
            sleepHour,
            generatedAt: Date.now(),
        };
    }

    /** Load observation sessions from the data directory */
    loadSessions(): ObservationSession[] {
        try {
            const files = readdirSync(this.dataDir)
                .filter(f => f.startsWith("obs_") && f.endsWith(".json"));
            const sessions: ObservationSession[] = [];
            for (const file of files) {
                try {
                    const content = readFileSync(resolve(this.dataDir, file), "utf-8");
                    sessions.push(JSON.parse(content) as ObservationSession);
                } catch { /* skip corrupt */ }
            }
            return sessions;
        } catch {
            return [];
        }
    }

    /** Generate and save a usage profile */
    generateProfile(): UsageProfile {
        const sessions = this.loadSessions();
        const profile = this.buildProfile(sessions);
        const outFile = resolve(this.dataDir, "usage_profile.json");
        writeFileSync(outFile, JSON.stringify(profile, null, 2), "utf-8");
        logInfo(`📊 Usage profile generated: ${profile.topApps.length} apps, ${profile.totalScreenTimeHours}h screen time`);
        return profile;
    }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _tracker: AppUsageTracker | null = null;

export function getAppUsageTracker(): AppUsageTracker {
    if (!_tracker) _tracker = new AppUsageTracker();
    return _tracker;
}

export function resetAppUsageTracker(): void {
    _tracker = null;
}

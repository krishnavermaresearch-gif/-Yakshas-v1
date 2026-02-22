/**
 * Behavioral Patterns — mines observation data for decision patterns and routines.
 *
 * Learns:
 *  - Daily routines (morning sequence, night routine)
 *  - Trigger → action patterns ("after receiving email, opens Slack")
 *  - Contextual behaviors (weekend vs weekday, morning vs night)
 *  - Habit strength (how consistent is the behavior?)
 *
 * This is the "rhythm" of the Digital Soul.
 */

import { writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { logInfo } from "../logger.js";
import type { ObservationSession } from "./passive-observer.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Routine {
    id: string;
    name: string;
    /** Typical time range this routine happens */
    timeRange: { startHour: number; endHour: number };
    /** App sequence that defines this routine */
    appSequence: string[];
    /** How many days this pattern has been observed */
    observedDays: number;
    /** Consistency score: how reliably this pattern repeats (0-1) */
    consistency: number;
    /** Whether this happens on weekdays, weekends, or both */
    dayType: "weekday" | "weekend" | "both";
}

export interface TriggerAction {
    id: string;
    /** The triggering event */
    trigger: {
        type: "app_open" | "time_of_day" | "after_app" | "notification";
        value: string;
    };
    /** What the user typically does after */
    action: {
        app: string;
        probability: number; // 0-1
    };
    /** How many times this pattern was observed */
    occurrences: number;
}

export interface BehavioralProfile {
    /** Detected daily routines */
    routines: Routine[];
    /** Trigger → action patterns */
    triggerActions: TriggerAction[];
    /** App sequences (most common 3-app chains) */
    commonSequences: Array<{ apps: string[]; frequency: number }>;
    /** Behavioral consistency score (how predictable is this person?) 0-1 */
    predictability: number;
    /** Total days of observation data */
    totalDaysObserved: number;
    generatedAt: number;
}

// ─── Pattern Miner ───────────────────────────────────────────────────────────

export class BehavioralPatternMiner {
    private readonly dataDir: string;

    constructor(dataDir?: string) {
        this.dataDir = dataDir ?? resolve(process.cwd(), "data", "behavioral");
        if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
    }

    /** Mine behavioral patterns from observation sessions */
    mine(sessions: ObservationSession[]): BehavioralProfile {
        if (sessions.length === 0) {
            return {
                routines: [], triggerActions: [],
                commonSequences: [], predictability: 0,
                totalDaysObserved: 0, generatedAt: Date.now(),
            };
        }

        const uniqueDays = new Set(sessions.map(s => s.date));
        const routines = this.detectRoutines(sessions);
        const triggerActions = this.detectTriggerActions(sessions);
        const commonSequences = this.detectAppSequences(sessions);
        const predictability = this.calculatePredictability(sessions);

        return {
            routines,
            triggerActions,
            commonSequences,
            predictability,
            totalDaysObserved: uniqueDays.size,
            generatedAt: Date.now(),
        };
    }

    /** Detect recurring app sequences that form routines */
    private detectRoutines(sessions: ObservationSession[]): Routine[] {
        // Group sessions by date and find common morning/evening patterns
        const dayPatterns = new Map<string, Map<string, string[]>>();

        for (const session of sessions) {
            const hourBlocks = new Map<string, string[]>();

            for (const frame of session.frames) {
                const block = frame.hourOfDay < 9 ? "morning"
                    : frame.hourOfDay < 12 ? "late_morning"
                        : frame.hourOfDay < 17 ? "afternoon"
                            : frame.hourOfDay < 21 ? "evening"
                                : "night";

                const apps = hourBlocks.get(block) ?? [];
                if (apps.length === 0 || apps[apps.length - 1] !== frame.appPackage) {
                    apps.push(frame.appPackage);
                }
                hourBlocks.set(block, apps);
            }

            dayPatterns.set(session.date, hourBlocks);
        }

        // Find most common app sequences per time block
        const routines: Routine[] = [];
        const blocks = ["morning", "late_morning", "afternoon", "evening", "night"];
        const blockHours: Record<string, { start: number; end: number }> = {
            morning: { start: 5, end: 9 },
            late_morning: { start: 9, end: 12 },
            afternoon: { start: 12, end: 17 },
            evening: { start: 17, end: 21 },
            night: { start: 21, end: 24 },
        };

        for (const block of blocks) {
            const sequences: string[][] = [];
            for (const [, hourBlocks] of dayPatterns) {
                const apps = hourBlocks.get(block);
                if (apps && apps.length >= 2) {
                    sequences.push(apps.slice(0, 5)); // first 5 apps
                }
            }

            if (sequences.length < 2) continue;

            // Find the most common first 3 apps
            const seqKeys = sequences.map(s => s.slice(0, 3).join("→"));
            const keyCounts = new Map<string, number>();
            for (const k of seqKeys) keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);

            const topKey = Array.from(keyCounts.entries())
                .sort((a, b) => b[1] - a[1])[0];

            if (topKey && topKey[1] >= 2) {
                const hours = blockHours[block]!;
                routines.push({
                    id: `routine_${block}`,
                    name: `${block.replace("_", " ")} routine`,
                    timeRange: { startHour: hours.start, endHour: hours.end },
                    appSequence: topKey[0].split("→"),
                    observedDays: topKey[1],
                    consistency: Math.round((topKey[1] / sequences.length) * 100) / 100,
                    dayType: "both",
                });
            }
        }

        return routines;
    }

    /** Detect trigger → action patterns from app transitions */
    private detectTriggerActions(sessions: ObservationSession[]): TriggerAction[] {
        // Count: after app X, which app Y is most commonly opened?
        const afterApp = new Map<string, Map<string, number>>();

        for (const session of sessions) {
            for (const trans of session.appTransitions) {
                if (trans.fromApp === "unknown" || trans.toApp === "unknown") continue;
                const targets = afterApp.get(trans.fromApp) ?? new Map();
                targets.set(trans.toApp, (targets.get(trans.toApp) ?? 0) + 1);
                afterApp.set(trans.fromApp, targets);
            }
        }

        const triggers: TriggerAction[] = [];
        let id = 0;

        for (const [fromApp, targets] of afterApp) {
            const totalTransitions = Array.from(targets.values()).reduce((s, c) => s + c, 0);
            const sorted = Array.from(targets.entries()).sort((a, b) => b[1] - a[1]);

            if (sorted[0] && sorted[0][1] >= 3) {
                triggers.push({
                    id: `trigger_${id++}`,
                    trigger: { type: "after_app", value: fromApp },
                    action: {
                        app: sorted[0][0],
                        probability: Math.round((sorted[0][1] / totalTransitions) * 100) / 100,
                    },
                    occurrences: sorted[0][1],
                });
            }
        }

        return triggers.sort((a, b) => b.occurrences - a.occurrences).slice(0, 20);
    }

    /** Detect common 3-app sequences */
    private detectAppSequences(sessions: ObservationSession[]): Array<{ apps: string[]; frequency: number }> {
        const trigrams = new Map<string, number>();

        for (const session of sessions) {
            const transitions = session.appTransitions;
            for (let i = 0; i < transitions.length - 1; i++) {
                const seq = [transitions[i]!.fromApp, transitions[i]!.toApp, transitions[i + 1]!.toApp];
                if (seq.includes("unknown")) continue;
                const key = seq.join("→");
                trigrams.set(key, (trigrams.get(key) ?? 0) + 1);
            }
        }

        return Array.from(trigrams.entries())
            .filter(([, count]) => count >= 2)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([key, frequency]) => ({ apps: key.split("→"), frequency }));
    }

    /** Calculate how predictable the user's behavior is */
    private calculatePredictability(sessions: ObservationSession[]): number {
        if (sessions.length < 3) return 0;

        // Compare each day's app usage pattern to the "average day"
        // More similar days = more predictable
        const dayAppSets = sessions.map(s => {
            const apps = new Set(s.frames.map(f => f.appPackage));
            apps.delete("unknown");
            return apps;
        });

        let totalSimilarity = 0;
        let comparisons = 0;

        for (let i = 0; i < dayAppSets.length; i++) {
            for (let j = i + 1; j < dayAppSets.length; j++) {
                const a = dayAppSets[i]!;
                const b = dayAppSets[j]!;
                const intersection = new Set([...a].filter(x => b.has(x)));
                const union = new Set([...a, ...b]);
                if (union.size > 0) {
                    totalSimilarity += intersection.size / union.size; // Jaccard similarity
                    comparisons++;
                }
            }
        }

        return comparisons > 0 ? Math.round((totalSimilarity / comparisons) * 100) / 100 : 0;
    }

    /** Generate and save a behavioral profile */
    generateProfile(sessions: ObservationSession[]): BehavioralProfile {
        const profile = this.mine(sessions);
        const file = resolve(this.dataDir, "behavioral_profile.json");
        writeFileSync(file, JSON.stringify(profile, null, 2), "utf-8");
        logInfo(`🧠 Behavioral profile: ${profile.routines.length} routines, ${profile.triggerActions.length} triggers, predictability=${profile.predictability}`);
        return profile;
    }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _miner: BehavioralPatternMiner | null = null;

export function getBehavioralPatternMiner(): BehavioralPatternMiner {
    if (!_miner) _miner = new BehavioralPatternMiner();
    return _miner;
}

export function resetBehavioralPatternMiner(): void {
    _miner = null;
}

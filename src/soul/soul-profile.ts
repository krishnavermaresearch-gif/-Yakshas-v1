/**
 * Soul Profile — the unified Digital Soul.
 *
 * Combines all behavioral data into a single "digital twin" profile:
 *  - App usage patterns (from PassiveObserver + AppUsageTracker)
 *  - Communication style (from CommunicationAnalyzer)
 *  - Behavioral patterns (from BehavioralPatternMiner)
 *
 * Can answer: "How would this person respond?" "What would they do next?"
 * "Is this in character for them?"
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { logInfo } from "../logger.js";
import { getPassiveObserver, type ObserverStats } from "./passive-observer.js";
import { AppUsageTracker, type UsageProfile } from "./app-usage-tracker.js";
import { CommunicationAnalyzer, type CommunicationFingerprint } from "./communication-analyzer.js";
import { BehavioralPatternMiner, type BehavioralProfile } from "./behavioral-patterns.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DigitalSoul {
    /** Unique identifier for this soul */
    id: string;
    /** Human-readable name */
    name: string;
    /** When this soul was first created */
    createdAt: number;
    /** Last time the soul was updated */
    updatedAt: number;
    /** How many days of observation data */
    observationDays: number;
    /** Maturity level based on data volume */
    maturityLevel: "infant" | "learning" | "developing" | "mature" | "deep";

    // ── Personality Summary ──────────────────────────────────────────

    /** Auto-generated personality description */
    personalitySummary: string;
    /** Key traits derived from behavior */
    traits: SoulTrait[];
    /** Communication style summary */
    communicationStyle: string;
    /** Daily rhythm summary */
    dailyRhythm: string;

    // ── Raw Data References ──────────────────────────────────────────

    usageProfile?: UsageProfile;
    communicationFingerprint?: CommunicationFingerprint;
    behavioralProfile?: BehavioralProfile;
    observerStats?: ObserverStats;
}

export interface SoulTrait {
    name: string;
    value: number; // 0-1
    evidence: string;
}

export interface SoulPrediction {
    question: string;
    prediction: string;
    confidence: number;
    reasoning: string;
}

// ─── Soul Builder ────────────────────────────────────────────────────────────

export class SoulProfileBuilder {
    private readonly dataDir: string;

    constructor(dataDir?: string) {
        this.dataDir = dataDir ?? resolve(process.cwd(), "data", "soul");
        if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
    }

    /** Build or update the Digital Soul from all available data */
    build(name: string): DigitalSoul {
        // Gather all data
        const observer = getPassiveObserver();
        const sessions = observer.listSessions();
        const observerStats = observer.getStats();

        const usageTracker = new AppUsageTracker();
        const usageProfile = sessions.length > 0 ? usageTracker.buildProfile(sessions) : undefined;

        const commAnalyzer = new CommunicationAnalyzer();
        const commFingerprint = commAnalyzer.getMessageCount() > 0
            ? commAnalyzer.buildFingerprint()
            : undefined;

        const patternMiner = new BehavioralPatternMiner();
        const behavioralProfile = sessions.length > 0
            ? patternMiner.mine(sessions)
            : undefined;

        // Calculate maturity
        const days = observerStats.totalSessions;
        const maturity: DigitalSoul["maturityLevel"] =
            days < 3 ? "infant" :
                days < 14 ? "learning" :
                    days < 30 ? "developing" :
                        days < 90 ? "mature" : "deep";

        // Derive traits
        const traits = this.deriveTraits(usageProfile, commFingerprint, behavioralProfile);

        // Generate summaries
        const personalitySummary = this.generatePersonalitySummary(traits, usageProfile, commFingerprint);
        const communicationStyle = this.generateCommStyleSummary(commFingerprint);
        const dailyRhythm = this.generateRhythmSummary(usageProfile);

        const soul: DigitalSoul = {
            id: `soul_${name.toLowerCase().replace(/\s+/g, "_")}`,
            name,
            createdAt: this.loadExistingSoul()?.createdAt ?? Date.now(),
            updatedAt: Date.now(),
            observationDays: days,
            maturityLevel: maturity,
            personalitySummary,
            traits,
            communicationStyle,
            dailyRhythm,
            usageProfile,
            communicationFingerprint: commFingerprint,
            behavioralProfile,
            observerStats,
        };

        this.saveSoul(soul);
        logInfo(`🌟 Digital Soul "${name}" built — maturity: ${maturity}, traits: ${traits.length}`);
        return soul;
    }

    /** Load existing soul from disk */
    loadExistingSoul(): DigitalSoul | null {
        const file = resolve(this.dataDir, "soul.json");
        if (!existsSync(file)) return null;
        try {
            return JSON.parse(readFileSync(file, "utf-8")) as DigitalSoul;
        } catch {
            return null;
        }
    }

    /** Predict how the person would behave in a given situation */
    predict(soul: DigitalSoul, question: string): SoulPrediction {
        const q = question.toLowerCase();

        // App-related prediction
        if (q.includes("what app") || q.includes("which app")) {
            const topApp = soul.usageProfile?.topApps[0];
            return {
                question,
                prediction: topApp
                    ? `They'd most likely open ${topApp.appPackage} (their most used app)`
                    : "Not enough data to predict",
                confidence: topApp ? 0.7 : 0.1,
                reasoning: "Based on app usage frequency data",
            };
        }

        // Time-related prediction
        if (q.includes("when") || q.includes("what time")) {
            const wake = soul.usageProfile?.wakeHour ?? 7;
            const sleep = soul.usageProfile?.sleepHour ?? 23;
            return {
                question,
                prediction: `They're typically active from ${wake}:00 to ${sleep}:00`,
                confidence: soul.maturityLevel === "infant" ? 0.2 : 0.6,
                reasoning: "Based on screen-on patterns from passive observation",
            };
        }

        // Response style prediction
        if (q.includes("how would they respond") || q.includes("reply")) {
            const fp = soul.communicationFingerprint;
            if (fp) {
                const style = fp.overallFormality > 0.6 ? "formal" : "casual";
                const length = fp.avgMessageLength < 30 ? "briefly" : "with detail";
                const emoji = fp.emojiUsageRate > 0.3 ? "with emojis" : "without emojis";
                return {
                    question,
                    prediction: `They'd respond ${length}, in a ${style} tone, ${emoji}`,
                    confidence: Math.min(0.8, fp.totalMessages / 500),
                    reasoning: `Based on ${fp.totalMessages} analyzed messages`,
                };
            }
        }

        // Routine prediction
        if (q.includes("morning") || q.includes("routine")) {
            const routines = soul.behavioralProfile?.routines ?? [];
            const morning = routines.find(r => r.name.includes("morning"));
            if (morning) {
                return {
                    question,
                    prediction: `Their morning routine: ${morning.appSequence.join(" → ")} (${Math.round(morning.consistency * 100)}% consistent)`,
                    confidence: morning.consistency,
                    reasoning: `Observed over ${morning.observedDays} days`,
                };
            }
        }

        return {
            question,
            prediction: "Not enough behavioral data to predict this yet",
            confidence: 0.1,
            reasoning: `Soul maturity: ${soul.maturityLevel}. Need more observation time.`,
        };
    }

    // ── Trait Derivation ─────────────────────────────────────────────

    private deriveTraits(
        usage?: UsageProfile,
        comm?: CommunicationFingerprint,
        behavior?: BehavioralProfile,
    ): SoulTrait[] {
        const traits: SoulTrait[] = [];

        if (usage) {
            // Night owl vs. early bird
            const lateNightPct = usage.dailyRhythm
                .filter(h => h.hour >= 23 || h.hour <= 4)
                .reduce((s, h) => s + h.screenOnPct, 0) / 6;
            const earlyMorningPct = usage.dailyRhythm
                .filter(h => h.hour >= 5 && h.hour <= 8)
                .reduce((s, h) => s + h.screenOnPct, 0) / 4;

            if (lateNightPct > earlyMorningPct) {
                traits.push({
                    name: "Night Owl",
                    value: Math.min(1, lateNightPct / 50),
                    evidence: `${Math.round(lateNightPct)}% screen-on during late night hours`,
                });
            } else {
                traits.push({
                    name: "Early Bird",
                    value: Math.min(1, earlyMorningPct / 50),
                    evidence: `${Math.round(earlyMorningPct)}% screen-on during early morning`,
                });
            }

            // Heavy phone user
            traits.push({
                name: "Phone Dependency",
                value: Math.min(1, usage.totalScreenTimeHours / 12),
                evidence: `${usage.totalScreenTimeHours}h total screen time recorded`,
            });

            // Social media orientation
            const socialApps = ["instagram", "facebook", "twitter", "tiktok", "snapchat", "reddit"];
            const socialTime = usage.topApps
                .filter(a => socialApps.some(s => a.appPackage.toLowerCase().includes(s)))
                .reduce((sum, a) => sum + a.totalTimeMs, 0);
            const totalTime = usage.topApps.reduce((sum, a) => sum + a.totalTimeMs, 0);
            if (totalTime > 0) {
                traits.push({
                    name: "Social Media Focus",
                    value: Math.round((socialTime / totalTime) * 100) / 100,
                    evidence: `${Math.round((socialTime / totalTime) * 100)}% of app time on social media`,
                });
            }
        }

        if (comm) {
            traits.push({
                name: "Expressiveness",
                value: comm.emojiUsageRate,
                evidence: `Uses emojis in ${Math.round(comm.emojiUsageRate * 100)}% of messages`,
            });

            traits.push({
                name: "Formality",
                value: comm.overallFormality,
                evidence: `Communication formality score: ${comm.overallFormality}`,
            });

            traits.push({
                name: "Verbosity",
                value: Math.min(1, comm.avgMessageLength / 200),
                evidence: `Average message length: ${comm.avgMessageLength} characters`,
            });
        }

        if (behavior) {
            traits.push({
                name: "Predictability",
                value: behavior.predictability,
                evidence: `Behavioral consistency score: ${behavior.predictability}`,
            });

            traits.push({
                name: "Routined",
                value: Math.min(1, behavior.routines.length / 5),
                evidence: `${behavior.routines.length} daily routines detected`,
            });
        }

        return traits;
    }

    // ── Summary Generation ───────────────────────────────────────────

    private generatePersonalitySummary(
        traits: SoulTrait[],
        _usage?: UsageProfile,
        _comm?: CommunicationFingerprint,
    ): string {
        const parts: string[] = [];

        const nightOwl = traits.find(t => t.name === "Night Owl");
        const earlyBird = traits.find(t => t.name === "Early Bird");
        if (nightOwl && nightOwl.value > 0.3) parts.push("A night owl");
        else if (earlyBird && earlyBird.value > 0.3) parts.push("An early riser");

        const social = traits.find(t => t.name === "Social Media Focus");
        if (social && social.value > 0.3) parts.push("active on social media");

        const formal = traits.find(t => t.name === "Formality");
        if (formal) {
            parts.push(formal.value > 0.6 ? "communicates formally"
                : formal.value < 0.3 ? "very casual communicator"
                    : "balanced communication style");
        }

        const predictable = traits.find(t => t.name === "Predictability");
        if (predictable && predictable.value > 0.5) parts.push("follows consistent daily patterns");

        if (parts.length === 0) return "Not enough data for personality summary yet.";
        return parts.join(", ") + ".";
    }

    private generateCommStyleSummary(comm?: CommunicationFingerprint): string {
        if (!comm || comm.totalMessages === 0) return "No communication data yet.";

        const parts: string[] = [];
        parts.push(`Avg message: ${comm.avgMessageLength} chars`);
        if (comm.emojiUsageRate > 0.5) parts.push("heavy emoji user");
        else if (comm.emojiUsageRate > 0.2) parts.push("moderate emoji use");
        else parts.push("rarely uses emojis");

        if (comm.topEmojis.length > 0) parts.push(`favorites: ${comm.topEmojis.slice(0, 3).join("")}`);
        if (comm.catchphrases.length > 0) parts.push(`catch phrases: "${comm.catchphrases[0]}"`);

        const dist = comm.lengthDistribution;
        if (dist.short > 60) parts.push("prefers short messages");
        else if (dist.long > 30) parts.push("writes detailed messages");

        return parts.join(". ") + ".";
    }

    private generateRhythmSummary(usage?: UsageProfile): string {
        if (!usage) return "No usage data yet.";

        return [
            `Wakes around ${usage.wakeHour}:00, sleeps around ${usage.sleepHour}:00`,
            `Weekday avg: ${usage.weekdayAvgHours}h screen time`,
            `Weekend avg: ${usage.weekendAvgHours}h screen time`,
            usage.topApps[0] ? `Most used app: ${usage.topApps[0].appPackage}` : "",
        ].filter(Boolean).join(". ") + ".";
    }

    // ── Persistence ──────────────────────────────────────────────────

    private saveSoul(soul: DigitalSoul): void {
        const file = resolve(this.dataDir, "soul.json");
        writeFileSync(file, JSON.stringify(soul, null, 2), "utf-8");
    }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _builder: SoulProfileBuilder | null = null;

export function getSoulProfileBuilder(): SoulProfileBuilder {
    if (!_builder) _builder = new SoulProfileBuilder();
    return _builder;
}

export function resetSoulProfileBuilder(): void {
    _builder = null;
}

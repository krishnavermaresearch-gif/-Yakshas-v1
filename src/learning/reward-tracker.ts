/**
 * Reward Tracker — scores task outcomes for reinforcement learning.
 *
 * Computes a reward signal from:
 * - Task success/failure
 * - Efficiency (fewer tool calls = better)
 * - Speed (faster = better)
 * - User feedback (explicit thumbs up/down or corrections)
 *
 * Also tracks the user's personality profile — their habits, preferences,
 * communication style, and frequently used apps/contacts.
 */

import { logDebug, logInfo } from "../logger.js";
import { getExperienceStore, type Experience, type ToolStep } from "./experience-store.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type TaskOutcome = {
    task: string;
    success: boolean;
    toolCalls: ToolStep[];
    totalDurationMs: number;
    agentResponse: string;
    /** User explicitly gave positive/negative feedback */
    userFeedback?: "positive" | "negative" | "correction";
};

/** Learned preferences about the user. */
export type UserProfile = {
    /** Apps used most often (name → count) */
    frequentApps: Record<string, number>;
    /** Contacts messaged most (name → count) */
    frequentContacts: Record<string, number>;
    /** Common task patterns (pattern → count) */
    taskPatterns: Record<string, number>;
    /** Preferred communication style traits */
    style: {
        useEmojis: boolean;
        formalLevel: "casual" | "normal" | "formal";
        messageLength: "short" | "medium" | "long";
        language: string;
    };
    /** Time-of-day activity patterns */
    activeHours: Record<number, number>; // hour → frequency
    /** Total interactions */
    totalInteractions: number;
    /** Success rate over time */
    successRate: number;
    /** Average reward over last 20 tasks */
    recentAvgReward: number;
    lastUpdated: number;
};

// ─── Reward Computation ──────────────────────────────────────────────────────

/**
 * Compute a reward score for a completed task.
 * Score range: -1.0 (terrible) to 1.0 (perfect).
 */
export function computeReward(outcome: TaskOutcome): number {
    let reward = 0;

    // Base: success = +0.5, failure = -0.5
    reward += outcome.success ? 0.5 : -0.5;

    // Efficiency bonus: fewer tool calls is better
    // Ideal: 1-5 calls for simple tasks, 5-15 for complex
    const calls = outcome.toolCalls.length;
    if (calls <= 5) reward += 0.2;
    else if (calls <= 10) reward += 0.1;
    else if (calls <= 20) reward += 0.0;
    else reward -= 0.1; // Too many calls = inefficient

    // Speed bonus: faster is better
    const seconds = outcome.totalDurationMs / 1000;
    if (seconds < 10) reward += 0.15;
    else if (seconds < 30) reward += 0.1;
    else if (seconds < 60) reward += 0.05;
    // No penalty for slow tasks — some are inherently complex

    // User feedback is the strongest signal
    if (outcome.userFeedback === "positive") reward += 0.3;
    else if (outcome.userFeedback === "negative") reward -= 0.4;
    else if (outcome.userFeedback === "correction") reward -= 0.2;

    // Penalty for zero tool calls (agent just responded with text, didn't do anything)
    if (calls === 0 && outcome.success) reward -= 0.2;

    // Clamp to [-1, 1]
    return Math.max(-1, Math.min(1, reward));
}

/**
 * Generate a human-readable insight about what worked or didn't.
 */
export function generateInsight(outcome: TaskOutcome, reward: number): string {
    const parts: string[] = [];

    if (outcome.success) {
        parts.push(`Successfully completed`);
        if (outcome.toolCalls.length <= 3) parts.push("efficiently");
    } else {
        parts.push("Failed to complete");
    }

    // Note interesting tool usage patterns
    const toolFreq: Record<string, number> = {};
    for (const step of outcome.toolCalls) {
        toolFreq[step.tool] = (toolFreq[step.tool] ?? 0) + 1;
    }

    const topTools = Object.entries(toolFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([tool, count]) => `${tool}(×${count})`);

    if (topTools.length > 0) {
        parts.push(`using ${topTools.join(", ")}`);
    }

    parts.push(`(reward=${reward.toFixed(2)}, ${outcome.toolCalls.length} steps, ${(outcome.totalDurationMs / 1000).toFixed(1)}s)`);

    return parts.join(" ");
}

// ─── Reward Tracker ──────────────────────────────────────────────────────────

export class RewardTracker {
    private profile: UserProfile;
    private recentRewards: number[] = [];
    private readonly profilePath: string;

    constructor() {
        this.profilePath = `${process.cwd()}/data/user_profile.json`;
        this.profile = this.loadProfile();
    }

    /**
     * Process a completed task — compute reward, generate insight,
     * store experience, and update user profile.
     */
    async processOutcome(outcome: TaskOutcome): Promise<Experience> {
        const reward = computeReward(outcome);
        const insight = generateInsight(outcome, reward);

        // Track reward history
        this.recentRewards.push(reward);
        if (this.recentRewards.length > 20) {
            this.recentRewards = this.recentRewards.slice(-20);
        }

        // Create experience
        const experience: Experience = {
            id: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            task: outcome.task,
            steps: outcome.toolCalls,
            reward,
            success: outcome.success,
            totalToolCalls: outcome.toolCalls.length,
            totalDurationMs: outcome.totalDurationMs,
            timestamp: Date.now(),
            insight,
        };

        // Store in ChromaDB
        const expStore = getExperienceStore();
        await expStore.store_experience(experience);

        // Update user profile
        this.updateProfile(outcome);

        logInfo(`RL: ${insight}`);
        return experience;
    }

    /**
     * Get the current user profile for prompt injection.
     */
    getProfilePrompt(): string {
        const p = this.profile;
        if (p.totalInteractions === 0) return "";

        const parts: string[] = ["## User Profile (Learned from interactions)"];

        // Frequent apps
        const topApps = Object.entries(p.frequentApps)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        if (topApps.length > 0) {
            parts.push(`Frequently used apps: ${topApps.map(([app, n]) => `${app}(${n}×)`).join(", ")}`);
        }

        // Frequent contacts
        const topContacts = Object.entries(p.frequentContacts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        if (topContacts.length > 0) {
            parts.push(`Frequent contacts: ${topContacts.map(([c, n]) => `${c}(${n}×)`).join(", ")}`);
        }

        // Common tasks
        const topTasks = Object.entries(p.taskPatterns)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        if (topTasks.length > 0) {
            parts.push(`Common tasks: ${topTasks.map(([t, n]) => `${t}(${n}×)`).join(", ")}`);
        }

        // Communication style
        parts.push(`Style: ${p.style.formalLevel}, ${p.style.messageLength} messages${p.style.useEmojis ? ", uses emojis" : ""}, language: ${p.style.language}`);

        // Performance stats
        parts.push(`Stats: ${p.totalInteractions} total tasks, ${(p.successRate * 100).toFixed(0)}% success rate, avg reward: ${p.recentAvgReward.toFixed(2)}`);

        // Active hours
        const peakHours = Object.entries(p.activeHours)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([h]) => `${h}:00`);
        if (peakHours.length > 0) {
            parts.push(`Most active hours: ${peakHours.join(", ")}`);
        }

        return parts.join("\n");
    }

    // ── Profile Updates ──────────────────────────────────────────────────────

    private updateProfile(outcome: TaskOutcome): void {
        const p = this.profile;
        p.totalInteractions++;
        p.lastUpdated = Date.now();

        // Track active hour
        const hour = new Date().getHours();
        p.activeHours[hour] = (p.activeHours[hour] ?? 0) + 1;

        // Extract app usage from tool calls
        for (const step of outcome.toolCalls) {
            if (step.tool === "adb_app_launch" && typeof step.args.package === "string") {
                const pkg = step.args.package;
                const appName = pkg.split(".").pop() ?? pkg;
                p.frequentApps[appName] = (p.frequentApps[appName] ?? 0) + 1;
            }
        }

        // Extract contact names from task text
        const taskLower = outcome.task.toLowerCase();
        const contactPatterns = [
            /(?:message|text|chat|call|send to|reply to)\s+(\w+)/i,
            /(?:whatsapp|telegram|instagram)\s+(?:to\s+)?(\w+)/i,
        ];
        for (const pattern of contactPatterns) {
            const match = taskLower.match(pattern);
            if (match?.[1] && match[1].length > 2) {
                const contact = match[1].charAt(0).toUpperCase() + match[1].slice(1);
                p.frequentContacts[contact] = (p.frequentContacts[contact] ?? 0) + 1;
            }
        }

        // Extract task patterns
        const taskCategory = categorizeTask(outcome.task);
        p.taskPatterns[taskCategory] = (p.taskPatterns[taskCategory] ?? 0) + 1;

        // Update communication style based on user messages
        this.learnStyle(outcome.task);

        // Update success rate (exponential moving average)
        p.successRate = p.successRate * 0.9 + (outcome.success ? 0.1 : 0);
        p.recentAvgReward = this.recentRewards.reduce((a, b) => a + b, 0) / Math.max(1, this.recentRewards.length);

        this.saveProfile();
    }

    private learnStyle(userMessage: string): void {
        const p = this.profile;

        // Emoji usage
        const hasEmoji = /[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]/u.test(userMessage);
        if (hasEmoji) p.style.useEmojis = true;

        // Message length preference
        if (userMessage.length < 30) p.style.messageLength = "short";
        else if (userMessage.length < 100) p.style.messageLength = "medium";
        else p.style.messageLength = "long";

        // Formality detection
        const informalMarkers = /\b(lol|omg|bruh|nah|gonna|wanna|yeah|hey|sup|chill|dude|bro)\b/i;
        const formalMarkers = /\b(please|kindly|could you|would you|thank you|regards)\b/i;

        if (informalMarkers.test(userMessage)) p.style.formalLevel = "casual";
        else if (formalMarkers.test(userMessage)) p.style.formalLevel = "formal";
    }

    // ── Persistence ──────────────────────────────────────────────────────────

    private loadProfile(): UserProfile {
        try {
            const fs = require("node:fs");
            if (fs.existsSync(this.profilePath)) {
                const data = JSON.parse(fs.readFileSync(this.profilePath, "utf-8"));
                logInfo(`User profile loaded: ${data.totalInteractions ?? 0} interactions`);
                return data;
            }
        } catch (err) {
            logDebug(`No existing profile: ${err instanceof Error ? err.message : err}`);
        }

        return this.createDefaultProfile();
    }

    private saveProfile(): void {
        try {
            const fs = require("node:fs");
            const path = require("node:path");
            const dir = path.dirname(this.profilePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.profilePath, JSON.stringify(this.profile, null, 2));
        } catch (err) {
            logDebug(`Failed to save profile: ${err instanceof Error ? err.message : err}`);
        }
    }

    private createDefaultProfile(): UserProfile {
        return {
            frequentApps: {},
            frequentContacts: {},
            taskPatterns: {},
            style: {
                useEmojis: false,
                formalLevel: "casual",
                messageLength: "short",
                language: "en",
            },
            activeHours: {},
            totalInteractions: 0,
            successRate: 0.5,
            recentAvgReward: 0,
            lastUpdated: Date.now(),
        };
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function categorizeTask(task: string): string {
    const lower = task.toLowerCase();

    if (/whatsapp|message|chat|text|sms|reply/i.test(lower)) return "messaging";
    if (/instagram|insta|post|story|reel/i.test(lower)) return "social_media";
    if (/youtube|video|watch|play/i.test(lower)) return "media";
    if (/settings|wifi|bluetooth|battery|volume/i.test(lower)) return "settings";
    if (/call|dial|phone/i.test(lower)) return "calling";
    if (/camera|photo|picture|selfie/i.test(lower)) return "camera";
    if (/search|google|find|look/i.test(lower)) return "search";
    if (/install|update|download|app/i.test(lower)) return "app_management";
    if (/screenshot|screen/i.test(lower)) return "screenshot";
    if (/open|launch|start/i.test(lower)) return "app_launch";
    return "other";
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _tracker: RewardTracker | null = null;

export function getRewardTracker(): RewardTracker {
    if (!_tracker) {
        _tracker = new RewardTracker();
    }
    return _tracker;
}

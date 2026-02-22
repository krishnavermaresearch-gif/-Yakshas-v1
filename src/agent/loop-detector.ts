/**
 * Tool Loop Detection — prevents the agent from getting stuck
 * repeating the same tool calls endlessly.
 *
 * Inspired by OpenClaw's tool-loop-detection.ts, simplified for Yakshas-v1.
 *
 * Detectors:
 * 1. Generic repeat — same tool+args called too many times
 * 2. No-progress — same tool+args+result repeating (output never changes)
 * 3. Ping-pong — alternating between two tool calls with no progress
 */

import { createHash } from "node:crypto";
import { logWarn } from "../logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type LoopLevel = "ok" | "warning" | "critical";

export type LoopCheckResult = {
    level: LoopLevel;
    message?: string;
};

type ToolCallRecord = {
    argsHash: string;
    toolName: string;
    resultHash?: string;
    timestamp: number;
};

// ─── Config ──────────────────────────────────────────────────────────────────

const HISTORY_SIZE = 20;
const WARNING_THRESHOLD = 8;
const CRITICAL_THRESHOLD = 12;
const PING_PONG_THRESHOLD = 10;

// ─── State ───────────────────────────────────────────────────────────────────

export class LoopDetector {
    private history: ToolCallRecord[] = [];
    private warningsSent = new Set<string>();

    /** Reset state between tasks. */
    reset(): void {
        this.history = [];
        this.warningsSent.clear();
    }

    /**
     * Check if the next tool call would be a loop.
     * Call this BEFORE executing the tool.
     */
    check(toolName: string, args: unknown): LoopCheckResult {
        const argsHash = hashToolCall(toolName, args);

        // ── Detector 1: No-progress (same call + same result) ──
        const noProgressCount = this.getNoProgressStreak(toolName, argsHash);
        if (noProgressCount >= CRITICAL_THRESHOLD) {
            const msg = `LOOP DETECTED: ${toolName} called ${noProgressCount} times with identical results. Stopping.`;
            logWarn(msg);
            return { level: "critical", message: msg };
        }
        if (noProgressCount >= WARNING_THRESHOLD) {
            const key = `noprog:${argsHash}`;
            if (!this.warningsSent.has(key)) {
                this.warningsSent.add(key);
                const msg = `WARNING: ${toolName} called ${noProgressCount} times with same result. Try a different approach.`;
                logWarn(msg);
                return { level: "warning", message: msg };
            }
        }

        // ── Detector 2: Ping-pong (alternating A↔B) ──
        const pingPong = this.getPingPongCount(argsHash);
        if (pingPong >= PING_PONG_THRESHOLD) {
            const msg = `LOOP DETECTED: Alternating tool call pattern detected (${pingPong} cycles). Stopping.`;
            logWarn(msg);
            return { level: "critical", message: msg };
        }

        // ── Detector 3: Generic repeat (same tool+args) ──
        const repeatCount = this.history.filter(
            (h) => h.toolName === toolName && h.argsHash === argsHash,
        ).length;
        if (repeatCount >= CRITICAL_THRESHOLD) {
            const msg = `LOOP DETECTED: ${toolName} repeated ${repeatCount} times with same args. Stopping.`;
            logWarn(msg);
            return { level: "critical", message: msg };
        }
        if (repeatCount >= WARNING_THRESHOLD) {
            const key = `repeat:${argsHash}`;
            if (!this.warningsSent.has(key)) {
                this.warningsSent.add(key);
                const msg = `WARNING: ${toolName} repeated ${repeatCount} times. Consider a different approach.`;
                logWarn(msg);
                return { level: "warning", message: msg };
            }
        }

        return { level: "ok" };
    }

    /**
     * Record a tool call after execution.
     * Call this AFTER executing the tool with the result hash.
     */
    record(toolName: string, args: unknown, resultContent: string): void {
        const argsHash = hashToolCall(toolName, args);
        const resultHash = quickHash(resultContent);

        this.history.push({
            argsHash,
            toolName,
            resultHash,
            timestamp: Date.now(),
        });

        // Sliding window
        if (this.history.length > HISTORY_SIZE) {
            this.history.shift();
        }
    }

    /** Get current stats for debugging. */
    stats(): { total: number; unique: number } {
        const unique = new Set(this.history.map((h) => h.argsHash)).size;
        return { total: this.history.length, unique };
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private getNoProgressStreak(toolName: string, argsHash: string): number {
        let streak = 0;
        let lastResultHash: string | undefined;

        for (let i = this.history.length - 1; i >= 0; i--) {
            const record = this.history[i];
            if (!record || record.toolName !== toolName || record.argsHash !== argsHash) continue;
            if (!record.resultHash) continue;

            if (!lastResultHash) {
                lastResultHash = record.resultHash;
                streak = 1;
                continue;
            }
            if (record.resultHash !== lastResultHash) break;
            streak++;
        }
        return streak;
    }

    private getPingPongCount(currentHash: string): number {
        if (this.history.length < 2) return 0;

        const last = this.history[this.history.length - 1];
        if (!last || last.argsHash === currentHash) return 0;

        const otherHash = last.argsHash;
        let alternating = 0;

        for (let i = this.history.length - 1; i >= 0; i--) {
            const record = this.history[i];
            if (!record) continue;
            const expected = alternating % 2 === 0 ? otherHash : currentHash;
            if (record.argsHash !== expected) break;
            alternating++;
        }

        // +1 for the current call
        return alternating >= 2 ? alternating + 1 : 0;
    }
}

// ─── Hash Helpers ────────────────────────────────────────────────────────────

function hashToolCall(toolName: string, args: unknown): string {
    return `${toolName}:${quickHash(stableStringify(args))}`;
}

function quickHash(input: string): string {
    return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function stableStringify(value: unknown): string {
    if (value === null || value === undefined) return String(value);
    if (typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _detector: LoopDetector | null = null;

export function getLoopDetector(): LoopDetector {
    if (!_detector) _detector = new LoopDetector();
    return _detector;
}

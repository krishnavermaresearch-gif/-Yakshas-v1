/**
 * Trajectory Recorder — captures full visual agent trajectories for RLHF.
 *
 * Each trajectory = a complete task execution with:
 *  - Screenshots before/after every action
 *  - UI accessibility tree state
 *  - Tool name + args + result
 *  - Final reward score
 *
 * This data is the gold standard for training agentic AI models.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { resolve } from "path";
import { logInfo, logDebug } from "../logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TrajectoryFrame {
    timestamp: number;
    /** Base64 screenshot BEFORE action (optional — may be omitted for speed) */
    screenshotBefore?: string;
    /** Accessibility tree snapshot */
    uiTreeSnippet?: string;
    /** The action taken */
    action: {
        tool: string;
        args: Record<string, unknown>;
    };
    /** Tool result (truncated) */
    result: string;
    /** Base64 screenshot AFTER action (optional) */
    screenshotAfter?: string;
    /** Time the action took */
    durationMs: number;
}

export interface Trajectory {
    id: string;
    task: string;
    frames: TrajectoryFrame[];
    reward: number;
    success: boolean;
    metadata: {
        model: string;
        totalDurationMs: number;
        totalToolCalls: number;
        timestamp: number;
        deviceInfo?: string;
    };
}

export interface TrajectoryStats {
    totalTrajectories: number;
    successfulTrajectories: number;
    totalFrames: number;
    avgReward: number;
    diskUsageMB: number;
}

// ─── Recorder ────────────────────────────────────────────────────────────────

export class TrajectoryRecorder {
    private enabled: boolean;
    private currentFrames: TrajectoryFrame[] = [];
    private currentTask = "";
    private recordingId = "";
    private readonly dataDir: string;
    private captureScreenshots: boolean;

    constructor(dataDir?: string) {
        this.dataDir = dataDir ?? resolve(process.cwd(), "data", "trajectories");
        this.enabled = process.env.TELEMETRY_ENABLED !== "false"; // on by default
        this.captureScreenshots = process.env.TELEMETRY_SCREENSHOTS !== "false";
        if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
    }

    isEnabled(): boolean { return this.enabled; }
    setEnabled(val: boolean): void { this.enabled = val; }

    /** Start recording a new trajectory */
    startRecording(task: string): void {
        if (!this.enabled) return;
        this.currentTask = task;
        this.currentFrames = [];
        this.recordingId = `traj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        logDebug(`Trajectory recording started: ${this.recordingId}`);
    }

    /** Record a single frame (one tool call) */
    recordFrame(frame: {
        tool: string;
        args: Record<string, unknown>;
        result: string;
        durationMs: number;
        screenshotBefore?: string;
        screenshotAfter?: string;
        uiTreeSnippet?: string;
    }): void {
        if (!this.enabled || !this.recordingId) return;

        this.currentFrames.push({
            timestamp: Date.now(),
            action: { tool: frame.tool, args: frame.args },
            result: frame.result.slice(0, 500), // truncate for storage
            durationMs: frame.durationMs,
            ...(this.captureScreenshots && frame.screenshotBefore
                ? { screenshotBefore: frame.screenshotBefore }
                : {}),
            ...(this.captureScreenshots && frame.screenshotAfter
                ? { screenshotAfter: frame.screenshotAfter }
                : {}),
            ...(frame.uiTreeSnippet ? { uiTreeSnippet: frame.uiTreeSnippet.slice(0, 1000) } : {}),
        });
    }

    /** Finish recording and save trajectory to disk */
    finishRecording(result: {
        success: boolean;
        reward: number;
        model: string;
        totalDurationMs: number;
    }): Trajectory | null {
        if (!this.enabled || !this.recordingId || this.currentFrames.length === 0) {
            this.reset();
            return null;
        }

        const trajectory: Trajectory = {
            id: this.recordingId,
            task: this.currentTask,
            frames: this.currentFrames,
            reward: result.reward,
            success: result.success,
            metadata: {
                model: result.model,
                totalDurationMs: result.totalDurationMs,
                totalToolCalls: this.currentFrames.length,
                timestamp: Date.now(),
            },
        };

        this.saveTrajectory(trajectory);
        logInfo(`Trajectory saved: ${trajectory.id} (${trajectory.frames.length} frames, reward=${trajectory.reward.toFixed(2)})`);

        this.reset();
        return trajectory;
    }

    /** Get statistics about stored trajectories */
    getStats(): TrajectoryStats {
        const files = this.listTrajectoryFiles();
        let totalFrames = 0;
        let successCount = 0;
        let totalReward = 0;
        let diskBytes = 0;
        let parsedCount = 0;

        for (const file of files) {
            try {
                const fullPath = resolve(this.dataDir, file);
                const content = readFileSync(fullPath, "utf-8");
                diskBytes += content.length;
                const traj = JSON.parse(content) as Trajectory;
                parsedCount++;
                totalFrames += traj.frames.length;
                totalReward += traj.reward;
                if (traj.success) successCount++;
            } catch {
                // skip corrupt files
            }
        }

        return {
            totalTrajectories: parsedCount,
            successfulTrajectories: successCount,
            totalFrames,
            avgReward: parsedCount > 0 ? totalReward / parsedCount : 0,
            diskUsageMB: Math.round((diskBytes / 1024 / 1024) * 100) / 100,
        };
    }

    /** Load a specific trajectory */
    loadTrajectory(id: string): Trajectory | null {
        const filePath = resolve(this.dataDir, `${id}.json`);
        if (!existsSync(filePath)) return null;
        try {
            return JSON.parse(readFileSync(filePath, "utf-8")) as Trajectory;
        } catch {
            return null;
        }
    }

    /** List all trajectory IDs */
    listTrajectoryIds(): string[] {
        return this.listTrajectoryFiles().map(f => f.replace(".json", ""));
    }

    /** Export all trajectories as JSONL (standard RLHF format) */
    exportAsJsonl(outputPath?: string): string {
        const files = this.listTrajectoryFiles();
        const outFile = outputPath ?? resolve(this.dataDir, `export_${Date.now()}.jsonl`);
        const lines: string[] = [];

        for (const file of files) {
            try {
                const content = readFileSync(resolve(this.dataDir, file), "utf-8");
                const traj = JSON.parse(content) as Trajectory;
                // Strip screenshots for JSONL export (too large)
                const stripped = {
                    ...traj,
                    frames: traj.frames.map(f => ({
                        ...f,
                        screenshotBefore: undefined,
                        screenshotAfter: undefined,
                    })),
                };
                lines.push(JSON.stringify(stripped));
            } catch {
                // skip
            }
        }

        writeFileSync(outFile, lines.join("\n"), "utf-8");
        logInfo(`Exported ${lines.length} trajectories to ${outFile}`);
        return outFile;
    }

    // ── Private ──────────────────────────────────────────────────────────

    private saveTrajectory(trajectory: Trajectory): void {
        const filePath = resolve(this.dataDir, `${trajectory.id}.json`);
        writeFileSync(filePath, JSON.stringify(trajectory, null, 2), "utf-8");
    }

    private listTrajectoryFiles(): string[] {
        try {
            return readdirSync(this.dataDir).filter(f => f.endsWith(".json") && f.startsWith("traj_"));
        } catch {
            return [];
        }
    }

    private reset(): void {
        this.currentFrames = [];
        this.currentTask = "";
        this.recordingId = "";
    }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _recorder: TrajectoryRecorder | null = null;

export function getTrajectoryRecorder(): TrajectoryRecorder {
    if (!_recorder) _recorder = new TrajectoryRecorder();
    return _recorder;
}

export function resetTrajectoryRecorder(): void {
    _recorder = null;
}

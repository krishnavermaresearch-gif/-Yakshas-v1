/**
 * Cron Scheduler — enables the agent to schedule proactive tasks.
 *
 * Features:
 * - Simple cron expressions (minute, hour, day-of-week support)
 * - One-shot and recurring jobs
 * - Jobs persisted to disk in data/cron-jobs.json
 * - Fires jobs through the orchestrator
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { logInfo, logWarn, logError } from "../logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CronJob {
    id: string;
    /** Cron expression: "minute hour day-of-week" or "once:ISO-timestamp" */
    expression: string;
    /** Task description to execute (sent to orchestrator) */
    task: string;
    /** Human-readable description */
    description: string;
    /** Whether this is a one-shot job */
    oneShot: boolean;
    createdAt: number;
    lastRunAt?: number;
    enabled: boolean;
}

export type CronJobCallback = (job: CronJob) => Promise<void>;

// ─── Scheduler ───────────────────────────────────────────────────────────────

const DATA_DIR = resolve(process.cwd(), "data");
const JOBS_FILE = resolve(DATA_DIR, "cron-jobs.json");

export class CronScheduler {
    private jobs: Map<string, CronJob> = new Map();
    private timer: ReturnType<typeof setInterval> | null = null;
    private onFire: CronJobCallback | null = null;

    constructor() {
        this.load();
    }

    /** Set the callback for when a job fires. */
    setCallback(cb: CronJobCallback): void {
        this.onFire = cb;
    }

    /** Add a new cron job. Returns the job ID. */
    addJob(options: {
        expression: string;
        task: string;
        description: string;
        oneShot?: boolean;
    }): CronJob {
        const id = `cron_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const job: CronJob = {
            id,
            expression: options.expression,
            task: options.task,
            description: options.description,
            oneShot: options.oneShot ?? false,
            createdAt: Date.now(),
            enabled: true,
        };
        this.jobs.set(id, job);
        this.save();
        logInfo(`Cron job added: [${id}] "${options.description}" (${options.expression})`);
        return job;
    }

    /** Remove a job by ID. */
    removeJob(id: string): boolean {
        const deleted = this.jobs.delete(id);
        if (deleted) {
            this.save();
            logInfo(`Cron job removed: ${id}`);
        }
        return deleted;
    }

    /** List all jobs. */
    listJobs(): CronJob[] {
        return Array.from(this.jobs.values());
    }

    /** Start the scheduler tick (checks every 30 seconds). */
    start(): void {
        if (this.timer) return;
        this.timer = setInterval(() => this.tick(), 30_000);
        logInfo(`Cron scheduler started (${this.jobs.size} jobs loaded)`);
        // Run an immediate tick
        this.tick();
    }

    /** Stop the scheduler. */
    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            logInfo("Cron scheduler stopped");
        }
    }

    // ── Tick ──────────────────────────────────────────────────────────────────

    private tick(): void {
        const now = new Date();
        for (const job of this.jobs.values()) {
            if (!job.enabled) continue;
            if (this.shouldFire(job, now)) {
                this.fireJob(job);
            }
        }
    }

    private shouldFire(job: CronJob, now: Date): boolean {
        // One-shot: "once:2025-02-20T17:00:00"
        if (job.expression.startsWith("once:")) {
            const targetTime = new Date(job.expression.slice(5)).getTime();
            if (isNaN(targetTime)) return false;
            if (job.lastRunAt) return false; // already fired
            return now.getTime() >= targetTime;
        }

        // Relative one-shot: "in:60000" (milliseconds from creation)
        if (job.expression.startsWith("in:")) {
            const delayMs = parseInt(job.expression.slice(3), 10);
            if (isNaN(delayMs)) return false;
            if (job.lastRunAt) return false;
            return now.getTime() >= job.createdAt + delayMs;
        }

        // Simple cron: "minute hour day-of-week" (* = any)
        const parts = job.expression.split(/\s+/);
        if (parts.length < 2) return false;

        const [cronMin, cronHour, cronDow] = parts;
        const currentMin = now.getMinutes();
        const currentHour = now.getHours();
        const currentDow = now.getDay(); // 0=Sun

        if (!matchField(cronMin!, currentMin)) return false;
        if (!matchField(cronHour!, currentHour)) return false;
        if (cronDow && cronDow !== "*" && !matchField(cronDow, currentDow)) return false;

        // Prevent double-firing within the same minute
        if (job.lastRunAt) {
            const lastRun = new Date(job.lastRunAt);
            if (
                lastRun.getMinutes() === currentMin &&
                lastRun.getHours() === currentHour &&
                lastRun.getDate() === now.getDate()
            ) {
                return false;
            }
        }

        return true;
    }

    private async fireJob(job: CronJob): Promise<void> {
        logInfo(`🔔 Cron firing: "${job.description}"`);
        job.lastRunAt = Date.now();

        if (job.oneShot || job.expression.startsWith("once:") || job.expression.startsWith("in:")) {
            job.enabled = false; // one-shot: disable after firing
        }

        this.save();

        if (this.onFire) {
            try {
                await this.onFire(job);
            } catch (err) {
                logError(`Cron job error [${job.id}]: ${err instanceof Error ? err.message : err}`);
            }
        }
    }

    // ── Persistence ──────────────────────────────────────────────────────────

    private load(): void {
        try {
            if (existsSync(JOBS_FILE)) {
                const raw = readFileSync(JOBS_FILE, "utf-8");
                const jobs = JSON.parse(raw) as CronJob[];
                for (const job of jobs) {
                    this.jobs.set(job.id, job);
                }
            }
        } catch (err) {
            logWarn(`Failed to load cron jobs: ${err instanceof Error ? err.message : err}`);
        }
    }

    private save(): void {
        try {
            if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
            writeFileSync(JOBS_FILE, JSON.stringify(Array.from(this.jobs.values()), null, 2));
        } catch (err) {
            logWarn(`Failed to save cron jobs: ${err instanceof Error ? err.message : err}`);
        }
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function matchField(cronField: string, value: number): boolean {
    if (cronField === "*") return true;
    // Support comma-separated values: "0,15,30,45"
    const parts = cronField.split(",");
    return parts.some((p) => {
        // Range: "9-17"
        if (p.includes("-")) {
            const [lo, hi] = p.split("-").map(Number);
            return !isNaN(lo!) && !isNaN(hi!) && value >= lo! && value <= hi!;
        }
        // Step: "*/5"
        if (p.startsWith("*/")) {
            const step = Number(p.slice(2));
            return !isNaN(step) && step > 0 && value % step === 0;
        }
        return Number(p) === value;
    });
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _scheduler: CronScheduler | null = null;

export function getCronScheduler(): CronScheduler {
    if (!_scheduler) _scheduler = new CronScheduler();
    return _scheduler;
}

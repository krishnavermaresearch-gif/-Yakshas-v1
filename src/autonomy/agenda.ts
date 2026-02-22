/**
 * Goal Agenda — persistent, prioritized goals that the agent pursues
 * autonomously over time.
 *
 * Goals are higher-level than cron jobs. A goal like "keep me informed about
 * WhatsApp messages" decomposes into recurring check tasks automatically.
 *
 * Features:
 *  - Persistent goal storage (data/goals.json)
 *  - Priority-based ordering
 *  - Automatic decomposition into scheduled subtasks via LLM
 *  - Progress tracking and completion detection
 *  - Max-check limits to prevent infinite goal loops
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { logError, logInfo, logWarn } from "../logger.js";
import { getLLMProvider } from "../llm/provider-factory.js";
import { getCronScheduler } from "../cron/scheduler.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type GoalStatus = "active" | "paused" | "completed" | "failed";

export type GoalSubtask = {
    description: string;
    cronJobId?: string;
    completed: boolean;
};

export type Goal = {
    id: string;
    name: string;
    description: string;          // natural language objective
    status: GoalStatus;
    priority: number;             // 1 (highest) to 10 (lowest)
    checkExpression?: string;     // cron expression for periodic checking
    successCriteria: string;      // how to know when the goal is met
    subtasks: GoalSubtask[];
    createdAt: number;
    completedAt?: number;
    lastCheckedAt?: number;
    checkCount: number;
    maxChecks?: number;           // stop trying after N checks (prevent infinite loops)
};

export type GoalCheckCallback = (goal: Goal) => Promise<{
    completed: boolean;
    message: string;
}>;

// ─── Config ──────────────────────────────────────────────────────────────────

const DATA_DIR = resolve(process.cwd(), "data");
const GOALS_FILE = resolve(DATA_DIR, "goals.json");

// ─── Agenda Manager ──────────────────────────────────────────────────────────

export class AgendaManager {
    private goals: Map<string, Goal> = new Map();
    private checkCallback: GoalCheckCallback | null = null;

    constructor() {
        this.load();
    }

    /** Set the callback used to check goal progress via the orchestrator. */
    setCheckCallback(cb: GoalCheckCallback): void {
        this.checkCallback = cb;
    }

    // ── Goal CRUD ────────────────────────────────────────────────────────────

    addGoal(options: {
        name: string;
        description: string;
        successCriteria: string;
        priority?: number;
        checkExpression?: string;
        maxChecks?: number;
    }): Goal {
        const id = `goal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const goal: Goal = {
            id,
            name: options.name,
            description: options.description,
            status: "active",
            priority: Math.min(10, Math.max(1, options.priority ?? 5)),
            checkExpression: options.checkExpression,
            successCriteria: options.successCriteria,
            subtasks: [],
            createdAt: Date.now(),
            checkCount: 0,
            maxChecks: options.maxChecks,
        };

        this.goals.set(id, goal);

        // Auto-schedule periodic checking if an expression is provided
        if (goal.checkExpression) {
            this.scheduleGoalCheck(goal);
        }

        this.save();
        logInfo(`Goal added: "${goal.name}" (priority: ${goal.priority})`);
        return goal;
    }

    removeGoal(id: string): boolean {
        const goal = this.goals.get(id);
        if (!goal) return false;

        // Clean up associated cron jobs
        const scheduler = getCronScheduler();
        for (const subtask of goal.subtasks) {
            if (subtask.cronJobId) {
                scheduler.removeJob(subtask.cronJobId);
            }
        }
        // Remove the goal check cron job
        scheduler.removeJob(`goalcheck_${id}`);

        this.goals.delete(id);
        this.save();
        logInfo(`Goal removed: "${goal.name}"`);
        return true;
    }

    getGoal(id: string): Goal | undefined {
        return this.goals.get(id);
    }

    listGoals(statusFilter?: GoalStatus): Goal[] {
        const all = Array.from(this.goals.values());
        const filtered = statusFilter ? all.filter((g) => g.status === statusFilter) : all;
        return filtered.sort((a, b) => a.priority - b.priority);
    }

    pauseGoal(id: string): boolean {
        const goal = this.goals.get(id);
        if (!goal || goal.status !== "active") return false;
        goal.status = "paused";
        this.save();
        return true;
    }

    resumeGoal(id: string): boolean {
        const goal = this.goals.get(id);
        if (!goal || goal.status !== "paused") return false;
        goal.status = "active";
        this.save();
        return true;
    }

    // ── Goal Checking ────────────────────────────────────────────────────────

    /**
     * Check if a goal has been achieved.
     * Called by the cron scheduler or manually.
     */
    async checkGoal(id: string): Promise<{ completed: boolean; message: string }> {
        const goal = this.goals.get(id);
        if (!goal) return { completed: false, message: "Goal not found" };
        if (goal.status !== "active") return { completed: false, message: `Goal is ${goal.status}` };

        // Max check limit
        if (goal.maxChecks && goal.checkCount >= goal.maxChecks) {
            goal.status = "failed";
            this.save();
            return { completed: false, message: `Goal exceeded max checks (${goal.maxChecks})` };
        }

        goal.checkCount++;
        goal.lastCheckedAt = Date.now();

        if (!this.checkCallback) {
            this.save();
            return { completed: false, message: "No check callback configured" };
        }

        try {
            const result = await this.checkCallback(goal);

            if (result.completed) {
                goal.status = "completed";
                goal.completedAt = Date.now();
                logInfo(`🎯 Goal completed: "${goal.name}"`);
            }

            this.save();
            return result;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logError(`Goal check failed for "${goal.name}": ${msg}`);
            this.save();
            return { completed: false, message: `Check failed: ${msg}` };
        }
    }

    /**
     * Tick — called periodically to check if any goals need attention.
     * Goals without a cron expression are checked here on a priority basis.
     */
    async tick(): Promise<void> {
        const activeGoals = this.listGoals("active");
        const needsCheck = activeGoals.filter((g) => {
            if (g.checkExpression) return false; // handled by cron
            if (!g.lastCheckedAt) return true;   // never checked
            // Check unscheduled goals every 5 minutes
            return Date.now() - g.lastCheckedAt > 5 * 60_000;
        });

        for (const goal of needsCheck.slice(0, 3)) { // max 3 per tick
            await this.checkGoal(goal.id);
        }
    }

    // ── Goal Decomposition ───────────────────────────────────────────────────

    /**
     * Use LLM to break a goal into actionable subtasks.
     */
    async decomposeGoal(id: string): Promise<GoalSubtask[]> {
        const goal = this.goals.get(id);
        if (!goal) return [];

        try {
            const llm = getLLMProvider();
            const response = await llm.ask(
                "You are a task planner for a phone-controlling AI agent. " +
                "Break down the following goal into 2-5 concrete, actionable subtasks. " +
                "Each subtask should be something the agent can execute directly on the phone. " +
                "Return ONLY a JSON array of strings, each describing one subtask.\n" +
                "Example: [\"Open WhatsApp\", \"Check latest messages\", \"Reply to unread messages\"]",
                `Goal: ${goal.name}\nDescription: ${goal.description}\nSuccess criteria: ${goal.successCriteria}`,
            );

            // Parse LLM response as JSON array
            const jsonMatch = response.match(/\[[\s\S]*\]/);
            if (!jsonMatch) {
                logWarn(`Goal decomposition returned non-JSON: ${response.slice(0, 200)}`);
                return [];
            }

            const subtaskDescriptions = JSON.parse(jsonMatch[0]) as string[];
            const subtasks: GoalSubtask[] = subtaskDescriptions.map((desc) => ({
                description: desc,
                completed: false,
            }));

            goal.subtasks = subtasks;
            this.save();
            logInfo(`Goal "${goal.name}" decomposed into ${subtasks.length} subtasks`);
            return subtasks;
        } catch (err) {
            logError(`Goal decomposition failed: ${err instanceof Error ? err.message : err}`);
            return [];
        }
    }

    // ── Scheduling ───────────────────────────────────────────────────────────

    private scheduleGoalCheck(goal: Goal): void {
        const scheduler = getCronScheduler();
        const jobId = `goalcheck_${goal.id}`;

        // Remove existing job if any
        scheduler.removeJob(jobId);

        scheduler.addJob({
            expression: goal.checkExpression!,
            task: `[GOAL CHECK] Check progress on goal: "${goal.name}". ${goal.description}. Success criteria: ${goal.successCriteria}`,
            description: `Goal check: ${goal.name}`,
        });

        logInfo(`Scheduled goal check for "${goal.name}" with expression: ${goal.checkExpression}`);
    }

    /**
     * Initialize the agenda — wire up cron callbacks for goal checking.
     */
    start(): void {
        // Re-schedule any active goals that have check expressions
        for (const goal of this.goals.values()) {
            if (goal.status === "active" && goal.checkExpression) {
                this.scheduleGoalCheck(goal);
            }
        }
        logInfo(`Agenda manager started with ${this.goals.size} goals`);
    }

    // ── Persistence ──────────────────────────────────────────────────────────

    private load(): void {
        try {
            if (existsSync(GOALS_FILE)) {
                const data = JSON.parse(readFileSync(GOALS_FILE, "utf-8")) as Goal[];
                this.goals = new Map(data.map((g) => [g.id, g]));
                logInfo(`Loaded ${this.goals.size} goals`);
            }
        } catch (err) {
            logWarn(`Failed to load goals: ${err instanceof Error ? err.message : err}`);
        }
    }

    private save(): void {
        try {
            if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
            const data = Array.from(this.goals.values());
            writeFileSync(GOALS_FILE, JSON.stringify(data, null, 2), "utf-8");
        } catch (err) {
            logWarn(`Failed to save goals: ${err instanceof Error ? err.message : err}`);
        }
    }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _agenda: AgendaManager | null = null;

export function getAgendaManager(): AgendaManager {
    if (!_agenda) _agenda = new AgendaManager();
    return _agenda;
}

export function resetAgendaManager(): void {
    _agenda = null;
}

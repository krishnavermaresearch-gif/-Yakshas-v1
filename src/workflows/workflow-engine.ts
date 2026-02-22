/**
 * Workflow Engine — multi-step, crash-safe state machine for complex B2B automations.
 *
 * Supports:
 *  - Multi-step workflows that survive reboots (persisted to disk)
 *  - Cross-app data flow (context carries data between steps)
 *  - Conditional branching (if/then/else based on step results)
 *  - Trigger-based waits (pause until event, then resume)
 *
 * Example workflow:
 *  "Watch competitor Instagram → screenshot → OCR → translate → draft response in Docs → alert on Telegram"
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { resolve } from "path";
import { logInfo, logError } from "../logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "waiting_trigger";

export interface WorkflowStep {
    id: string;
    /** Natural language description of what to do */
    instruction: string;
    /** Optional tool name — if set, auto-execute this tool */
    tool?: string;
    /** Tool args template — can reference {{context.var}} for interpolation */
    toolArgs?: Record<string, unknown>;
    /** Condition to check before running (JavaScript-like expression in context) */
    condition?: string;
    /** Status tracking */
    status: StepStatus;
    /** Result from execution */
    result?: string;
    /** Error message if failed */
    error?: string;
    /** Time when step started */
    startedAt?: number;
    /** Time when step completed */
    completedAt?: number;
    /** Optional: wait for this event type before running */
    waitForEvent?: string;
}

export type WorkflowStatus = "created" | "running" | "paused" | "waiting_trigger" | "completed" | "failed" | "cancelled";

export interface Workflow {
    id: string;
    name: string;
    description: string;
    steps: WorkflowStep[];
    currentStepIndex: number;
    status: WorkflowStatus;
    /** Shared context — data flows between steps */
    context: Record<string, unknown>;
    /** Creation timestamp */
    createdAt: number;
    /** Last activity timestamp */
    lastStepAt: number;
    /** Optional: repeat on a schedule (cron expression) */
    repeatCron?: string;
    /** Total execution count */
    executionCount: number;
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export class WorkflowEngine {
    private workflows = new Map<string, Workflow>();
    private readonly dataDir: string;
    private executeCallback: ((instruction: string, context: Record<string, unknown>) => Promise<string>) | null = null;

    constructor(dataDir?: string) {
        this.dataDir = dataDir ?? resolve(process.cwd(), "data", "workflows");
        if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
        this.loadAll();
    }

    /** Set the callback that executes a step instruction */
    setExecutor(fn: (instruction: string, context: Record<string, unknown>) => Promise<string>): void {
        this.executeCallback = fn;
    }

    /** Create a new workflow from natural language steps */
    create(config: {
        name: string;
        description: string;
        steps: Array<{
            instruction: string;
            tool?: string;
            toolArgs?: Record<string, unknown>;
            condition?: string;
            waitForEvent?: string;
        }>;
        repeatCron?: string;
    }): Workflow {
        const id = `wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const workflow: Workflow = {
            id,
            name: config.name,
            description: config.description,
            steps: config.steps.map((s, i) => ({
                id: `step_${i}`,
                instruction: s.instruction,
                tool: s.tool,
                toolArgs: s.toolArgs,
                condition: s.condition,
                status: "pending" as StepStatus,
                waitForEvent: s.waitForEvent,
            })),
            currentStepIndex: 0,
            status: "created",
            context: {},
            createdAt: Date.now(),
            lastStepAt: Date.now(),
            executionCount: 0,
        };

        this.workflows.set(id, workflow);
        this.save(workflow);
        logInfo(`Workflow created: "${workflow.name}" (${workflow.steps.length} steps)`);
        return workflow;
    }

    /** Run the next pending step in a workflow */
    async executeNextStep(workflowId: string): Promise<{ done: boolean; stepResult?: string }> {
        const workflow = this.workflows.get(workflowId);
        if (!workflow) throw new Error(`Workflow "${workflowId}" not found`);
        if (workflow.status === "completed" || workflow.status === "cancelled" || workflow.status === "failed") {
            return { done: true };
        }

        const stepIndex = workflow.currentStepIndex;
        if (stepIndex >= workflow.steps.length) {
            workflow.status = "completed";
            this.save(workflow);
            return { done: true };
        }

        const step = workflow.steps[stepIndex]!;

        // Check if waiting for event
        if (step.waitForEvent && step.status !== "running") {
            workflow.status = "waiting_trigger";
            step.status = "waiting_trigger";
            this.save(workflow);
            logInfo(`Workflow "${workflow.name}" waiting for event: ${step.waitForEvent}`);
            return { done: false, stepResult: `Waiting for event: ${step.waitForEvent}` };
        }

        // Check condition
        if (step.condition) {
            const conditionMet = this.evaluateCondition(step.condition, workflow.context);
            if (!conditionMet) {
                step.status = "skipped";
                step.completedAt = Date.now();
                workflow.currentStepIndex++;
                this.save(workflow);
                logInfo(`Step ${stepIndex} skipped (condition not met): ${step.condition}`);
                return { done: false, stepResult: "Step skipped (condition not met)" };
            }
        }

        // Execute step
        step.status = "running";
        step.startedAt = Date.now();
        workflow.status = "running";
        this.save(workflow);

        try {
            let result: string;

            if (this.executeCallback) {
                // Interpolate context into instruction
                const instruction = this.interpolate(step.instruction, workflow.context);
                result = await this.executeCallback(instruction, workflow.context);
            } else {
                result = `[Mock] Executed: ${step.instruction}`;
            }

            step.status = "completed";
            step.result = result;
            step.completedAt = Date.now();
            workflow.context[`step_${stepIndex}_result`] = result;
            workflow.currentStepIndex++;
            workflow.lastStepAt = Date.now();

            // Check if all done
            if (workflow.currentStepIndex >= workflow.steps.length) {
                workflow.status = "completed";
                workflow.executionCount++;
            }

            this.save(workflow);
            logInfo(`Workflow "${workflow.name}" step ${stepIndex} completed`);
            return { done: workflow.status === "completed", stepResult: result };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            step.status = "failed";
            step.error = msg;
            step.completedAt = Date.now();
            workflow.status = "failed";
            this.save(workflow);
            logError(`Workflow "${workflow.name}" step ${stepIndex} failed: ${msg}`);
            return { done: true, stepResult: `Error: ${msg}` };
        }
    }

    /** Run all steps in sequence until done or waiting */
    async executeAll(workflowId: string): Promise<Workflow> {
        let done = false;
        while (!done) {
            const result = await this.executeNextStep(workflowId);
            done = result.done || this.get(workflowId)?.status === "waiting_trigger";
        }
        return this.get(workflowId)!;
    }

    /** Resume a workflow that was waiting for an event */
    resumeFromEvent(workflowId: string, eventData?: Record<string, unknown>): void {
        const workflow = this.workflows.get(workflowId);
        if (!workflow || workflow.status !== "waiting_trigger") return;

        const step = workflow.steps[workflow.currentStepIndex];
        if (step) {
            step.status = "pending";
            if (eventData) {
                Object.assign(workflow.context, eventData);
            }
        }
        workflow.status = "running";
        this.save(workflow);
        logInfo(`Workflow "${workflow.name}" resumed from event`);
    }

    /** Cancel a workflow */
    cancel(workflowId: string): boolean {
        const workflow = this.workflows.get(workflowId);
        if (!workflow) return false;
        workflow.status = "cancelled";
        this.save(workflow);
        logInfo(`Workflow cancelled: "${workflow.name}"`);
        return true;
    }

    get(id: string): Workflow | undefined {
        return this.workflows.get(id);
    }

    getByName(name: string): Workflow | undefined {
        for (const wf of this.workflows.values()) {
            if (wf.name.toLowerCase() === name.toLowerCase()) return wf;
        }
        return undefined;
    }

    list(): Workflow[] {
        return Array.from(this.workflows.values());
    }

    listActive(): Workflow[] {
        return this.list().filter(w => w.status === "running" || w.status === "waiting_trigger" || w.status === "created");
    }

    remove(id: string): boolean {
        const removed = this.workflows.delete(id);
        if (removed) {
            try { unlinkSync(resolve(this.dataDir, `${id}.json`)); } catch { /* ignore */ }
        }
        return removed;
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    /** Simple context interpolation: {{context.key}} → value */
    interpolate(text: string, context: Record<string, unknown>): string {
        return text.replace(/\{\{context\.(\w+)\}\}/g, (_match, key) => {
            return String(context[key] ?? `{{context.${key}}}`);
        });
    }

    /** Simple condition evaluation against context */
    evaluateCondition(condition: string, context: Record<string, unknown>): boolean {
        try {
            // Support simple conditions: "key exists", "key == value", "key contains value"
            const existsMatch = condition.match(/^(\w+)\s+exists$/);
            if (existsMatch) return context[existsMatch[1]!] !== undefined;

            const eqMatch = condition.match(/^(\w+)\s*==\s*(.+)$/);
            if (eqMatch) return String(context[eqMatch[1]!]) === eqMatch[2]!.trim();

            const containsMatch = condition.match(/^(\w+)\s+contains\s+(.+)$/);
            if (containsMatch) return String(context[containsMatch[1]!] ?? "").includes(containsMatch[2]!.trim());

            // Default: treat as truthy check
            return Boolean(context[condition]);
        } catch {
            return true; // on error, don't skip
        }
    }

    private save(workflow: Workflow): void {
        const filePath = resolve(this.dataDir, `${workflow.id}.json`);
        writeFileSync(filePath, JSON.stringify(workflow, null, 2), "utf-8");
    }

    private loadAll(): void {
        try {
            const files = readdirSync(this.dataDir).filter(f => f.startsWith("wf_") && f.endsWith(".json"));
            for (const file of files) {
                try {
                    const content = readFileSync(resolve(this.dataDir, file), "utf-8");
                    const wf = JSON.parse(content) as Workflow;
                    this.workflows.set(wf.id, wf);
                } catch { /* skip corrupt */ }
            }
            if (this.workflows.size > 0) {
                logInfo(`Loaded ${this.workflows.size} workflows`);
            }
        } catch { /* dir doesn't exist yet */ }
    }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _engine: WorkflowEngine | null = null;

export function getWorkflowEngine(): WorkflowEngine {
    if (!_engine) _engine = new WorkflowEngine();
    return _engine;
}

export function resetWorkflowEngine(): void {
    _engine = null;
}

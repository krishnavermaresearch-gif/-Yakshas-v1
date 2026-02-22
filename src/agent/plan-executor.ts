/**
 * Plan-Execute-Report Engine — LLM plans ONCE, executor runs deterministically.
 *
 * Architecture:
 *  1. PLAN: LLM receives user task → returns structured JSON action plan (1 call)
 *  2. EXECUTE: Deterministic executor runs each step — no LLM in the loop
 *  3. REPORT: LLM summarizes what happened (1 call)
 *
 * For a task like "open 5 apps and wait 10s in each":
 *  Before: 15+ LLM calls, 150-300s
 *  After: 2 LLM calls (plan + report), ~60s
 *
 * Falls back to iterative runner for ambiguous/reactive tasks.
 */

import { logInfo, logWarn, logError } from "../logger.js";
import { getLLMProvider } from "../llm/provider-factory.js";
import type { ChatMessage } from "../llm/llm-provider.js";
import { type ToolRegistry, type ToolResult } from "./tool-registry.js";
import type { ToolStep } from "../learning/experience-store.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PlanStep {
    /** Tool name to execute */
    tool: string;
    /** Arguments to pass */
    args: Record<string, unknown>;
    /** Whether this step can run in parallel with other "parallel" steps */
    parallel?: boolean;
    /** Human-readable description of what this step does */
    description?: string;
}

export interface ExecutionPlan {
    /** Whether the task can be planned deterministically */
    canPlan: boolean;
    /** Ordered list of steps to execute */
    steps: PlanStep[];
    /** Why this approach was chosen */
    reasoning: string;
}

export interface PlanExecuteResult {
    success: boolean;
    message: string;
    plan: ExecutionPlan;
    stepResults: Array<{ step: PlanStep; result: ToolResult; durationMs: number }>;
    toolSteps: ToolStep[];
    totalDurationMs: number;
}

// ─── Phone vs API classification ─────────────────────────────────────────────

const PHONE_TOOLS = new Set([
    "adb_screenshot", "adb_ui_tree", "adb_tap", "adb_swipe", "adb_type",
    "adb_key", "adb_app_launch", "adb_app_close", "adb_shell", "adb_wait",
]);

function isPhoneTool(name: string): boolean {
    return PHONE_TOOLS.has(name) || name.startsWith("adb_");
}

// ─── Plan Generator ──────────────────────────────────────────────────────────

const PLAN_SYSTEM_PROMPT = `You are a task planner for a phone automation agent. Given a user's request, output a structured JSON execution plan.

RULES:
1. Output ONLY valid JSON — no markdown, no explanation outside JSON
2. Each step must reference an exact tool name with correct arguments
3. Phone tools (adb_*) must run sequentially — set "parallel": false
4. API tools (gmail_*, calendar_*, drive_*, soul_*) can run in parallel — set "parallel": true
5. If the task is ambiguous or requires reading screen content to decide what to do next, set "canPlan": false
6. For simple deterministic tasks (open apps, type text, check APIs), set "canPlan": true

Available tools (use exact names):
- adb_app_launch({"package": "com.whatsapp"}) — open an app
- adb_wait({"ms": 5000}) — wait milliseconds
- adb_screenshot({"max_width": 720}) — take screenshot
- adb_tap({"x": 360, "y": 800}) — tap coordinates
- adb_type({"text": "hello", "clear_first": false}) — type text
- adb_ui_tree({"max_elements": 200}) — read UI structure
- adb_swipe({"x1":360,"y1":1400,"x2":360,"y2":600,"duration_ms":500}) — swipe
- adb_key({"key":"back"}) — press key (back/home/enter)
- gmail_inbox({"max_results":5}) — list inbox
- gmail_search({"query":"is:unread","max_results":5}) — search emails
- calendar_create({"title":"...","start_time":"...","end_time":"..."}) — create event
- drive_list({"max_results":10}) — list drive files
- soul_observe_start({}) — start observer
- soul_observe_stop({}) — stop observer
- soul_build({"name":"..."}) — build soul
- soul_status({}) — soul status
- soul_predict({"question":"..."}) — predict behavior
- telemetry_toggle({"enabled":"true"}) — toggle recording
- workflow_create({...}) — create workflow

OUTPUT FORMAT:
{
  "canPlan": true,
  "steps": [
    {"tool": "tool_name", "args": {...}, "parallel": false, "description": "what this does"}
  ],
  "reasoning": "brief explanation"
}`;

export async function generatePlan(
    userMessage: string,
    registry: ToolRegistry,
): Promise<ExecutionPlan> {
    const llm = getLLMProvider();
    const startTime = Date.now();

    const messages: ChatMessage[] = [
        { role: "system", content: PLAN_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
    ];

    try {
        const response = await llm.chat(messages, []);
        const text = response.message.content?.trim() ?? "";
        logInfo(`Plan generated in ${Date.now() - startTime}ms`);

        // Parse JSON — handle markdown code fences
        const jsonStr = text.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "").trim();
        const plan = JSON.parse(jsonStr) as ExecutionPlan;

        // Validate: ensure all tools exist in registry
        const validSteps = plan.steps.filter(s => {
            if (!registry.get(s.tool)) {
                logWarn(`Plan references unknown tool: ${s.tool} — skipping`);
                return false;
            }
            return true;
        });

        return {
            canPlan: plan.canPlan,
            steps: validSteps,
            reasoning: plan.reasoning ?? "",
        };
    } catch (err) {
        logWarn(`Plan generation failed: ${err instanceof Error ? err.message : err}`);
        return { canPlan: false, steps: [], reasoning: "Failed to generate plan" };
    }
}

// ─── Deterministic Executor ──────────────────────────────────────────────────

export async function executePlan(
    plan: ExecutionPlan,
    registry: ToolRegistry,
    onProgress?: (step: PlanStep, index: number, result: ToolResult) => void,
): Promise<PlanExecuteResult> {
    const startTime = Date.now();
    const stepResults: PlanExecuteResult["stepResults"] = [];
    const toolSteps: ToolStep[] = [];

    // Separate into sequential and parallel groups
    const groups: Array<{ steps: PlanStep[]; parallel: boolean }> = [];
    let currentGroup: PlanStep[] = [];
    let currentParallel = false;

    for (const step of plan.steps) {
        const stepParallel = step.parallel === true && !isPhoneTool(step.tool);

        if (currentGroup.length === 0) {
            currentParallel = stepParallel;
            currentGroup.push(step);
        } else if (stepParallel === currentParallel) {
            currentGroup.push(step);
        } else {
            groups.push({ steps: currentGroup, parallel: currentParallel });
            currentGroup = [step];
            currentParallel = stepParallel;
        }
    }
    if (currentGroup.length > 0) {
        groups.push({ steps: currentGroup, parallel: currentParallel });
    }

    // Execute groups
    let success = true;
    for (const group of groups) {
        if (group.parallel && group.steps.length > 1) {
            // Run in parallel
            logInfo(`⚡ Executing ${group.steps.length} steps in PARALLEL`);
            const promises = group.steps.map(async (step, _i) => {
                const stepStart = Date.now();
                try {
                    const result = await registry.execute(step.tool, step.args);
                    const duration = Date.now() - stepStart;
                    logInfo(`  ✓ ${step.tool} (${duration}ms)`);
                    return { step, result, durationMs: duration };
                } catch (err) {
                    const duration = Date.now() - stepStart;
                    logError(`  ✗ ${step.tool}: ${err instanceof Error ? err.message : err}`);
                    return {
                        step,
                        result: { type: "text" as const, content: `Error: ${err instanceof Error ? err.message : err}` },
                        durationMs: duration,
                    };
                }
            });

            const results = await Promise.all(promises);
            for (const r of results) {
                stepResults.push(r);
                toolSteps.push({
                    tool: r.step.tool,
                    args: r.step.args,
                    result: r.result.content.slice(0, 200),
                    durationMs: r.durationMs,
                });
                onProgress?.(r.step, stepResults.length - 1, r.result);
            }
        } else {
            // Run sequentially
            for (const step of group.steps) {
                const stepStart = Date.now();
                try {
                    logInfo(`▶ ${step.tool}(${JSON.stringify(step.args).slice(0, 80)})`);
                    const result = await registry.execute(step.tool, step.args);
                    const duration = Date.now() - stepStart;
                    stepResults.push({ step, result, durationMs: duration });
                    toolSteps.push({
                        tool: step.tool,
                        args: step.args,
                        result: result.content.slice(0, 200),
                        durationMs: duration,
                    });
                    onProgress?.(step, stepResults.length - 1, result);
                } catch (err) {
                    const duration = Date.now() - stepStart;
                    logError(`✗ ${step.tool}: ${err instanceof Error ? err.message : err}`);
                    success = false;
                    stepResults.push({
                        step,
                        result: { type: "text", content: `Error: ${err instanceof Error ? err.message : err}` },
                        durationMs: duration,
                    });
                    toolSteps.push({
                        tool: step.tool,
                        args: step.args,
                        result: `Error: ${err instanceof Error ? err.message : err}`,
                        durationMs: duration,
                    });
                }
            }
        }
    }

    return {
        success,
        message: success ? `Executed ${plan.steps.length} steps` : "Some steps failed",
        plan,
        stepResults,
        toolSteps,
        totalDurationMs: Date.now() - startTime,
    };
}

// ─── Report Generator ────────────────────────────────────────────────────────

export async function generateReport(
    userMessage: string,
    result: PlanExecuteResult,
): Promise<string> {
    const llm = getLLMProvider();

    const stepSummary = result.stepResults.map((r, i) =>
        `Step ${i + 1}: ${r.step.tool} → ${r.result.content.slice(0, 150)}`
    ).join("\n");

    const messages: ChatMessage[] = [
        {
            role: "system",
            content: "Summarize what was accomplished. Be concise and helpful. Include key results and data.",
        },
        {
            role: "user",
            content: `Task: "${userMessage}"\n\nExecution Results (${result.totalDurationMs}ms, ${result.stepResults.length} steps):\n${stepSummary}`,
        },
    ];

    try {
        const response = await llm.chat(messages, []);
        return response.message.content ?? "Task completed.";
    } catch {
        return `Executed ${result.stepResults.length} steps in ${result.totalDurationMs}ms.`;
    }
}

// ─── Full Pipeline ───────────────────────────────────────────────────────────

/**
 * Full Plan-Execute-Report pipeline.
 * Returns null if the task should fall back to the iterative runner.
 */
export async function planExecuteReport(
    userMessage: string,
    registry: ToolRegistry,
    onProgress?: (step: PlanStep, index: number, result: ToolResult) => void,
): Promise<PlanExecuteResult | null> {
    logInfo(`🧠 Planning: "${userMessage.slice(0, 80)}..."`);

    // Step 1: Generate plan
    const plan = await generatePlan(userMessage, registry);

    if (!plan.canPlan || plan.steps.length === 0) {
        logInfo(`📋 Plan says: cannot plan deterministically → falling back to iterative runner`);
        return null; // Signal to use the traditional runner
    }

    logInfo(`📋 Plan: ${plan.steps.length} steps (${plan.reasoning})`);

    // Step 2: Execute deterministically
    const result = await executePlan(plan, registry, onProgress);

    // Step 3: Generate report
    logInfo(`📝 Generating report...`);
    result.message = await generateReport(userMessage, result);

    logInfo(`✅ Plan-Execute-Report complete: ${result.stepResults.length} steps in ${result.totalDurationMs}ms`);
    return result;
}

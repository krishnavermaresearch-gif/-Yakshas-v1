/**
 * Micro-Agent System — ephemeral sub-agents for parallel subtask decomposition.
 *
 * The main orchestrator can spawn micro-agents for complex tasks:
 * - Each micro-agent has a focused scope (one subtask)
 * - Planning/analysis tasks run in parallel
 * - Phone interaction tasks run sequentially (ADB is single-threaded)
 * - When done, results are saved to memory and the micro-agent is destroyed
 *
 * Architecture:
 *   Main Agent → decomposes task → spawns MicroAgents → collects results → responds
 */

import { logInfo, logDebug } from "../logger.js";
import { runAgent } from "./runner.js";
import { type ToolRegistry } from "./tool-registry.js";
import { getMemoryManager } from "../memory/memory-manager.js";
import type { ToolStep } from "../learning/experience-store.js";
import type { RunnerResult } from "./runner.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type MicroAgentTask = {
    id: string;
    description: string;
    /** Whether this task needs phone access (sequential) or is analysis-only (parallel) */
    requiresPhone: boolean;
    /** Priority: higher = runs first */
    priority: number;
    /** Parent task context */
    parentContext?: string;
};

export type MicroAgentResult = {
    taskId: string;
    description: string;
    success: boolean;
    message: string;
    toolSteps: ToolStep[];
    durationMs: number;
};

export type DecompositionResult = {
    shouldDecompose: boolean;
    subtasks: MicroAgentTask[];
    reasoning: string;
};

// ─── Micro-Agent Spawner ─────────────────────────────────────────────────────

export class MicroAgentSpawner {
    private activeAgents = new Map<string, MicroAgentTask>();

    /**
     * Decompose a complex task into micro-agent subtasks.
     * Uses heuristics to decide if decomposition is beneficial.
     */
    decompose(userMessage: string): DecompositionResult {
        const lower = userMessage.toLowerCase();

        // Detect multi-app or multi-step tasks
        const appMentions = this.detectApps(lower);
        const stepIndicators = (lower.match(/\b(then|after that|also|and then|next|finally|first|second|third)\b/g) ?? []).length;
        const conjunctions = (lower.match(/\band\b/g) ?? []).length;

        // Don't decompose simple tasks
        if (appMentions.length <= 1 && stepIndicators === 0 && conjunctions <= 1) {
            return { shouldDecompose: false, subtasks: [], reasoning: "Simple single-step task" };
        }

        const subtasks: MicroAgentTask[] = [];

        // Strategy 1: Multi-app tasks → one micro-agent per app
        if (appMentions.length > 1) {
            // Split by app mentions
            const segments = this.splitByApps(userMessage, appMentions);
            for (let i = 0; i < segments.length; i++) {
                subtasks.push({
                    id: `micro-${Date.now()}-${i}`,
                    description: segments[i]!,
                    requiresPhone: true,
                    priority: segments.length - i, // First mentioned = highest priority
                    parentContext: userMessage,
                });
            }
        }
        // Strategy 2: Sequential "then" tasks
        else if (stepIndicators > 0) {
            const steps = userMessage.split(/\b(?:then|after that|and then|next|finally)\b/i).filter((s) => s.trim());
            for (let i = 0; i < steps.length; i++) {
                subtasks.push({
                    id: `micro-${Date.now()}-${i}`,
                    description: steps[i]!.trim(),
                    requiresPhone: true,
                    priority: steps.length - i,
                    parentContext: userMessage,
                });
            }
        }
        // Strategy 3: "and" compound tasks
        else if (conjunctions > 1) {
            const parts = userMessage.split(/\band\b/i).filter((s) => s.trim().length > 5);
            for (let i = 0; i < parts.length; i++) {
                subtasks.push({
                    id: `micro-${Date.now()}-${i}`,
                    description: parts[i]!.trim(),
                    requiresPhone: this.needsPhone(parts[i]!),
                    priority: parts.length - i,
                    parentContext: userMessage,
                });
            }
        }

        return {
            shouldDecompose: subtasks.length > 1,
            subtasks,
            reasoning: `Decomposed into ${subtasks.length} subtasks (${appMentions.length} apps, ${stepIndicators} step indicators)`,
        };
    }

    /**
     * Execute subtasks with micro-agents.
     * Phone tasks run sequentially; analysis tasks can overlap.
     */
    async execute(
        subtasks: MicroAgentTask[],
        systemPrompt: string,
        registry: ToolRegistry,
        chatId?: number,
        onProgress?: (taskId: string, status: string) => void,
    ): Promise<MicroAgentResult[]> {
        const results: MicroAgentResult[] = [];

        // Sort by priority (highest first)
        const sorted = [...subtasks].sort((a, b) => b.priority - a.priority);

        // Separate phone tasks (sequential) and analysis tasks (parallel)
        const phoneTasks = sorted.filter((t) => t.requiresPhone);
        const analysisTasks = sorted.filter((t) => !t.requiresPhone);

        logInfo(`MicroAgent: ${phoneTasks.length} phone tasks (seq), ${analysisTasks.length} analysis tasks (parallel)`);

        // Run analysis tasks in parallel
        const analysisPromises = analysisTasks.map((task) => this.runMicroAgent(task, systemPrompt, registry, chatId, onProgress));

        // Run phone tasks sequentially
        for (const task of phoneTasks) {
            const result = await this.runMicroAgent(task, systemPrompt, registry, chatId, onProgress);
            results.push(result);
        }

        // Collect analysis results
        const analysisResults = await Promise.allSettled(analysisPromises);
        for (const ar of analysisResults) {
            if (ar.status === "fulfilled") {
                results.push(ar.value);
            }
        }

        // Save all results to memory
        await this.saveResults(results, chatId);

        return results;
    }

    /** Get count of active micro-agents. */
    get activeCount(): number {
        return this.activeAgents.size;
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    private async runMicroAgent(
        task: MicroAgentTask,
        systemPrompt: string,
        registry: ToolRegistry,
        _chatId?: number,
        onProgress?: (taskId: string, status: string) => void,
    ): Promise<MicroAgentResult> {
        this.activeAgents.set(task.id, task);
        logInfo(`MicroAgent ${task.id} spawned: "${task.description.slice(0, 60)}"`);
        onProgress?.(task.id, `Starting: ${task.description.slice(0, 50)}`);

        const microPrompt = `${systemPrompt}\n\n## Micro-Agent Context\nYou are a focused micro-agent handling ONE specific subtask.\nOriginal user request: "${task.parentContext ?? task.description}"\nYour specific subtask: "${task.description}"\n\nFocus ONLY on your subtask. Be efficient — complete it quickly and report back.`;

        const startTime = Date.now();
        let result: RunnerResult;

        try {
            result = await runAgent(task.description, {
                systemPrompt: microPrompt,
                registry,
                maxIterations: 15, // Micro-agents have smaller budgets
            });
        } catch (err) {
            result = {
                success: false,
                message: `Micro-agent failed: ${err instanceof Error ? err.message : String(err)}`,
                toolCallCount: 0,
                iterationCount: 0,
                toolSteps: [],
                durationMs: Date.now() - startTime,
            };
        }

        // Destroy micro-agent
        this.activeAgents.delete(task.id);
        logInfo(`MicroAgent ${task.id} completed (${result.success ? "✓" : "✗"}) in ${result.durationMs}ms`);
        onProgress?.(task.id, result.success ? "Completed ✓" : "Failed ✗");

        return {
            taskId: task.id,
            description: task.description,
            success: result.success,
            message: result.message,
            toolSteps: result.toolSteps,
            durationMs: result.durationMs,
        };
    }

    private async saveResults(results: MicroAgentResult[], _chatId?: number): Promise<void> {
        const memory = getMemoryManager();

        for (const r of results) {
            try {
                const summary = `[MicroAgent] Task: "${r.description}" → ${r.success ? "Success" : "Failed"}: ${r.message.slice(0, 200)}`;
                await memory.addTaskResult(r.description, summary, _chatId);
            } catch {
                logDebug(`Failed to save micro-agent result to memory`);
            }
        }

        memory.save();
    }

    /**
     * Format micro-agent results into a combined response.
     */
    static formatResults(results: MicroAgentResult[]): string {
        if (results.length === 0) return "No subtasks were executed.";
        if (results.length === 1) return results[0]!.message;

        const parts = results.map((r, i) => {
            const icon = r.success ? "✅" : "❌";
            return `${icon} **Step ${i + 1}:** ${r.description}\n${r.message}`;
        });

        const successCount = results.filter((r) => r.success).length;
        return `Completed ${successCount}/${results.length} subtasks:\n\n${parts.join("\n\n")}`;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private detectApps(text: string): string[] {
        const apps: string[] = [];
        const appPatterns: [RegExp, string][] = [
            [/\bwhatsapp\b/, "whatsapp"],
            [/\binstagram\b|\binsta\b/, "instagram"],
            [/\byoutube\b/, "youtube"],
            [/\bgmail\b|\bemail\b|\bmail\b/, "gmail"],
            [/\bchrome\b|\bbrowser\b/, "chrome"],
            [/\bcamera\b/, "camera"],
            [/\bspotify\b|\bmusic\b/, "spotify"],
            [/\btelegram\b/, "telegram"],
            [/\bsettings\b/, "settings"],
            [/\bmaps\b|\bgoogle maps\b/, "maps"],
            [/\btwitter\b|\b(x app)\b/, "twitter"],
            [/\bfacebook\b|\bfb\b/, "facebook"],
            [/\bsnapchat\b/, "snapchat"],
            [/\btiktok\b/, "tiktok"],
        ];

        for (const [pattern, name] of appPatterns) {
            if (pattern.test(text)) apps.push(name);
        }

        return apps;
    }

    private splitByApps(text: string, apps: string[]): string[] {
        // Simple split: if text mentions multiple apps, try to split at "and" or "then"
        const parts = text.split(/\b(?:and|then|after that|also|,)\b/i).filter((s) => s.trim().length > 5);
        if (parts.length > 1) return parts.map((p) => p.trim());

        // If can't split nicely, return subtask per app
        return apps.map((app) => `Handle the ${app} part of: ${text}`);
    }

    private needsPhone(text: string): boolean {
        const phoneActions = /\b(tap|open|launch|click|type|swipe|screenshot|send|call|navigate|scroll|install)\b/i;
        return phoneActions.test(text);
    }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _spawner: MicroAgentSpawner | null = null;

export function getMicroAgentSpawner(): MicroAgentSpawner {
    if (!_spawner) {
        _spawner = new MicroAgentSpawner();
    }
    return _spawner;
}

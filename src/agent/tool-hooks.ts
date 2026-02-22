/**
 * Tool Hooks System — before/after hooks for every tool execution.
 *
 * Inspired by OpenClaw's `pi-tools.before-tool-call.ts` wrapper pattern.
 * Hooks can:
 *  - Block tool execution (return { blocked: true, reason })
 *  - Modify tool arguments (return { blocked: false, args: modified })
 *  - Log tool calls and results
 *  - Transform tool results after execution
 */

import { logInfo, logWarn, logDebug } from "../logger.js";
import type { ToolResult } from "./tool-registry.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type HookOutcome =
    | { blocked: true; reason: string }
    | { blocked: false; args: Record<string, unknown> };

export interface BeforeHookContext {
    toolName: string;
    args: Record<string, unknown>;
    /** Caller context (e.g., "runner", "plan-executor") */
    caller?: string;
}

export interface AfterHookContext {
    toolName: string;
    args: Record<string, unknown>;
    result: ToolResult;
    durationMs: number;
    caller?: string;
}

export interface ToolHook {
    /** Unique hook name */
    name: string;
    /** Priority — lower runs first (default: 100) */
    priority?: number;
    /** Runs before tool execution — can block or modify args */
    before?: (ctx: BeforeHookContext) => Promise<HookOutcome> | HookOutcome;
    /** Runs after tool execution — can log or transform result */
    after?: (ctx: AfterHookContext) => Promise<ToolResult> | ToolResult;
}

// ─── Hook Registry ───────────────────────────────────────────────────────────

export class HookRegistry {
    private hooks: ToolHook[] = [];

    /** Register a hook */
    add(hook: ToolHook): void {
        // Remove existing hook with same name (update)
        this.hooks = this.hooks.filter(h => h.name !== hook.name);
        this.hooks.push(hook);
        this.hooks.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
        logDebug(`🪝 Hook registered: ${hook.name} (priority: ${hook.priority ?? 100})`);
    }

    /** Remove a hook by name */
    remove(name: string): boolean {
        const before = this.hooks.length;
        this.hooks = this.hooks.filter(h => h.name !== name);
        return this.hooks.length < before;
    }

    /** List registered hooks */
    list(): string[] {
        return this.hooks.map(h => h.name);
    }

    /** Run all before hooks — first block stops execution */
    async runBefore(toolName: string, args: Record<string, unknown>, caller?: string): Promise<HookOutcome> {
        let currentArgs = { ...args };

        for (const hook of this.hooks) {
            if (!hook.before) continue;
            try {
                const outcome = await hook.before({ toolName, args: currentArgs, caller });
                if (outcome.blocked) {
                    logWarn(`🪝 Tool "${toolName}" BLOCKED by hook "${hook.name}": ${outcome.reason}`);
                    return outcome;
                }
                // Hook may have modified args
                currentArgs = outcome.args;
            } catch (err) {
                logWarn(`🪝 Hook "${hook.name}" before() error: ${err instanceof Error ? err.message : err}`);
                // Hook errors don't block execution — fail open
            }
        }

        return { blocked: false, args: currentArgs };
    }

    /** Run all after hooks — transforms result through the pipeline */
    async runAfter(
        toolName: string,
        args: Record<string, unknown>,
        result: ToolResult,
        durationMs: number,
        caller?: string,
    ): Promise<ToolResult> {
        let currentResult = result;

        for (const hook of this.hooks) {
            if (!hook.after) continue;
            try {
                currentResult = await hook.after({
                    toolName,
                    args,
                    result: currentResult,
                    durationMs,
                    caller,
                });
            } catch (err) {
                logWarn(`🪝 Hook "${hook.name}" after() error: ${err instanceof Error ? err.message : err}`);
            }
        }

        return currentResult;
    }
}

// ─── Built-in Hooks ──────────────────────────────────────────────────────────

/** Logging hook — records all tool calls with timing */
export function createLoggingHook(): ToolHook {
    const execLog: Array<{
        timestamp: number;
        tool: string;
        args: Record<string, unknown>;
        durationMs: number;
        success: boolean;
        resultPreview: string;
    }> = [];

    return {
        name: "builtin:logging",
        priority: 1, // Run first
        before: (ctx) => {
            logInfo(`🔧 [hook] Tool call: ${ctx.toolName}(${JSON.stringify(ctx.args).slice(0, 100)})`);
            return { blocked: false, args: ctx.args };
        },
        after: (ctx) => {
            const success = !ctx.result.content.startsWith("Error");
            execLog.push({
                timestamp: Date.now(),
                tool: ctx.toolName,
                args: ctx.args,
                durationMs: ctx.durationMs,
                success,
                resultPreview: ctx.result.content.slice(0, 200),
            });

            // Keep log bounded
            if (execLog.length > 1000) execLog.splice(0, 500);

            return ctx.result;
        },
    };
}

/** Deny list hook — blocks specific tools */
export function createDenyListHook(denyList: string[]): ToolHook {
    const denied = new Set(denyList.map(t => t.toLowerCase()));

    return {
        name: "builtin:deny-list",
        priority: 10,
        before: (ctx) => {
            if (denied.has(ctx.toolName.toLowerCase())) {
                return { blocked: true, reason: `Tool "${ctx.toolName}" is in the deny list` };
            }
            return { blocked: false, args: ctx.args };
        },
    };
}

/** Rate limit hook — prevents excessive tool calls */
export function createRateLimitHook(maxCallsPerMinute: number = 60): ToolHook {
    const callTimestamps: number[] = [];

    return {
        name: "builtin:rate-limit",
        priority: 5,
        before: (ctx) => {
            const now = Date.now();
            // Remove timestamps older than 1 minute
            while (callTimestamps.length > 0 && callTimestamps[0]! < now - 60_000) {
                callTimestamps.shift();
            }

            if (callTimestamps.length >= maxCallsPerMinute) {
                return {
                    blocked: true,
                    reason: `Rate limit exceeded: ${maxCallsPerMinute} calls/minute. Try again shortly.`,
                };
            }

            callTimestamps.push(now);
            return { blocked: false, args: ctx.args };
        },
    };
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _registry: HookRegistry | null = null;

export function getHookRegistry(): HookRegistry {
    if (!_registry) {
        _registry = new HookRegistry();
        // Register built-in hooks
        _registry.add(createLoggingHook());
    }
    return _registry;
}

export function resetHookRegistry(): void {
    _registry = null;
}

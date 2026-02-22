import { logDebug, logError, logInfo, logWarn } from "../logger.js";
import { getLLMProvider } from "../llm/provider-factory.js";
import type { ChatMessage, ToolDef } from "../llm/llm-provider.js";
import { type ToolRegistry, type ToolResult } from "./tool-registry.js";
import type { ToolStep } from "../learning/experience-store.js";
import { getLoopDetector } from "./loop-detector.js";
import { shouldCompact, compactMessages } from "./compaction.js";
import { getHookRegistry } from "./tool-hooks.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type RunnerOptions = {
    systemPrompt: string;
    registry: ToolRegistry;
    maxIterations?: number;
    /** Called after each tool execution — use for progress updates */
    onToolResult?: (toolName: string, result: ToolResult) => void;
    /** Called when the agent sends a text message */
    onMessage?: (text: string) => void;
    /** Base64 images to include in the user message for vision analysis */
    images?: string[];
};

export type RunnerResult = {
    success: boolean;
    message: string;
    toolCallCount: number;
    iterationCount: number;
    /** Last screenshot taken during execution (if any) */
    lastScreenshot?: Buffer;
    /** Detailed tool call steps for RL tracking */
    toolSteps: ToolStep[];
    /** Total execution time in ms */
    durationMs: number;
};

// ─── Agent Runner ────────────────────────────────────────────────────────────

/**
 * Execute a single task with the agent loop.
 * Inspired by OpenClaw's pi-embedded-runner:
 * 1. Send user message to Ollama with tools
 * 2. If Ollama returns tool calls → execute each → send results back
 * 3. Repeat until Ollama returns a text response (no more tool calls)
 * 4. Return final response
 */
export async function runAgent(
    userMessage: string,
    options: RunnerOptions,
): Promise<RunnerResult> {
    const {
        systemPrompt,
        registry,
        maxIterations = 25,
        onToolResult,
        onMessage,
        images,
    } = options;

    const llm = getLLMProvider();
    const tools: ToolDef[] = registry.toOllamaTools();

    // Build conversation history
    const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage, ...(images?.length ? { images } : {}) },
    ];

    let totalToolCalls = 0;
    let lastScreenshot: Buffer | undefined;
    const toolSteps: ToolStep[] = [];
    const startTime = Date.now();
    const loopDetector = getLoopDetector();
    loopDetector.reset(); // fresh state per task

    for (let iteration = 0; iteration < maxIterations; iteration++) {
        logInfo(`Agent iteration ${iteration + 1}/${maxIterations}`);

        // ── Context compaction: auto-summarize old messages when too long ──
        if (shouldCompact(messages)) {
            try {
                const compacted = await compactMessages(messages);
                messages.length = 0;
                messages.push(...compacted);
            } catch (err) {
                logWarn(`Compaction failed: ${err instanceof Error ? err.message : err}`);
            }
        }

        // Call LLM
        let response;
        try {
            response = await llm.chat(messages, tools);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logError(`LLM call failed: ${msg}`);
            return {
                success: false,
                message: `AI model error: ${msg}`,
                toolCallCount: totalToolCalls,
                iterationCount: iteration + 1,
                lastScreenshot,
                toolSteps,
                durationMs: Date.now() - startTime,
            };
        }

        const assistantMessage = response.message;

        // Add assistant's response to history
        messages.push(assistantMessage);

        // Check if there are tool calls
        const toolCalls = assistantMessage.tool_calls;
        if (!toolCalls || toolCalls.length === 0) {
            // No tool calls — the agent is done, this is the final response
            const finalText = assistantMessage.content || "(no response)";
            logInfo(`Agent completed after ${iteration + 1} iterations, ${totalToolCalls} tool calls`);
            onMessage?.(finalText);
            return {
                success: true,
                message: finalText,
                toolCallCount: totalToolCalls,
                iterationCount: iteration + 1,
                lastScreenshot,
                toolSteps,
                durationMs: Date.now() - startTime,
            };
        }

        // Execute tool calls — with parallel execution for API tools
        let loopBroken = false;

        // Classify tools: phone tools must be sequential; API tools can parallelize
        const isPhoneTool = (n: string) =>
            n.startsWith("adb_") || ["adb_screenshot", "adb_ui_tree", "adb_tap", "adb_swipe", "adb_type", "adb_key", "adb_app_launch", "adb_app_close", "adb_shell", "adb_wait"].includes(n);

        const phoneCalls = toolCalls.filter(tc => isPhoneTool(tc.function.name));
        const apiCalls = toolCalls.filter(tc => !isPhoneTool(tc.function.name));

        // Run API calls in parallel if there are multiple
        if (apiCalls.length > 1) {
            logInfo(`⚡ Executing ${apiCalls.length} API tools in PARALLEL`);
            const hooks = getHookRegistry();
            const apiPromises = apiCalls.map(async (toolCall) => {
                const { name, arguments: args } = toolCall.function;
                totalToolCalls++;
                const loopCheck = loopDetector.check(name, args);
                if (loopCheck.level === "critical") return { name, loopBroken: true, loopCheck };

                // ── Before hook ──
                const hookOutcome = await hooks.runBefore(name, (args ?? {}) as Record<string, unknown>, "runner");
                if (hookOutcome.blocked) {
                    return { name, args, result: { content: `🛡️ Blocked: ${hookOutcome.reason}` } as ToolResult, stepDuration: 0, loopBroken: false };
                }

                const stepStart = Date.now();
                let result = await registry.execute(name, hookOutcome.args);
                const stepDuration = Date.now() - stepStart;

                // ── After hook ──
                result = await hooks.runAfter(name, (args ?? {}) as Record<string, unknown>, result, stepDuration, "runner");

                loopDetector.record(name, args, result.content);
                return { name, args, result, stepDuration, loopBroken: false };
            });

            const apiResults = await Promise.all(apiPromises);
            for (const r of apiResults) {
                if (r.loopBroken) { loopBroken = true; break; }
                if (!r.result) continue;
                toolSteps.push({ tool: r.name, args: (r.args ?? {}) as Record<string, unknown>, result: r.result.content.slice(0, 200), durationMs: r.stepDuration! });
                if (r.result.buffer && r.name === "adb_screenshot") lastScreenshot = r.result.buffer;
                onToolResult?.(r.name, r.result);
                messages.push({ role: "tool", content: r.result.content, ...(r.result.image ? { images: [r.result.image.base64] } : {}) });
            }
        } else {
            // Single API call or no API calls — execute sequentially
            for (const toolCall of apiCalls) {
                const { name, arguments: args } = toolCall.function;
                totalToolCalls++;
                logInfo(`Tool call #${totalToolCalls}: ${name}(${JSON.stringify(args)})`);
                const loopCheck = loopDetector.check(name, args);
                if (loopCheck.level === "critical") {
                    messages.push({ role: "tool", content: `⚠️ ${loopCheck.message} You MUST try a completely different approach or report that the task cannot be completed.` });
                    loopBroken = true; break;
                }
                if (loopCheck.level === "warning") messages.push({ role: "tool", content: `⚠️ ${loopCheck.message}` });

                // ── Before hook ──
                const hooks = getHookRegistry();
                const hookOutcome = await hooks.runBefore(name, (args ?? {}) as Record<string, unknown>, "runner");
                if (hookOutcome.blocked) {
                    messages.push({ role: "tool", content: `🛡️ Blocked: ${hookOutcome.reason}` });
                    continue;
                }

                const stepStart = Date.now();
                let result = await registry.execute(name, hookOutcome.args);
                const stepDuration = Date.now() - stepStart;

                // ── After hook ──
                result = await hooks.runAfter(name, (args ?? {}) as Record<string, unknown>, result, stepDuration, "runner");

                loopDetector.record(name, args, result.content);
                toolSteps.push({ tool: name, args: (args ?? {}) as Record<string, unknown>, result: result.content.slice(0, 200), durationMs: stepDuration });
                if (result.buffer && name === "adb_screenshot") lastScreenshot = result.buffer;
                onToolResult?.(name, result);
                messages.push({ role: "tool", content: result.content, ...(result.image ? { images: [result.image.base64] } : {}) });
                logDebug(`Tool ${name} result: ${result.content.slice(0, 200)}`);
            }
        }

        // Phone calls always run sequentially (can't tap two things at once)
        if (!loopBroken) {
            for (const toolCall of phoneCalls) {
                const { name, arguments: args } = toolCall.function;
                totalToolCalls++;
                logInfo(`Tool call #${totalToolCalls}: ${name}(${JSON.stringify(args)})`);
                const loopCheck = loopDetector.check(name, args);
                if (loopCheck.level === "critical") {
                    messages.push({ role: "tool", content: `⚠️ ${loopCheck.message} You MUST try a completely different approach or report that the task cannot be completed.` });
                    loopBroken = true; break;
                }
                if (loopCheck.level === "warning") messages.push({ role: "tool", content: `⚠️ ${loopCheck.message}` });

                // ── Before hook ──
                const hooks = getHookRegistry();
                const hookOutcome = await hooks.runBefore(name, (args ?? {}) as Record<string, unknown>, "runner");
                if (hookOutcome.blocked) {
                    messages.push({ role: "tool", content: `🛡️ Blocked: ${hookOutcome.reason}` });
                    continue;
                }

                const stepStart = Date.now();
                let result = await registry.execute(name, hookOutcome.args);
                const stepDuration = Date.now() - stepStart;

                // ── After hook ──
                result = await hooks.runAfter(name, (args ?? {}) as Record<string, unknown>, result, stepDuration, "runner");

                loopDetector.record(name, args, result.content);
                toolSteps.push({ tool: name, args: (args ?? {}) as Record<string, unknown>, result: result.content.slice(0, 200), durationMs: stepDuration });
                if (result.buffer && name === "adb_screenshot") lastScreenshot = result.buffer;
                onToolResult?.(name, result);
                messages.push({ role: "tool", content: result.content, ...(result.image ? { images: [result.image.base64] } : {}) });
                logDebug(`Tool ${name} result: ${result.content.slice(0, 200)}`);
            }
        }

        // If loop was broken, give the agent one more chance to respond
        if (loopBroken) {
            logWarn("Loop detected — giving agent one final chance to respond");
            // Continue to next iteration so agent sees the warning and can wrap up
        }
    }

    // Hit max iterations
    logWarn(`Agent hit max iterations (${maxIterations})`);
    return {
        success: false,
        message: `Task incomplete: reached maximum of ${maxIterations} iterations with ${totalToolCalls} tool calls. The task may be too complex.`,
        toolCallCount: totalToolCalls,
        iterationCount: maxIterations,
        lastScreenshot,
        toolSteps,
        durationMs: Date.now() - startTime,
    };
}

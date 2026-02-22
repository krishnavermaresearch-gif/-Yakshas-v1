/**
 * Streaming Runner — executes tool calls as they stream from the LLM.
 *
 * Instead of waiting for the complete LLM response, this runner:
 * 1. Opens a streaming connection to the LLM
 * 2. As tool calls arrive, executes them immediately
 * 3. Sends tool results back for the next iteration
 *
 * Falls back to the regular runner if the provider doesn't support streaming.
 */

import { logInfo } from "../logger.js";
import { getLLMProvider } from "../llm/provider-factory.js";
import type { ChatMessage, ToolDef, ToolCall } from "../llm/llm-provider.js";
import { type ToolRegistry, type ToolResult } from "./tool-registry.js";
import type { ToolStep } from "../learning/experience-store.js";
import { getHookRegistry } from "./tool-hooks.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StreamingRunnerOptions {
    systemPrompt: string;
    registry: ToolRegistry;
    maxIterations?: number;
    onToolResult?: (toolName: string, result: ToolResult) => void;
    onMessage?: (text: string) => void;
    /** Called with each text chunk as it arrives — for real-time UI streaming */
    onTextChunk?: (text: string) => void;
}

export interface StreamingRunnerResult {
    success: boolean;
    message: string;
    toolCallCount: number;
    iterationCount: number;
    lastScreenshot?: Buffer;
    toolSteps: ToolStep[];
    durationMs: number;
    /** Whether streaming was actually used (vs fallback) */
    streamed: boolean;
}

// ─── Streaming Runner ────────────────────────────────────────────────────────

export async function runAgentStreaming(
    userMessage: string,
    options: StreamingRunnerOptions,
): Promise<StreamingRunnerResult> {
    const {
        systemPrompt,
        registry,
        maxIterations = 15,
        onToolResult,
        onMessage,
        onTextChunk,
    } = options;

    const provider = getLLMProvider();

    // Check if provider supports streaming
    if (!provider.chatStream) {
        logInfo("⚡ Provider doesn't support streaming — falling back to regular runner");
        const { runAgent } = await import("./runner.js");
        const result = await runAgent(userMessage, {
            systemPrompt,
            registry,
            maxIterations,
            onToolResult,
            onMessage,
        });
        return { ...result, streamed: false };
    }

    logInfo(`⚡ Streaming runner started for: "${userMessage.slice(0, 80)}..."`);
    const startMs = Date.now();
    const tools: ToolDef[] = registry.toOllamaTools();
    const hooks = getHookRegistry();

    let messages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
    ];

    let totalToolCalls = 0;
    let lastScreenshot: Buffer | undefined;
    const toolSteps: ToolStep[] = [];
    let finalMessage = "";

    for (let iteration = 0; iteration < maxIterations; iteration++) {
        logInfo(`⚡ Stream iteration ${iteration + 1}/${maxIterations}`);

        let textAccumulator = "";
        const iterationToolCalls: ToolCall[] = [];

        // Stream from LLM
        for await (const chunk of provider.chatStream(messages, tools)) {
            if (chunk.type === "text") {
                textAccumulator += chunk.content;
                onTextChunk?.(chunk.content);
            } else if (chunk.type === "tool_call") {
                iterationToolCalls.push(chunk.tool_call);
            } else if (chunk.type === "done") {
                // Add the full assistant message to history
                if (chunk.fullMessage) {
                    messages.push(chunk.fullMessage);
                }
            }
        }

        // No tool calls — we're done
        if (iterationToolCalls.length === 0) {
            finalMessage = textAccumulator;
            onMessage?.(finalMessage);
            break;
        }

        // Execute tool calls with hooks
        for (const toolCall of iterationToolCalls) {
            const { name, arguments: args } = toolCall.function;
            totalToolCalls++;
            logInfo(`⚡ Stream tool #${totalToolCalls}: ${name}`);

            // Before hook
            const hookOutcome = await hooks.runBefore(name, (args ?? {}) as Record<string, unknown>, "streaming-runner");
            if (hookOutcome.blocked) {
                messages.push({ role: "tool", content: `🛡️ Blocked: ${hookOutcome.reason}` });
                continue;
            }

            const stepStart = Date.now();
            let result = await registry.execute(name, hookOutcome.args);
            const stepDuration = Date.now() - stepStart;

            // After hook
            result = await hooks.runAfter(name, (args ?? {}) as Record<string, unknown>, result, stepDuration, "streaming-runner");

            toolSteps.push({
                tool: name,
                args: (args ?? {}) as Record<string, unknown>,
                result: result.content.slice(0, 200),
                durationMs: stepDuration,
            });

            if (result.buffer && name === "adb_screenshot") lastScreenshot = result.buffer;
            onToolResult?.(name, result);

            messages.push({
                role: "tool",
                content: result.content,
                ...(result.image ? { images: [result.image.base64] } : {}),
            });
        }
    }

    const durationMs = Date.now() - startMs;
    logInfo(`⚡ Streaming runner: ${totalToolCalls} tool calls in ${durationMs}ms`);

    return {
        success: true,
        message: finalMessage || "Task completed via streaming execution",
        toolCallCount: totalToolCalls,
        iterationCount: Math.min(maxIterations, totalToolCalls + 1),
        lastScreenshot,
        toolSteps,
        durationMs,
        streamed: true,
    };
}

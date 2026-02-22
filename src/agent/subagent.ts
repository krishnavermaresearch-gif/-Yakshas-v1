/**
 * Sub-Agent System — delegate complex tasks to autonomous child agents.
 *
 * The main agent can spawn sub-agents that have access to ALL tools
 * (including code execution, browser, file I/O, dynamic tool creation).
 * Sub-agents run independently and return their result to the parent.
 *
 * Multi-modal: sub-agents can receive images, file paths, and context.
 */

import { logInfo } from "../logger.js";
import { getLLMProvider } from "../llm/provider-factory.js";
import type { ChatMessage, ToolDef } from "../llm/llm-provider.js";
import type { ToolRegistry, ToolDefinition, ToolResult } from "./tool-registry.js";
import { getHookRegistry } from "./tool-hooks.js";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, basename } from "node:path";

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_SUBAGENT_ITERATIONS = 15;
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"];

// ─── Multi-Modal Input Processing ────────────────────────────────────────────

interface ProcessedAttachment {
    type: "text" | "image";
    name: string;
    content: string;
    base64?: string;
}

function processAttachments(paths: string[]): ProcessedAttachment[] {
    const results: ProcessedAttachment[] = [];

    for (const filePath of paths) {
        if (!existsSync(filePath)) {
            results.push({ type: "text", name: basename(filePath), content: `[File not found: ${filePath}]` });
            continue;
        }

        const stat = statSync(filePath);
        if (stat.size > 5 * 1024 * 1024) {
            results.push({ type: "text", name: basename(filePath), content: `[File too large: ${(stat.size / 1024 / 1024).toFixed(1)} MB]` });
            continue;
        }

        const ext = extname(filePath).toLowerCase();

        // Images → base64
        if (IMAGE_EXTENSIONS.includes(ext)) {
            const buffer = readFileSync(filePath);
            results.push({
                type: "image",
                name: basename(filePath),
                content: `[Image: ${basename(filePath)}]`,
                base64: buffer.toString("base64"),
            });
            continue;
        }

        // Text files
        try {
            const content = readFileSync(filePath, "utf-8");
            results.push({
                type: "text",
                name: basename(filePath),
                content: content.slice(0, 30_000),
            });
        } catch {
            results.push({ type: "text", name: basename(filePath), content: `[Binary file: ${basename(filePath)}, ${(stat.size / 1024).toFixed(1)} KB]` });
        }
    }

    return results;
}

// ─── Sub-Agent Runner ────────────────────────────────────────────────────────

async function runSubAgent(
    objective: string,
    context: string,
    attachments: string[],
    registry: ToolRegistry,
): Promise<{ success: boolean; result: string; toolCalls: number }> {
    const llm = getLLMProvider();
    const tools: ToolDef[] = registry.toOllamaTools();
    const hooks = getHookRegistry();

    // Build sub-agent system prompt
    const subAgentPrompt = `You are a Sub-Agent — an autonomous worker delegated a specific task.
You have access to all tools including code execution (Python/JS), web search, file I/O, and dynamic tool creation.
You must complete the objective independently and return the final result.

## Your Objective
${objective}

## Context
${context || "No additional context provided."}

## Rules
1. Work autonomously — do not ask questions, make reasonable assumptions
2. Use tools aggressively to accomplish the task
3. If you need a tool that doesn't exist, CREATE one using create_tool
4. If you need information, SEARCH the web using web_search
5. If you need to process data, use execute_code with Python or JavaScript
6. When done, provide a clear, complete answer with all results`;

    // Build initial messages
    const messages: ChatMessage[] = [
        { role: "system", content: subAgentPrompt },
    ];

    // Add attachments as user messages
    const processed = processAttachments(attachments);
    const textAttachments = processed.filter(a => a.type === "text").map(a => `--- ${a.name} ---\n${a.content}`);
    const imageAttachments = processed.filter(a => a.type === "image" && a.base64);

    let userContent = `Complete this task: ${objective}`;
    if (textAttachments.length > 0) {
        userContent += `\n\nAttached files:\n${textAttachments.join("\n\n")}`;
    }

    const userMsg: ChatMessage = {
        role: "user",
        content: userContent,
        ...(imageAttachments.length > 0 ? { images: imageAttachments.map(a => a.base64!) } : {}),
    };
    messages.push(userMsg);

    let totalToolCalls = 0;
    let finalMessage = "";

    for (let iteration = 0; iteration < MAX_SUBAGENT_ITERATIONS; iteration++) {
        logInfo(`🤖 Sub-agent iteration ${iteration + 1}/${MAX_SUBAGENT_ITERATIONS}`);

        const response = await llm.chat(messages, tools);
        const msg = response.message;
        messages.push(msg);

        // No tool calls — sub-agent is done
        if (!msg.tool_calls?.length) {
            finalMessage = msg.content;
            break;
        }

        // Execute tool calls
        for (const toolCall of msg.tool_calls) {
            const { name, arguments: args } = toolCall.function;
            totalToolCalls++;
            logInfo(`🤖 Sub-agent tool #${totalToolCalls}: ${name}`);

            // Run through hooks (security gates apply to sub-agents too)
            const hookOutcome = await hooks.runBefore(name, (args ?? {}) as Record<string, unknown>, "subagent");
            if (hookOutcome.blocked) {
                messages.push({ role: "tool", content: `🛡️ Blocked: ${hookOutcome.reason}` });
                continue;
            }

            const stepStart = Date.now();
            let result = await registry.execute(name, hookOutcome.args);
            const stepDuration = Date.now() - stepStart;

            result = await hooks.runAfter(name, (args ?? {}) as Record<string, unknown>, result, stepDuration, "subagent");

            messages.push({
                role: "tool",
                content: result.content,
                ...(result.image ? { images: [result.image.base64] } : {}),
            });
        }
    }

    return {
        success: !!finalMessage,
        result: finalMessage || "Sub-agent completed all iterations without a final response.",
        toolCalls: totalToolCalls,
    };
}

// ─── Tool Definition ─────────────────────────────────────────────────────────

/** Creates the spawn_subagent tool. Needs registry to pass to sub-agent. */
export function createSubAgentTool(registry: ToolRegistry): ToolDefinition {
    return {
        name: "spawn_subagent",
        description: `Delegate a complex task to an autonomous sub-agent.
The sub-agent has access to ALL tools (code execution, web search, file I/O, dynamic tool creation, ADB phone control).
It will work independently and return the final result.

Use this for:
- Multi-step research tasks ("Find the best restaurants in Tokyo and save to a file")
- Complex data processing ("Download this CSV, analyze it, create a summary")
- Tasks that need multiple tools working together
- Any task you want to run in the background while you do something else

You can attach files (images, text, data) for the sub-agent to work with.`,
        parameters: {
            type: "object",
            properties: {
                objective: {
                    type: "string",
                    description: "Clear, specific objective for the sub-agent (e.g. 'Search for weather in Tokyo and create a summary')",
                },
                context: {
                    type: "string",
                    description: "Background context or additional instructions for the sub-agent",
                },
                attachments: {
                    type: "string",
                    description: "Comma-separated file paths to attach (images, text, data). The sub-agent can read these files.",
                },
            },
            required: ["objective"],
        },
        execute: async (args): Promise<ToolResult> => {
            const objective = args.objective as string;
            const context = (args.context as string) ?? "";
            const attachmentsStr = (args.attachments as string) ?? "";
            const attachmentPaths = attachmentsStr
                ? attachmentsStr.split(",").map(s => s.trim()).filter(Boolean)
                : [];

            if (!objective?.trim()) {
                return { type: "text", content: "Error: No objective provided for sub-agent" };
            }

            logInfo(`🤖 Spawning sub-agent: "${objective.slice(0, 80)}..."`);
            logInfo(`   Context: ${context.slice(0, 100) || "(none)"}`);
            logInfo(`   Attachments: ${attachmentPaths.length || "none"}`);

            try {
                const result = await runSubAgent(objective, context, attachmentPaths, registry);

                const header = result.success
                    ? `✅ Sub-agent completed (${result.toolCalls} tool calls)`
                    : `⚠️ Sub-agent finished with issues (${result.toolCalls} tool calls)`;

                return {
                    type: "text",
                    content: `${header}\n\n--- Sub-Agent Result ---\n${result.result}`,
                };
            } catch (err) {
                return {
                    type: "text",
                    content: `Sub-agent error: ${err instanceof Error ? err.message : err}`,
                };
            }
        },
    };
}

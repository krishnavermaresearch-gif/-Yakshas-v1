/**
 * Context Window Compaction — auto-summarizes old messages when
 * conversation grows too long for the LLM's context window.
 *
 * Prevents context overflow during complex multi-step tasks.
 * Keeps the system prompt + recent messages, summarizes everything in between.
 */

import { logInfo, logWarn } from "../logger.js";
import { getLLMProvider } from "../llm/provider-factory.js";
import type { ChatMessage } from "../llm/llm-provider.js";

// Re-export ChatMessage as OllamaMessage for backward compatibility
export type { ChatMessage as OllamaMessage } from "../llm/llm-provider.js";

// ─── Config ──────────────────────────────────────────────────────────────────

const CHARS_PER_TOKEN = 4; // rough estimate
const DEFAULT_MAX_TOKENS = 6000; // conservative for most models
const KEEP_RECENT = 8; // always keep last N messages

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Estimate token count for an array of messages.
 * Uses a rough ~4 chars/token heuristic.
 */
export function estimateTokens(messages: ChatMessage[]): number {
    let totalChars = 0;
    for (const msg of messages) {
        totalChars += (msg.content ?? "").length;
        if (msg.tool_calls) {
            totalChars += JSON.stringify(msg.tool_calls).length;
        }
    }
    return Math.ceil(totalChars / CHARS_PER_TOKEN);
}

/**
 * Check if compaction is needed.
 */
export function shouldCompact(
    messages: ChatMessage[],
    maxTokens: number = DEFAULT_MAX_TOKENS,
): boolean {
    if (messages.length <= KEEP_RECENT + 2) return false; // system + user + recent
    return estimateTokens(messages) > maxTokens;
}

/**
 * Compact the message history by summarizing old messages.
 *
 * Strategy:
 * 1. Keep messages[0] (system prompt) intact
 * 2. Keep the last KEEP_RECENT messages intact
 * 3. Summarize everything in between via LLM
 * 4. Insert summary as a system message after the prompt
 *
 * Returns the compacted messages array (mutates nothing).
 */
export async function compactMessages(
    messages: ChatMessage[],
    maxTokens: number = DEFAULT_MAX_TOKENS,
): Promise<ChatMessage[]> {
    if (!shouldCompact(messages, maxTokens)) return messages;

    const systemMsg = messages[0]; // system prompt
    const recent = messages.slice(-KEEP_RECENT);
    const middle = messages.slice(1, messages.length - KEEP_RECENT);

    if (middle.length === 0) return messages;

    logInfo(`Compacting ${middle.length} messages (est. ${estimateTokens(middle)} tokens)`);

    // Build a text summary of the dropped messages
    const summaryInput = middle
        .map((m) => {
            const role = m.role.toUpperCase();
            const content = (m.content ?? "").slice(0, 300); // truncate long results
            if (m.tool_calls) {
                const calls = m.tool_calls
                    .map((tc) => `${tc.function.name}(${JSON.stringify(tc.function.arguments).slice(0, 100)})`)
                    .join(", ");
                return `[${role}] Called: ${calls}`;
            }
            return `[${role}] ${content}`;
        })
        .join("\n");

    // Summarize via LLM
    let summary: string;
    try {
        const llm = getLLMProvider();
        summary = await llm.ask(
            "You are a conversation summarizer. Summarize the following conversation history concisely. " +
            "Focus on: what task the user requested, what tools were called, what results were obtained, " +
            "and what the current state is. Be brief (max 200 words).",
            summaryInput,
        );
    } catch (err) {
        logWarn(`Compaction summarization failed: ${err instanceof Error ? err.message : err}`);
        // Fallback: just keep a simple list of tool calls
        summary = middle
            .filter((m) => m.tool_calls)
            .map((m) => m.tool_calls!.map((tc) => tc.function.name).join(", "))
            .filter(Boolean)
            .join(" → ");
        summary = `[Previous tool calls: ${summary || "none"}]`;
    }

    const summaryMsg: ChatMessage = {
        role: "system",
        content: `## Conversation Summary (compacted ${middle.length} messages)\n${summary}`,
    };

    const compacted = [systemMsg!, summaryMsg, ...recent];

    logInfo(`Compacted: ${messages.length} → ${compacted.length} messages ` +
        `(${estimateTokens(messages)} → ${estimateTokens(compacted)} est. tokens)`);

    return compacted;
}

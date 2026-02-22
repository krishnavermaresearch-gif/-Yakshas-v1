/**
 * Claude Provider — Anthropic Claude API via REST.
 *
 * Supports: claude-3-5-sonnet, claude-3-opus, claude-3-haiku
 * Env: CLAUDE_API_KEY, CLAUDE_MODEL (default: claude-sonnet-4-20250514)
 */

import { logDebug, logInfo } from "../logger.js";
import type { LLMProvider, ChatMessage, ToolDef, ChatResponse, ToolCall } from "./llm-provider.js";
import { LLMError } from "./llm-provider.js";

const CLAUDE_BASE = "https://api.anthropic.com/v1";

export class ClaudeProvider implements LLMProvider {
    readonly name = "claude";
    private readonly apiKey: string;
    private readonly model: string;

    constructor() {
        this.apiKey = process.env.CLAUDE_API_KEY ?? "";
        this.model = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-20250514";
        if (!this.apiKey) throw new LLMError("CLAUDE_API_KEY not set in .env", "claude");
    }

    getModel(): string { return this.model; }

    async healthCheck(): Promise<{ ok: boolean; error?: string }> {
        try {
            // Claude doesn't have a simple health endpoint — do a minimal request
            const res = await fetch(`${CLAUDE_BASE}/messages`, {
                method: "POST",
                headers: {
                    "x-api-key": this.apiKey,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: this.model,
                    max_tokens: 10,
                    messages: [{ role: "user", content: "hi" }],
                }),
                signal: AbortSignal.timeout(15_000),
            });
            if (!res.ok) {
                const body = await res.text().catch(() => "");
                return { ok: false, error: `Claude API returned ${res.status}: ${body.slice(0, 200)}` };
            }
            return { ok: true };
        } catch (err) {
            return { ok: false, error: `Claude unreachable: ${err instanceof Error ? err.message : err}` };
        }
    }

    async chat(messages: ChatMessage[], tools?: ToolDef[], options?: { temperature?: number }): Promise<ChatResponse> {
        // Extract system message
        const systemMsg = messages.find(m => m.role === "system");
        const nonSystem = messages.filter(m => m.role !== "system");

        const body: any = {
            model: this.model,
            max_tokens: 4096,
            messages: this.toClaudeMessages(nonSystem),
            ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        };

        if (systemMsg) body.system = systemMsg.content;
        if (tools?.length) body.tools = this.toClaudeTools(tools);

        logDebug(`Claude: ${messages.length} msgs, ${tools?.length ?? 0} tools`);
        const startMs = Date.now();

        const res = await fetch(`${CLAUDE_BASE}/messages`, {
            method: "POST",
            headers: {
                "x-api-key": this.apiKey,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(120_000),
        });

        if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            throw new LLMError(`Claude ${res.status}: ${errBody.slice(0, 500)}`, "claude");
        }

        const data = await res.json() as any;
        const durationMs = Date.now() - startMs;
        const responseMsg = this.fromClaudeResponse(data);
        const tokenCount = data.usage?.output_tokens;

        logInfo(`Claude: ${durationMs}ms, ${tokenCount ?? "?"} tokens, tools=${responseMsg.tool_calls?.length ?? 0}`);

        return {
            message: responseMsg,
            model: this.model,
            done: data.stop_reason === "end_turn" || data.stop_reason === "stop_sequence",
            durationMs,
            tokenCount,
        };
    }

    async ask(systemPrompt: string, userMessage: string): Promise<string> {
        const response = await this.chat([
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
        ]);
        return response.message.content ?? "";
    }

    // ── Format Converters ────────────────────────────────────────────────

    private toClaudeMessages(messages: ChatMessage[]): any[] {
        return messages.map(m => {
            if (m.role === "tool") {
                return {
                    role: "user",
                    content: [{
                        type: "tool_result",
                        tool_use_id: "tool_call",
                        content: m.content,
                    }],
                };
            }
            if (m.tool_calls?.length) {
                return {
                    role: "assistant",
                    content: m.tool_calls.map(tc => ({
                        type: "tool_use",
                        id: "tool_call",
                        name: tc.function.name,
                        input: tc.function.arguments,
                    })),
                };
            }

            const content: any[] = [{ type: "text", text: m.content || "" }];
            if (m.images?.length) {
                for (const img of m.images) {
                    content.push({
                        type: "image",
                        source: { type: "base64", media_type: "image/png", data: img },
                    });
                }
            }
            return { role: m.role === "assistant" ? "assistant" : "user", content };
        });
    }

    private toClaudeTools(tools: ToolDef[]): any[] {
        return tools.map(t => ({
            name: t.function.name,
            description: t.function.description,
            input_schema: t.function.parameters,
        }));
    }

    private fromClaudeResponse(data: any): ChatMessage {
        let content = "";
        const toolCalls: ToolCall[] = [];

        for (const block of data.content ?? []) {
            if (block.type === "text") content += block.text;
            if (block.type === "tool_use") {
                toolCalls.push({
                    function: { name: block.name, arguments: block.input ?? {} },
                });
            }
        }

        return {
            role: "assistant",
            content,
            ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        };
    }
}

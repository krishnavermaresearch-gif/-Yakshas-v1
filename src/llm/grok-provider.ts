/**
 * Grok Provider — xAI Grok API via OpenAI-compatible REST endpoint.
 *
 * Supports: grok-2, grok-2-mini
 * Env: GROK_API_KEY, GROK_MODEL (default: grok-2)
 */

import { logDebug, logInfo } from "../logger.js";
import type { LLMProvider, ChatMessage, ToolDef, ChatResponse, ToolCall } from "./llm-provider.js";
import { LLMError } from "./llm-provider.js";

const GROK_BASE = "https://api.x.ai/v1";

export class GrokProvider implements LLMProvider {
    readonly name = "grok";
    private readonly apiKey: string;
    private readonly model: string;

    constructor() {
        this.apiKey = process.env.GROK_API_KEY ?? "";
        this.model = process.env.GROK_MODEL ?? "grok-2";
        if (!this.apiKey) throw new LLMError("GROK_API_KEY not set in .env", "grok");
    }

    getModel(): string { return this.model; }

    async healthCheck(): Promise<{ ok: boolean; error?: string }> {
        try {
            const res = await fetch(`${GROK_BASE}/models`, {
                headers: { "Authorization": `Bearer ${this.apiKey}` },
                signal: AbortSignal.timeout(10_000),
            });
            if (!res.ok) return { ok: false, error: `Grok API returned ${res.status}` };
            return { ok: true };
        } catch (err) {
            return { ok: false, error: `Grok unreachable: ${err instanceof Error ? err.message : err}` };
        }
    }

    async chat(messages: ChatMessage[], tools?: ToolDef[], options?: { temperature?: number }): Promise<ChatResponse> {
        // Grok uses OpenAI-compatible format
        const body: any = {
            model: this.model,
            messages: messages.map(m => ({
                role: m.role,
                content: m.content,
                ...(m.tool_calls ? {
                    tool_calls: m.tool_calls.map((tc, i) => ({
                        id: `call_${i}`,
                        type: "function",
                        function: tc.function,
                    })),
                } : {}),
            })),
            ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        };

        if (tools?.length) body.tools = tools;

        logDebug(`Grok: ${messages.length} msgs, ${tools?.length ?? 0} tools`);
        const startMs = Date.now();

        const res = await fetch(`${GROK_BASE}/chat/completions`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(120_000),
        });

        if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            throw new LLMError(`Grok ${res.status}: ${errBody.slice(0, 500)}`, "grok");
        }

        const data = await res.json() as any;
        const durationMs = Date.now() - startMs;
        const choice = data.choices?.[0];
        if (!choice) throw new LLMError("No response from Grok", "grok");

        const responseMsg = this.fromOpenAIResponse(choice.message);
        const tokenCount = data.usage?.completion_tokens;

        logInfo(`Grok: ${durationMs}ms, ${tokenCount ?? "?"} tokens, tools=${responseMsg.tool_calls?.length ?? 0}`);

        return {
            message: responseMsg,
            model: this.model,
            done: choice.finish_reason === "stop",
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

    private fromOpenAIResponse(msg: any): ChatMessage {
        const toolCalls: ToolCall[] = [];
        if (msg.tool_calls?.length) {
            for (const tc of msg.tool_calls) {
                toolCalls.push({
                    function: {
                        name: tc.function.name,
                        arguments: typeof tc.function.arguments === "string"
                            ? JSON.parse(tc.function.arguments)
                            : tc.function.arguments,
                    },
                });
            }
        }
        return {
            role: "assistant",
            content: msg.content ?? "",
            ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        };
    }
}

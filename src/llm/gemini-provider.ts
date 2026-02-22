/**
 * Gemini Provider — Google Gemini API via REST (no SDK needed).
 *
 * Supports: gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash
 * Env: GEMINI_API_KEY, GEMINI_MODEL (default: gemini-2.0-flash)
 */

import { logDebug, logInfo } from "../logger.js";
import type { LLMProvider, ChatMessage, ToolDef, ChatResponse, ToolCall } from "./llm-provider.js";
import { LLMError } from "./llm-provider.js";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiProvider implements LLMProvider {
    readonly name = "gemini";
    private readonly apiKey: string;
    private readonly model: string;

    constructor() {
        this.apiKey = process.env.GEMINI_API_KEY ?? "";
        this.model = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
        if (!this.apiKey) throw new LLMError("GEMINI_API_KEY not set in .env", "gemini");
    }

    getModel(): string { return this.model; }

    async healthCheck(): Promise<{ ok: boolean; error?: string }> {
        try {
            const res = await fetch(
                `${GEMINI_BASE}/models/${this.model}?key=${this.apiKey}`,
                { signal: AbortSignal.timeout(10_000) },
            );
            if (!res.ok) return { ok: false, error: `Gemini API returned ${res.status}` };
            return { ok: true };
        } catch (err) {
            return { ok: false, error: `Gemini unreachable: ${err instanceof Error ? err.message : err}` };
        }
    }

    async chat(messages: ChatMessage[], tools?: ToolDef[], options?: { temperature?: number }): Promise<ChatResponse> {
        // Convert messages to Gemini format
        const contents = this.toGeminiContents(messages);
        const geminiTools = tools?.length ? this.toGeminiTools(tools) : undefined;

        const body: any = {
            contents,
            generationConfig: {
                temperature: options?.temperature ?? 0.7,
                maxOutputTokens: 4096,
            },
        };
        if (geminiTools) body.tools = geminiTools;

        // Extract system instruction from messages
        const systemMsg = messages.find(m => m.role === "system");
        if (systemMsg) {
            body.systemInstruction = { parts: [{ text: systemMsg.content }] };
        }

        logDebug(`Gemini: ${messages.length} msgs, ${tools?.length ?? 0} tools`);
        const startMs = Date.now();

        const res = await fetch(
            `${GEMINI_BASE}/models/${this.model}:generateContent?key=${this.apiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(120_000),
            },
        );

        if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            throw new LLMError(`Gemini ${res.status}: ${errBody.slice(0, 500)}`, "gemini");
        }

        const data = await res.json() as any;
        const durationMs = Date.now() - startMs;
        const candidate = data.candidates?.[0];
        if (!candidate) throw new LLMError("No response from Gemini", "gemini");

        // Convert Gemini response to ChatMessage
        const responseMsg = this.fromGeminiResponse(candidate);
        const tokenCount = data.usageMetadata?.totalTokenCount;

        logInfo(`Gemini: ${durationMs}ms, ${tokenCount ?? "?"} tokens, tools=${responseMsg.tool_calls?.length ?? 0}`);

        return { message: responseMsg, model: this.model, done: true, durationMs, tokenCount };
    }

    async ask(systemPrompt: string, userMessage: string): Promise<string> {
        const response = await this.chat([
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
        ]);
        return response.message.content ?? "";
    }

    // ── Format Converters ────────────────────────────────────────────────

    private toGeminiContents(messages: ChatMessage[]): any[] {
        return messages
            .filter(m => m.role !== "system") // system handled separately
            .map(m => {
                const role = m.role === "assistant" ? "model" : "user";
                const parts: any[] = [];
                if (m.content) parts.push({ text: m.content });
                if (m.images?.length) {
                    for (const img of m.images) {
                        parts.push({ inlineData: { mimeType: "image/png", data: img } });
                    }
                }
                if (m.tool_calls?.length) {
                    for (const tc of m.tool_calls) {
                        parts.push({ functionCall: { name: tc.function.name, args: tc.function.arguments } });
                    }
                }
                // Tool results
                if (m.role === "tool" && m.content) {
                    parts.length = 0;
                    parts.push({ functionResponse: { name: "tool_result", response: { result: m.content } } });
                }
                return { role, parts: parts.length ? parts : [{ text: "" }] };
            });
    }

    private toGeminiTools(tools: ToolDef[]): any[] {
        return [{
            functionDeclarations: tools.map(t => ({
                name: t.function.name,
                description: t.function.description,
                parameters: t.function.parameters,
            })),
        }];
    }

    private fromGeminiResponse(candidate: any): ChatMessage {
        const parts = candidate.content?.parts ?? [];
        let content = "";
        const toolCalls: ToolCall[] = [];

        for (const part of parts) {
            if (part.text) content += part.text;
            if (part.functionCall) {
                toolCalls.push({
                    function: { name: part.functionCall.name, arguments: part.functionCall.args ?? {} },
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

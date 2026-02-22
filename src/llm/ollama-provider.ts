/**
 * Ollama Provider — wraps the existing OllamaClient as an LLMProvider.
 */

import { logDebug, logInfo } from "../logger.js";
import type { LLMProvider, ChatMessage, ToolDef, ChatResponse, StreamChunk } from "./llm-provider.js";
import { LLMError } from "./llm-provider.js";

export class OllamaProvider implements LLMProvider {
    readonly name = "ollama";
    private readonly baseUrl: string;
    private readonly model: string;
    private readonly visionModel: string;
    private readonly timeoutMs: number;

    constructor() {
        this.baseUrl = (process.env.OLLAMA_URL ?? "http://localhost:11434").replace(/\/$/, "");
        this.model = process.env.OLLAMA_MODEL ?? "qwen2.5";
        this.visionModel = process.env.OLLAMA_VISION_MODEL ?? this.model;
        this.timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS) || 300_000;
    }

    getModel(): string { return this.model; }
    getVisionModel(): string { return this.visionModel; }

    async healthCheck(): Promise<{ ok: boolean; error?: string }> {
        try {
            const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(10_000) });
            if (!res.ok) return { ok: false, error: `Ollama returned status ${res.status}` };

            const data = (await res.json()) as { models?: Array<{ name: string }> };
            const models = data.models ?? [];
            const hasModel = models.some(
                m => m.name === this.model || m.name === `${this.model}:latest` || m.name.startsWith(`${this.model}:`),
            );
            if (!hasModel) {
                return { ok: false, error: `Model "${this.model}" not found. Run: ollama pull ${this.model}` };
            }
            return { ok: true };
        } catch (err) {
            return { ok: false, error: `Cannot connect to Ollama at ${this.baseUrl}: ${err instanceof Error ? err.message : err}` };
        }
    }

    async chat(messages: ChatMessage[], tools?: ToolDef[], options?: { temperature?: number; modelOverride?: string }): Promise<ChatResponse> {
        // Use vision model if images are present and no explicit override
        const hasImages = messages.some(m => m.images?.length);
        const activeModel = options?.modelOverride ?? (hasImages ? this.visionModel : this.model);

        const body = {
            model: activeModel,
            messages,
            stream: false,
            ...(tools?.length ? { tools } : {}),
            ...(options ? { options: { temperature: options.temperature } } : {}),
        };

        logDebug(`Ollama: ${messages.length} msgs, ${tools?.length ?? 0} tools`);
        const startMs = Date.now();

        let res: Response;
        try {
            res = await fetch(`${this.baseUrl}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(this.timeoutMs),
            });
        } catch (err) {
            throw new LLMError(`Ollama connection failed: ${err instanceof Error ? err.message : err}`, "ollama");
        }

        if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            throw new LLMError(`Ollama ${res.status}: ${errBody.slice(0, 500)}`, "ollama");
        }

        const data = await res.json() as any;
        const durationMs = Date.now() - startMs;

        logInfo(`Ollama: ${durationMs}ms, ${data.eval_count ?? 0} tokens, tools=${data.message.tool_calls?.length ?? 0}`);

        return {
            message: data.message,
            model: data.model,
            done: data.done,
            durationMs,
            tokenCount: data.eval_count,
        };
    }

    async ask(systemPrompt: string, userMessage: string): Promise<string> {
        const response = await this.chat([
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
        ]);
        return response.message.content ?? "";
    }

    /** Streaming chat — yields text chunks and tool calls as they arrive */
    async *chatStream(
        messages: ChatMessage[],
        tools?: ToolDef[],
        options?: { temperature?: number },
    ): AsyncIterable<StreamChunk> {
        const body = {
            model: this.model,
            messages,
            stream: true,
            ...(tools?.length ? { tools } : {}),
            ...(options ? { options } : {}),
        };

        logDebug(`Ollama stream: ${messages.length} msgs, ${tools?.length ?? 0} tools`);
        const startMs = Date.now();

        let res: Response;
        try {
            res = await fetch(`${this.baseUrl}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(this.timeoutMs),
            });
        } catch (err) {
            throw new LLMError(`Ollama stream connection failed: ${err instanceof Error ? err.message : err}`, "ollama");
        }

        if (!res.ok || !res.body) {
            const errBody = await res.text().catch(() => "");
            throw new LLMError(`Ollama stream ${res.status}: ${errBody.slice(0, 500)}`, "ollama");
        }

        const decoder = new TextDecoder();
        const reader = res.body.getReader();
        let buffer = "";
        let fullContent = "";
        const toolCalls: Array<{ function: { name: string; arguments: Record<string, unknown> } }> = [];

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const chunk = JSON.parse(line) as any;
                        const msg = chunk.message;

                        // Text content
                        if (msg?.content) {
                            fullContent += msg.content;
                            yield { type: "text" as const, content: msg.content };
                        }

                        // Tool calls
                        if (msg?.tool_calls?.length) {
                            for (const tc of msg.tool_calls) {
                                toolCalls.push(tc);
                                yield { type: "tool_call" as const, tool_call: tc };
                            }
                        }

                        // Done flag
                        if (chunk.done) {
                            const durationMs = Date.now() - startMs;
                            logInfo(`Ollama stream: ${durationMs}ms, ${chunk.eval_count ?? 0} tokens`);
                            yield {
                                type: "done" as const,
                                fullMessage: {
                                    role: "assistant" as const,
                                    content: fullContent,
                                    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
                                },
                                durationMs,
                                tokenCount: chunk.eval_count,
                            };
                        }
                    } catch { /* skip unparseable lines */ }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }
}

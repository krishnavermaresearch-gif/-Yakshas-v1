import { logDebug, logInfo } from "../logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type OllamaMessage = {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    images?: string[];         // base64 images for vision models
    tool_calls?: OllamaToolCall[];
};

export type OllamaToolCall = {
    function: {
        name: string;
        arguments: Record<string, unknown>;
    };
};

export type OllamaTool = {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: {
            type: "object";
            properties: Record<string, unknown>;
            required: string[];
        };
    };
};

export type OllamaChatRequest = {
    model: string;
    messages: OllamaMessage[];
    tools?: OllamaTool[];
    stream: false;
    options?: {
        temperature?: number;
        num_predict?: number;
        top_p?: number;
    };
};

export type OllamaChatResponse = {
    model: string;
    message: OllamaMessage;
    done: boolean;
    done_reason?: string;
    total_duration?: number;
    eval_count?: number;
};

export type OllamaClientOptions = {
    baseUrl?: string;
    model?: string;
    timeoutMs?: number;
};

// ─── Client ──────────────────────────────────────────────────────────────────

/**
 * Ollama HTTP API client for /api/chat with tool calling support.
 * No external dependencies — uses Node.js built-in fetch().
 */
export class OllamaClient {
    private readonly baseUrl: string;
    private readonly model: string;
    private readonly timeoutMs: number;

    constructor(options: OllamaClientOptions = {}) {
        this.baseUrl = (
            options.baseUrl ??
            process.env.OLLAMA_URL ??
            "http://localhost:11434"
        ).replace(/\/$/, "");

        this.model = options.model ?? process.env.OLLAMA_MODEL ?? "qwen2.5";
        this.timeoutMs = options.timeoutMs ?? 300_000; // 5min for slow models
    }

    /** Get the current model name. */
    getModel(): string {
        return this.model;
    }

    /**
     * Check if Ollama is running and the model is available.
     */
    async healthCheck(): Promise<{ ok: boolean; error?: string }> {
        try {
            const res = await fetch(`${this.baseUrl}/api/tags`, {
                signal: AbortSignal.timeout(10_000),
            });
            if (!res.ok) {
                return { ok: false, error: `Ollama returned status ${res.status}` };
            }
            const data = (await res.json()) as { models?: Array<{ name: string }> };
            const models = data.models ?? [];
            const hasModel = models.some(
                (m) =>
                    m.name === this.model ||
                    m.name === `${this.model}:latest` ||
                    m.name.startsWith(`${this.model}:`),
            );

            if (!hasModel) {
                const available = models.map((m) => m.name).join(", ");
                return {
                    ok: false,
                    error:
                        `Model "${this.model}" not found. Available: ${available || "none"}. ` +
                        `Run: ollama pull ${this.model}`,
                };
            }

            return { ok: true };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
                ok: false,
                error: `Cannot connect to Ollama at ${this.baseUrl}: ${msg}. Is Ollama running?`,
            };
        }
    }

    /**
     * Send a chat request to Ollama with optional tool definitions.
     * Returns the model's response message.
     */
    async chat(
        messages: OllamaMessage[],
        tools?: OllamaTool[],
        options?: { temperature?: number },
    ): Promise<OllamaChatResponse> {
        const body: OllamaChatRequest = {
            model: this.model,
            messages,
            stream: false,
            ...(tools && tools.length > 0 ? { tools } : {}),
            ...(options ? { options } : {}),
        };

        logDebug(
            `Ollama request: ${messages.length} messages, ${tools?.length ?? 0} tools, model=${this.model}`,
        );

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
            const msg = err instanceof Error ? err.message : String(err);
            throw new OllamaError(`Failed to connect to Ollama: ${msg}`);
        }

        if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            throw new OllamaError(
                `Ollama returned ${res.status}: ${errBody.slice(0, 500)}`,
            );
        }

        const data = (await res.json()) as OllamaChatResponse;
        const durationMs = Date.now() - startMs;
        const tokens = data.eval_count ?? 0;

        logInfo(
            `Ollama response: ${durationMs}ms, ${tokens} tokens, ` +
            `tool_calls=${data.message.tool_calls?.length ?? 0}`,
        );

        return data;
    }

    /**
     * Simple text-only chat (no tools).
     */
    async ask(
        systemPrompt: string,
        userMessage: string,
    ): Promise<string> {
        const response = await this.chat([
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
        ]);
        return response.message.content ?? "";
    }
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class OllamaError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "OllamaError";
    }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _client: OllamaClient | null = null;

export function getOllamaClient(): OllamaClient {
    if (!_client) {
        _client = new OllamaClient();
    }
    return _client;
}

export function resetOllamaClient(): void {
    _client = null;
}

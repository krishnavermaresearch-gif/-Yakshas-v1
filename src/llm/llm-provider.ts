/**
 * LLM Provider — unified interface for all language model providers.
 *
 * All providers (Ollama, Gemini, Claude, Grok) implement this interface.
 * The rest of the codebase talks through this abstraction only.
 */

// ─── Message Types (provider-agnostic) ───────────────────────────────────────

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatMessage = {
    role: ChatRole;
    content: string;
    images?: string[];         // base64 images for vision
    tool_calls?: ToolCall[];
};

export type ToolCall = {
    function: {
        name: string;
        arguments: Record<string, unknown>;
    };
};

export type ToolDef = {
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

export type ChatResponse = {
    message: ChatMessage;
    model: string;
    done: boolean;
    durationMs?: number;
    tokenCount?: number;
};

// ─── Streaming Types ─────────────────────────────────────────────────────────

export type StreamChunk =
    | { type: "text"; content: string }
    | { type: "tool_call"; tool_call: ToolCall }
    | { type: "done"; fullMessage?: ChatMessage; durationMs?: number; tokenCount?: number };

// ─── Provider Interface ──────────────────────────────────────────────────────

export interface LLMProvider {
    /** Provider name (e.g., "ollama", "gemini", "claude", "grok") */
    readonly name: string;

    /** Model name currently in use */
    getModel(): string;

    /** Check if the provider is reachable and model is available */
    healthCheck(): Promise<{ ok: boolean; error?: string }>;

    /** Send a chat request with optional tool definitions */
    chat(
        messages: ChatMessage[],
        tools?: ToolDef[],
        options?: { temperature?: number },
    ): Promise<ChatResponse>;

    /** Simple text-only chat (no tools) — convenience method */
    ask(systemPrompt: string, userMessage: string): Promise<string>;

    /** Streaming chat — yields chunks as they arrive from the LLM */
    chatStream?(
        messages: ChatMessage[],
        tools?: ToolDef[],
        options?: { temperature?: number },
    ): AsyncIterable<StreamChunk>;
}

// ─── Provider Types ──────────────────────────────────────────────────────────

export type ProviderType = "ollama" | "gemini" | "claude" | "grok";

export class LLMError extends Error {
    constructor(message: string, public readonly provider: string) {
        super(message);
        this.name = "LLMError";
    }
}

/**
 * Provider Factory — creates and manages the active LLM provider.
 *
 * Reads LLM_PROVIDER env var to decide which backend:
 *   - "ollama"  → OllamaProvider (default, local)
 *   - "gemini"  → GeminiProvider (requires GEMINI_API_KEY)
 *   - "claude"  → ClaudeProvider (requires CLAUDE_API_KEY)
 *   - "grok"    → GrokProvider (requires GROK_API_KEY)
 */

import type { LLMProvider, ProviderType } from "./llm-provider.js";
import { OllamaProvider } from "./ollama-provider.js";
import { GeminiProvider } from "./gemini-provider.js";
import { ClaudeProvider } from "./claude-provider.js";
import { GrokProvider } from "./grok-provider.js";
import { logInfo } from "../logger.js";

// ─── Factory ─────────────────────────────────────────────────────────────────

function createProvider(type: ProviderType): LLMProvider {
    switch (type) {
        case "ollama": return new OllamaProvider();
        case "gemini": return new GeminiProvider();
        case "claude": return new ClaudeProvider();
        case "grok": return new GrokProvider();
        default:
            throw new Error(`Unknown LLM provider: "${type}". Use: ollama, gemini, claude, grok`);
    }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _provider: LLMProvider | null = null;

/** Get the active LLM provider (reads LLM_PROVIDER env var). */
export function getLLMProvider(): LLMProvider {
    if (!_provider) {
        const type = (process.env.LLM_PROVIDER ?? "ollama").toLowerCase() as ProviderType;
        _provider = createProvider(type);
        logInfo(`LLM provider: ${_provider.name} (model: ${_provider.getModel()})`);
    }
    return _provider;
}

/** Switch provider at runtime (call from a tool or config). */
export function setLLMProvider(type: ProviderType): LLMProvider {
    _provider = createProvider(type);
    logInfo(`LLM provider switched to: ${_provider.name} (model: ${_provider.getModel()})`);
    return _provider;
}

/** Reset provider (forces re-read of env on next call). */
export function resetLLMProvider(): void {
    _provider = null;
}

/** List all available provider types. */
export function availableProviders(): ProviderType[] {
    return ["ollama", "gemini", "claude", "grok"];
}

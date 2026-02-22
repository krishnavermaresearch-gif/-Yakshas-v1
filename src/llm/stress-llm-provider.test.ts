/**
 * BRUTAL STRESS TEST — LLM Provider System
 *
 * Tests: factory edge cases, provider switching, env parsing,
 * error class behavior, type integrity.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
    getLLMProvider,
    setLLMProvider,
    resetLLMProvider,
    availableProviders,
} from "../llm/provider-factory.js";
import { LLMError } from "../llm/llm-provider.js";
import type { ProviderType } from "../llm/llm-provider.js";

describe("STRESS: LLM Provider Factory", () => {
    afterEach(() => {
        resetLLMProvider();
        delete process.env.LLM_PROVIDER;
    });

    // ─── Factory Basics ──────────────────────────────────────────────

    it("should default to ollama when no env set", () => {
        delete process.env.LLM_PROVIDER;
        resetLLMProvider();
        const provider = getLLMProvider();
        assert.strictEqual(provider.name, "ollama");
    });

    it("should return same singleton on repeated calls", () => {
        delete process.env.LLM_PROVIDER;
        resetLLMProvider();
        const p1 = getLLMProvider();
        const p2 = getLLMProvider();
        assert.strictEqual(p1, p2);
    });

    it("should reset and re-create on resetLLMProvider", () => {
        delete process.env.LLM_PROVIDER;
        resetLLMProvider();
        const p1 = getLLMProvider();
        resetLLMProvider();
        const p2 = getLLMProvider();
        assert.notStrictEqual(p1, p2);
        assert.strictEqual(p2.name, "ollama");
    });

    it("should list all available providers", () => {
        const providers = availableProviders();
        assert.deepStrictEqual(providers, ["ollama", "gemini", "claude", "grok"]);
    });

    // ─── Case Insensitivity ──────────────────────────────────────────

    it("should handle uppercase LLM_PROVIDER", () => {
        process.env.LLM_PROVIDER = "OLLAMA";
        resetLLMProvider();
        const provider = getLLMProvider();
        assert.strictEqual(provider.name, "ollama");
    });

    it("should handle mixed case LLM_PROVIDER", () => {
        process.env.LLM_PROVIDER = "OlLaMa";
        resetLLMProvider();
        const provider = getLLMProvider();
        assert.strictEqual(provider.name, "ollama");
    });

    // ─── Invalid Provider ────────────────────────────────────────────

    it("should throw on unknown provider type", () => {
        process.env.LLM_PROVIDER = "chatgpt";
        resetLLMProvider();
        assert.throws(
            () => getLLMProvider(),
            (err: Error) => err.message.includes("Unknown LLM provider"),
        );
    });

    it("should throw on empty string provider", () => {
        process.env.LLM_PROVIDER = "";
        resetLLMProvider();
        // Empty string isn't caught by ?? so it becomes createProvider("")
        assert.throws(
            () => getLLMProvider(),
            (err: Error) => err.message.includes("Unknown LLM provider"),
        );
    });

    // ─── Cloud Providers Without Keys ────────────────────────────────

    it("should throw when creating Gemini without API key", () => {
        delete process.env.GEMINI_API_KEY;
        assert.throws(
            () => setLLMProvider("gemini"),
            (err: Error) => err.message.includes("GEMINI_API_KEY"),
        );
    });

    it("should throw when creating Claude without API key", () => {
        delete process.env.CLAUDE_API_KEY;
        assert.throws(
            () => setLLMProvider("claude"),
            (err: Error) => err.message.includes("CLAUDE_API_KEY"),
        );
    });

    it("should throw when creating Grok without API key", () => {
        delete process.env.GROK_API_KEY;
        assert.throws(
            () => setLLMProvider("grok"),
            (err: Error) => err.message.includes("GROK_API_KEY"),
        );
    });

    // ─── Runtime Switching ───────────────────────────────────────────

    it("should switch provider at runtime", () => {
        delete process.env.LLM_PROVIDER;
        resetLLMProvider();

        const p1 = getLLMProvider();
        assert.strictEqual(p1.name, "ollama");

        const p2 = setLLMProvider("ollama");
        assert.strictEqual(p2.name, "ollama");
        assert.notStrictEqual(p1, p2); // new instance
    });

    // ─── LLMError Class ──────────────────────────────────────────────

    it("should create LLMError with provider info", () => {
        const err = new LLMError("Connection failed", "gemini");
        assert.strictEqual(err.message, "Connection failed");
        assert.strictEqual(err.provider, "gemini");
        assert.strictEqual(err.name, "LLMError");
        assert.ok(err instanceof Error);
    });

    it("should serialize LLMError correctly", () => {
        const err = new LLMError("Test error", "claude");
        const str = String(err);
        assert.ok(str.includes("LLMError"));
        assert.ok(str.includes("Test error"));
    });

    // ─── Ollama Provider Specifics ───────────────────────────────────

    it("ollama provider should have correct defaults", () => {
        delete process.env.LLM_PROVIDER;
        delete process.env.OLLAMA_MODEL;
        resetLLMProvider();

        const provider = getLLMProvider();
        assert.strictEqual(provider.name, "ollama");
        assert.strictEqual(provider.getModel(), "qwen2.5");
    });

    it("ollama provider should respect OLLAMA_MODEL env", () => {
        process.env.OLLAMA_MODEL = "llama3.2";
        resetLLMProvider();

        const provider = getLLMProvider();
        assert.strictEqual(provider.getModel(), "llama3.2");

        // Cleanup
        delete process.env.OLLAMA_MODEL;
    });

    // ─── Provider Interface Compliance ───────────────────────────────

    it("ollama provider should implement all interface methods", () => {
        resetLLMProvider();
        const p = getLLMProvider();

        assert.strictEqual(typeof p.name, "string");
        assert.strictEqual(typeof p.getModel, "function");
        assert.strictEqual(typeof p.healthCheck, "function");
        assert.strictEqual(typeof p.chat, "function");
        assert.strictEqual(typeof p.ask, "function");
    });

    // ─── Type Safety ─────────────────────────────────────────────────

    it("should validate ProviderType values", () => {
        const types: ProviderType[] = ["ollama", "gemini", "claude", "grok"];
        for (const t of types) {
            assert.ok(availableProviders().includes(t));
        }
    });
});

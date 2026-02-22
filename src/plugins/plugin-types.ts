import type { ToolDefinition } from "../agent/tool-registry.js";

// ─── Plugin Interface ────────────────────────────────────────────────────────

/**
 * Each plugin provides automation capabilities for a specific app.
 * Plugins are loaded at startup and their tools are merged into the registry.
 */
export type PhonePlugin = {
    /** Plugin identifier (e.g., "whatsapp") */
    name: string;

    /** Human-readable description */
    description: string;

    /** Android package name (e.g., "com.whatsapp") */
    appPackage: string;

    /** Plugin-specific tools */
    tools: ToolDefinition[];

    /**
     * Instructions for the AI on how to use this app.
     * Injected into the system prompt when this plugin is active.
     */
    systemPrompt: string;
};

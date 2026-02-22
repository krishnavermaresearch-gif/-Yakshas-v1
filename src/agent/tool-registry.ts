// ─── Tool Types ──────────────────────────────────────────────────────────────
// Matches the tool calling format expected by Ollama's /api/chat endpoint.

export type ToolResult = {
    type: "text" | "image";
    content: string;
    image?: {
        base64: string;
        mimeType: string;
    };
    /** Raw buffer for sending as file (e.g., screenshot to Telegram) */
    buffer?: Buffer;
};

export type ToolParameterSchema = {
    type: "object";
    properties: Record<
        string,
        {
            type: string;
            description: string;
            enum?: string[];
        }
    >;
    required: string[];
};

export type ToolDefinition = {
    name: string;
    description: string;
    parameters: ToolParameterSchema;
    execute: (args: Record<string, unknown>) => Promise<ToolResult>;
};

// ─── Registry ────────────────────────────────────────────────────────────────

/**
 * Central tool registry — collects all available tools and provides:
 * - Tool lookup by name
 * - Ollama-compatible tool definitions
 * - Tool execution dispatch
 */
export class ToolRegistry {
    private tools = new Map<string, ToolDefinition>();

    /** Register a single tool. Overwrites if already registered (for dynamic tools). */
    register(tool: ToolDefinition): void {
        this.tools.set(tool.name, tool);
    }

    /** Register multiple tools at once. */
    registerAll(tools: ToolDefinition[]): void {
        for (const tool of tools) {
            this.register(tool);
        }
    }

    /** Get a tool by name. */
    get(name: string): ToolDefinition | undefined {
        return this.tools.get(name);
    }

    /** Check if a tool exists. */
    has(name: string): boolean {
        return this.tools.has(name);
    }

    /** Get all registered tool names. */
    names(): string[] {
        return Array.from(this.tools.keys());
    }

    /** Get all tool definitions. */
    all(): ToolDefinition[] {
        return Array.from(this.tools.values());
    }

    /** Get tool count. */
    get size(): number {
        return this.tools.size;
    }

    /**
     * Convert all registered tools into the format Ollama expects.
     * See: https://ollama.com/blog/tool-support
     */
    toOllamaTools(): OllamaTool[] {
        return this.all().map((tool) => ({
            type: "function" as const,
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
            },
        }));
    }

    /**
     * Execute a tool by name with the given arguments.
     * Returns the result or throws if tool not found.
     */
    async execute(
        name: string,
        args: Record<string, unknown>,
    ): Promise<ToolResult> {
        const tool = this.tools.get(name);
        if (!tool) {
            return {
                type: "text",
                content: `Error: Unknown tool "${name}". Available tools: ${this.names().join(", ")}`,
            };
        }

        try {
            return await tool.execute(args);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
                type: "text",
                content: `Error executing tool "${name}": ${msg}`,
            };
        }
    }
}

// ─── Ollama Types ────────────────────────────────────────────────────────────

export type OllamaTool = {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: ToolParameterSchema;
    };
};

// ─── Factory ─────────────────────────────────────────────────────────────────

import { screenshotTool } from "../tools/screenshot.js";
import { uiTreeTool } from "../tools/ui-tree.js";
import { inputTools } from "../tools/input.js";
import { shellTool } from "../tools/shell.js";
import { appTools } from "../tools/apps.js";
import { cronTools } from "../cron/cron-tools.js";
import { eventTools } from "../autonomy/event-tools.js";
import { agendaTools } from "../autonomy/agenda-tools.js";

// Google OAuth tools
import { connectTools } from "../google/connect-tool.js";
import { gmailTools } from "../google/gmail-tools.js";
import { calendarTools } from "../google/calendar-tools.js";
import { driveTools } from "../google/drive-tools.js";
import { docsTools } from "../google/docs-tools.js";
import { sheetsTools } from "../google/sheets-tools.js";
import { peopleTools } from "../google/people-tools.js";
import { youtubeTools } from "../google/youtube-tools.js";
import { mapsTools } from "../google/maps-tools.js";

// Expanded Google services
import { tasksTools } from "../google/tasks-tools.js";
import { photosTools } from "../google/photos-tools.js";
import { translateTools } from "../google/translate-tools.js";
import { booksTools } from "../google/books-tools.js";
import { bloggerTools } from "../google/blogger-tools.js";
import { classroomTools } from "../google/classroom-tools.js";
import { formsTools } from "../google/forms-tools.js";
import { chatTools } from "../google/chat-tools.js";
import { slidesTools } from "../google/slides-tools.js";
import { googleTriggerTools } from "../google/google-trigger-tools.js";
import { integrationTools } from "../integrations/integration-tools.js";
import { telemetryTools } from "../telemetry/telemetry-tools.js";
import { workflowTools } from "../workflows/workflow-tools.js";
import { soulTools } from "../soul/soul-tools.js";

// ── Tier 6: PC Control, Security, Memory, Plugins, Cross-Device ──
import { desktopTools } from "../tools/desktop.js";
import { terminalTools } from "../tools/terminal.js";
import { browserTools } from "../tools/browser.js";
import { fileSystemTools } from "../tools/filesystem.js";
import { clipboardTools, windowTools } from "../tools/clipboard-windows.js";
import { memoryTools } from "../memory/persistent-memory.js";
import { dynamicPluginTools } from "../plugins/dynamic-plugins.js";
import { crossDeviceTools } from "../tools/cross-device.js";

/**
 * Create a fully-loaded tool registry with all core phone tools.
 * Plugin tools can be added via registry.registerAll().
 */
export function createCoreToolRegistry(): ToolRegistry {
    const registry = new ToolRegistry();

    // Core phone tools
    registry.register(screenshotTool);
    registry.register(uiTreeTool);
    registry.registerAll(inputTools);
    registry.register(shellTool);
    registry.registerAll(appTools);

    // Cron scheduler tools
    registry.registerAll(cronTools);

    // Autonomy tools (event monitoring + goal agenda)
    registry.registerAll(eventTools);
    registry.registerAll(agendaTools);

    // Google OAuth + API tools (original 7 services)
    registry.registerAll(connectTools);
    registry.registerAll(gmailTools);
    registry.registerAll(calendarTools);
    registry.registerAll(driveTools);
    registry.registerAll(docsTools);
    registry.registerAll(sheetsTools);
    registry.registerAll(peopleTools);
    registry.registerAll(youtubeTools);
    registry.registerAll(mapsTools);

    // Expanded Google services (9 new services)
    registry.registerAll(tasksTools);
    registry.registerAll(photosTools);
    registry.registerAll(translateTools);
    registry.registerAll(booksTools);
    registry.registerAll(bloggerTools);
    registry.registerAll(classroomTools);
    registry.registerAll(formsTools);
    registry.registerAll(chatTools);
    registry.registerAll(slidesTools);

    // Google event triggers (auto-react to Gmail, Calendar, Drive, Tasks events)
    registry.registerAll(googleTriggerTools);

    // Custom third-party API integrations (Odoo, Shopify, WhatsApp, Instagram, etc.)
    registry.registerAll(integrationTools);

    // RLHF trajectory recording tools
    registry.registerAll(telemetryTools);

    // B2B workflow automation tools
    registry.registerAll(workflowTools);

    // Digital Soul tools (passive observation, behavioral analysis, soul profile)
    registry.registerAll(soulTools);

    // ── Tier 6: PC Desktop + Terminal ──
    registry.registerAll(desktopTools);
    registry.registerAll(terminalTools);

    // ── Tier 6: Browser + File System + Clipboard + Windows ──
    registry.registerAll(browserTools);
    registry.registerAll(fileSystemTools);
    registry.registerAll(clipboardTools);
    registry.registerAll(windowTools);

    // ── Tier 6: Persistent Memory ──
    registry.registerAll(memoryTools);

    // ── Tier 6: Dynamic Plugin Generator ──
    registry.registerAll(dynamicPluginTools);

    // ── Tier 6: Cross-Device Orchestrator ──
    registry.registerAll(crossDeviceTools);

    return registry;
}



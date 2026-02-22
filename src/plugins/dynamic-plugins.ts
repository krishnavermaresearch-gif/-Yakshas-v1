/**
 * Dynamic Plugin Generator — Self-Modifying Agent (Tier 6)
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logInfo } from "../logger.js";
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";

const PLUGINS_DIR = join(process.cwd(), "data", "dynamic-plugins");
function ensureDir(): void { if (!existsSync(PLUGINS_DIR)) mkdirSync(PLUGINS_DIR, { recursive: true }); }

export const createPluginTool: ToolDefinition = {
    name: "create_plugin",
    description: "Create a new automation plugin at runtime. Define a shell command template with {{param}} placeholders.",
    parameters: {
        type: "object" as const,
        properties: {
            name: { type: "string", description: "Plugin name (e.g., 'check_disk_space')" },
            description: { type: "string", description: "What the plugin does" },
            command_template: { type: "string", description: "Shell template with {{param}} (e.g., 'du -sh {{path}}')" },
            parameters_schema: { type: "string", description: "JSON: {\"param\": \"description\"}'" },
        },
        required: ["name", "description", "command_template"],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const name = String(args.name ?? "").trim().replace(/[^a-z0-9_]/gi, "_").toLowerCase();
        const desc = String(args.description ?? "").trim();
        const tpl = String(args.command_template ?? "").trim();
        if (!name || !desc || !tpl) return { type: "text", content: "Error: name, description, command_template required." };
        if ([/rm\s+-rf/i, /del\s+\/s/i, /format\s+/i, /shutdown/i, /reboot/i].some((p) => p.test(tpl))) {
            return { type: "text", content: "SECURITY FAULT: Dangerous command in template." };
        }
        let params: Record<string, string> = {};
        try { params = JSON.parse(String(args.parameters_schema ?? "{}")); } catch { /* empty */ }
        ensureDir();
        const def = { name: `dyn_${name}`, description: desc, command_template: tpl, parameters: params, created_at: new Date().toISOString() };
        const fp = join(PLUGINS_DIR, `${name}.json`);
        writeFileSync(fp, JSON.stringify(def, null, 2), "utf-8");
        logInfo(`🔌 Plugin created: dyn_${name}`);
        return { type: "text", content: `Plugin "dyn_${name}" created.\nTemplate: ${tpl}\nCall load_plugins to activate.` };
    },
};

export const loadPluginsTool: ToolDefinition = {
    name: "load_plugins",
    description: "Load all dynamic plugins into the tool registry.",
    parameters: { type: "object" as const, properties: {}, required: [] },
    execute: async (): Promise<ToolResult> => {
        ensureDir();
        const files = readdirSync(PLUGINS_DIR).filter((f) => f.endsWith(".json"));
        if (!files.length) return { type: "text", content: "No dynamic plugins found." };
        const loaded: string[] = [], errors: string[] = [];
        for (const file of files) {
            try {
                const def = JSON.parse(readFileSync(join(PLUGINS_DIR, file), "utf-8")) as { name: string; description: string; command_template: string; parameters: Record<string, string> };
                loaded.push(def.name);
            } catch (err) { errors.push(`${file}: ${err instanceof Error ? err.message : err}`); }
        }
        const parts: string[] = [];
        if (loaded.length) parts.push(`Loaded: ${loaded.join(", ")}`);
        if (errors.length) parts.push(`Errors: ${errors.join("; ")}`);
        return { type: "text", content: parts.join("\n") || "No plugins loaded." };
    },
};

export const listPluginsTool: ToolDefinition = {
    name: "list_dynamic_plugins",
    description: "List all dynamically created plugins.",
    parameters: { type: "object" as const, properties: {}, required: [] },
    execute: async (): Promise<ToolResult> => {
        ensureDir();
        const files = readdirSync(PLUGINS_DIR).filter((f) => f.endsWith(".json"));
        if (!files.length) return { type: "text", content: "No plugins yet." };
        const lines = [`📦 ${files.length} plugin(s):\n`];
        for (const file of files) {
            try {
                const def = JSON.parse(readFileSync(join(PLUGINS_DIR, file), "utf-8")) as { name: string; description: string; command_template: string; created_at: string };
                lines.push(`  🔌 ${def.name} — ${def.description}\n     Template: ${def.command_template}\n     Created: ${def.created_at}`);
            } catch { lines.push(`  ❌ ${file} (corrupted)`); }
        }
        return { type: "text", content: lines.join("\n") };
    },
};

export const dynamicPluginTools: ToolDefinition[] = [createPluginTool, loadPluginsTool, listPluginsTool];

/**
 * Event Tools — LLM-accessible tools for the event monitoring system.
 *
 * Allows the agent to create, list, and remove event rules so it can
 * instruct itself to react to phone events.
 */

import type { ToolDefinition } from "../agent/tool-registry.js";
import { getEventMonitor } from "./event-monitor.js";
import type { PhoneEventType } from "./event-monitor.js";

// ─── Tool: event_watch ───────────────────────────────────────────────────────

const eventWatchTool: ToolDefinition = {
    name: "event_watch",
    description:
        "Create an event rule — the agent will automatically react when a phone event matches. " +
        'Event types: "notification" (new notification), "battery" (battery level/charging change), ' +
        '"app_change" (foreground app changed), "connectivity" (wifi state changed), ' +
        '"screen_change" (UI changed, requires screen watching to be active). ' +
        "Filters narrow the match (e.g., source=com.whatsapp matches only WhatsApp notifications). " +
        "The action is a natural language task executed when the event fires.",
    parameters: {
        type: "object",
        properties: {
            name: {
                type: "string",
                description: "Human-readable name for this rule (e.g., 'WhatsApp auto-reply')",
            },
            event_type: {
                type: "string",
                description: 'Event type to watch: "notification", "battery", "app_change", "connectivity", or "screen_change"',
                enum: ["notification", "battery", "app_change", "connectivity", "screen_change"],
            },
            filter_key: {
                type: "string",
                description:
                    'Filter key to match against event data. Common keys: ' +
                    '"source" or "package" (for notifications), "level" or "direction" (for battery), ' +
                    '"package" (for app changes). Leave empty for any match.',
            },
            filter_value: {
                type: "string",
                description: "Filter value — substring match (case-insensitive). E.g., 'whatsapp' matches 'com.whatsapp'.",
            },
            action: {
                type: "string",
                description: "Natural language task to execute when event fires (e.g., 'Read and reply to the latest WhatsApp message')",
            },
            cooldown_seconds: {
                type: "number",
                description: "Minimum seconds between firings (default: 60). Prevents spam for frequent events.",
            },
        },
        required: ["name", "event_type", "action"],
    },
    execute: async (args) => {
        const name = String(args.name ?? "");
        const eventType = String(args.event_type ?? "") as PhoneEventType;
        const action = String(args.action ?? "");

        if (!name || !eventType || !action) {
            return { type: "text", content: "Error: name, event_type, and action are required." };
        }

        const validTypes: PhoneEventType[] = ["notification", "battery", "app_change", "connectivity", "screen_change"];
        if (!validTypes.includes(eventType)) {
            return { type: "text", content: `Error: invalid event_type. Must be one of: ${validTypes.join(", ")}` };
        }

        const filter: Record<string, string> = {};
        const filterKey = String(args.filter_key ?? "").trim();
        const filterValue = String(args.filter_value ?? "").trim();
        if (filterKey && filterValue) {
            filter[filterKey] = filterValue;
        }

        const cooldownMs = typeof args.cooldown_seconds === "number"
            ? args.cooldown_seconds * 1000
            : 60_000;

        // Auto-start screen watcher if watching screen_change events
        if (eventType === "screen_change") {
            const monitor = getEventMonitor();
            if (!monitor.isScreenWatchActive) {
                monitor.startScreenWatch();
            }
        }

        const monitor = getEventMonitor();
        const rule = monitor.addRule({ name, eventType, filter, action, cooldownMs });

        return {
            type: "text",
            content:
                `✅ Event rule created!\n` +
                `ID: ${rule.id}\n` +
                `Name: ${rule.name}\n` +
                `Watches: ${rule.eventType}${Object.keys(filter).length ? ` (filter: ${JSON.stringify(filter)})` : ""}\n` +
                `Action: ${rule.action}\n` +
                `Cooldown: ${Math.round(cooldownMs / 1000)}s`,
        };
    },
};

// ─── Tool: event_rules_list ──────────────────────────────────────────────────

const eventRulesListTool: ToolDefinition = {
    name: "event_rules_list",
    description: "List all event monitoring rules (active triggers that react to phone events).",
    parameters: {
        type: "object",
        properties: {},
        required: [],
    },
    execute: async () => {
        const monitor = getEventMonitor();
        const rules = monitor.listRules();

        if (rules.length === 0) {
            return { type: "text", content: "No event rules configured. Use event_watch to create one." };
        }

        const lines = rules.map((r) => {
            const status = r.enabled ? "✅ Active" : "⏸️ Disabled";
            const filterStr = Object.keys(r.filter).length > 0
                ? ` (filter: ${JSON.stringify(r.filter)})`
                : "";
            const lastFired = r.lastFiredAt
                ? new Date(r.lastFiredAt).toLocaleString()
                : "never";
            return (
                `- **${r.name}** [${status}]\n` +
                `  ID: ${r.id}\n` +
                `  Watches: ${r.eventType}${filterStr}\n` +
                `  Action: ${r.action}\n` +
                `  Cooldown: ${Math.round(r.cooldownMs / 1000)}s | Last fired: ${lastFired}`
            );
        });

        const screenWatch = monitor.isScreenWatchActive ? " | 👁️ Screen watch: active" : "";
        return {
            type: "text",
            content: `📋 Event Rules (${rules.length})${screenWatch}:\n\n${lines.join("\n\n")}`,
        };
    },
};

// ─── Tool: event_rule_remove ─────────────────────────────────────────────────

const eventRuleRemoveTool: ToolDefinition = {
    name: "event_rule_remove",
    description: "Remove an event monitoring rule by its ID.",
    parameters: {
        type: "object",
        properties: {
            id: {
                type: "string",
                description: "The rule ID to remove (returned by event_watch or event_rules_list)",
            },
        },
        required: ["id"],
    },
    execute: async (args) => {
        const id = String(args.id ?? "");
        if (!id) {
            return { type: "text", content: "Error: rule ID is required." };
        }

        const monitor = getEventMonitor();
        const removed = monitor.removeRule(id);

        return {
            type: "text",
            content: removed
                ? `✅ Removed event rule: ${id}`
                : `❌ Rule not found: ${id}`,
        };
    },
};

// ─── Tool: screen_watch ──────────────────────────────────────────────────────

const screenWatchTool: ToolDefinition = {
    name: "screen_watch_toggle",
    description:
        "Start or stop the screen watcher. When active, the agent periodically captures the UI tree " +
        "and fires screen_change events when significant changes are detected. " +
        "WARNING: This is resource-intensive (runs uiautomator dump every 30s).",
    parameters: {
        type: "object",
        properties: {
            action: {
                type: "string",
                description: '"start" or "stop"',
                enum: ["start", "stop"],
            },
            interval_seconds: {
                type: "number",
                description: "Polling interval in seconds (default: 30, min: 10). Only used for start.",
            },
        },
        required: ["action"],
    },
    execute: async (args) => {
        const action = String(args.action ?? "");
        const monitor = getEventMonitor();

        if (action === "start") {
            const intervalMs = Math.max(10_000,
                typeof args.interval_seconds === "number" ? args.interval_seconds * 1000 : 30_000,
            );
            monitor.startScreenWatch(intervalMs);
            return {
                type: "text",
                content: `👁️ Screen watcher started (polling every ${intervalMs / 1000}s)`,
            };
        } else if (action === "stop") {
            monitor.stopScreenWatch();
            return { type: "text", content: "👁️ Screen watcher stopped" };
        }

        return { type: "text", content: 'Error: action must be "start" or "stop"' };
    },
};

// ─── Export ──────────────────────────────────────────────────────────────────

export const eventTools: ToolDefinition[] = [
    eventWatchTool,
    eventRulesListTool,
    eventRuleRemoveTool,
    screenWatchTool,
];

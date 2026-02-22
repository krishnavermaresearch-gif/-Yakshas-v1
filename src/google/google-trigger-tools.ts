/**
 * Google Trigger Tools — allow the agent to set up automatic Google event triggers.
 *
 * Example: "When I get a new email from my boss, summarize it and reply"
 * → Creates a gmail_new event rule with filter source=boss, action="summarize and reply"
 */

import { getEventMonitor, type PhoneEventType } from "../autonomy/event-monitor.js";
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";

const GOOGLE_EVENT_TYPES: PhoneEventType[] = [
    "gmail_new",
    "calendar_upcoming",
    "drive_change",
    "tasks_due",
];

export const googleTriggerTools: ToolDefinition[] = [
    {
        name: "google_watch",
        description:
            "Create a Google event trigger — the agent will automatically react when a Google event occurs. " +
            "Event types: gmail_new (new email), calendar_upcoming (event starting within 15 min), " +
            "drive_change (file modified), tasks_due (task due within 1 hour). " +
            "Filters narrow the match (e.g., from=boss@company.com for gmail_new). " +
            "The action is a natural language task executed when the event fires.",
        parameters: {
            type: "object",
            properties: {
                name: {
                    type: "string",
                    description: "Human-readable name for this trigger (e.g., 'Boss email auto-reply')",
                },
                event_type: {
                    type: "string",
                    description: "Google event type: gmail_new, calendar_upcoming, drive_change, tasks_due",
                    enum: ["gmail_new", "calendar_upcoming", "drive_change", "tasks_due"],
                },
                filter: {
                    type: "string",
                    description:
                        "JSON object of filters. For gmail_new: {from, subject}. " +
                        "For calendar_upcoming: {title}. For drive_change: {name}. " +
                        "For tasks_due: {title}. Example: {\"from\":\"boss\"}",
                },
                action: {
                    type: "string",
                    description:
                        "Natural language task to execute when triggered. " +
                        "Example: 'Read the email, summarize it, and send a polite reply'",
                },
                cooldown_seconds: {
                    type: "number",
                    description: "Minimum seconds between firings (default: 120). Prevents spam.",
                },
            },
            required: ["name", "event_type", "action"],
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            const eventType = String(args.event_type) as PhoneEventType;
            if (!GOOGLE_EVENT_TYPES.includes(eventType)) {
                return {
                    type: "text",
                    content: `Invalid event type "${eventType}". Must be one of: ${GOOGLE_EVENT_TYPES.join(", ")}`,
                };
            }

            let filter: Record<string, string> = {};
            if (args.filter) {
                try {
                    filter = typeof args.filter === "string" ? JSON.parse(args.filter) : args.filter as Record<string, string>;
                } catch {
                    return { type: "text", content: "Invalid filter JSON. Use format: {\"from\":\"boss\"}" };
                }
            }

            const cooldownMs = (typeof args.cooldown_seconds === "number" ? args.cooldown_seconds : 120) * 1000;

            const monitor = getEventMonitor();
            const rule = monitor.addRule({
                name: String(args.name),
                eventType,
                filter,
                action: String(args.action),
                cooldownMs,
            });

            const typeDesc: Record<string, string> = {
                gmail_new: "📧 New email",
                calendar_upcoming: "📅 Calendar event starting",
                drive_change: "📁 Drive file changed",
                tasks_due: "📋 Task due soon",
            };

            return {
                type: "text",
                content:
                    `✅ Google trigger created: "${rule.name}"\n` +
                    `Type: ${typeDesc[eventType] ?? eventType}\n` +
                    `Filter: ${JSON.stringify(filter)}\n` +
                    `Action: "${rule.action}"\n` +
                    `Cooldown: ${cooldownMs / 1000}s\n` +
                    `ID: ${rule.id}\n\n` +
                    `The agent will now automatically ${rule.action} when ${typeDesc[eventType]?.toLowerCase() ?? eventType} matches.`,
            };
        },
    },
    {
        name: "google_triggers_list",
        description: "List all active Google event triggers (auto-actions on Gmail, Calendar, Drive, Tasks events).",
        parameters: {
            type: "object",
            properties: {},
            required: [],
        },
        execute: async (): Promise<ToolResult> => {
            const monitor = getEventMonitor();
            const rules = monitor.listRules().filter(r => GOOGLE_EVENT_TYPES.includes(r.eventType));

            if (rules.length === 0) {
                return { type: "text", content: "No Google triggers set up. Use google_watch to create one." };
            }

            const typeEmoji: Record<string, string> = {
                gmail_new: "📧",
                calendar_upcoming: "📅",
                drive_change: "📁",
                tasks_due: "📋",
            };

            const lines = rules.map((r, i) =>
                `${i + 1}. ${typeEmoji[r.eventType] ?? "🔔"} **${r.name}**\n` +
                `   Type: ${r.eventType} | Filter: ${JSON.stringify(r.filter)}\n` +
                `   Action: "${r.action}"\n` +
                `   Cooldown: ${r.cooldownMs / 1000}s | ${r.enabled ? "Active" : "Paused"} | ID: ${r.id}`
            );

            return { type: "text", content: `🔔 Google Triggers:\n\n${lines.join("\n\n")}` };
        },
    },
];

/**
 * Agenda Tools — LLM-accessible tools for the goal/agenda system.
 *
 * Allows the agent to create, list, check, and remove autonomous goals.
 */

import type { ToolDefinition } from "../agent/tool-registry.js";
import { getAgendaManager } from "./agenda.js";
import type { GoalStatus } from "./agenda.js";

// ─── Tool: agenda_add ────────────────────────────────────────────────────────

const agendaAddTool: ToolDefinition = {
    name: "agenda_add",
    description:
        "Create a new autonomous goal. Goals are high-level objectives that the agent " +
        "pursues over time (e.g., 'keep battery above 50% during work hours', " +
        "'monitor WhatsApp for important messages'). Goals can have periodic checks " +
        "via cron expressions and are automatically tracked until completed or removed.",
    parameters: {
        type: "object",
        properties: {
            name: {
                type: "string",
                description: "Short name for the goal",
            },
            description: {
                type: "string",
                description: "Detailed description of what the goal entails",
            },
            success_criteria: {
                type: "string",
                description: "How to determine when the goal is complete (e.g., 'battery is above 50%')",
            },
            priority: {
                type: "number",
                description: "Priority 1 (highest) to 10 (lowest). Default: 5",
            },
            check_expression: {
                type: "string",
                description:
                    "Cron expression for periodic checking (same format as cron_add). " +
                    'Examples: "0 * *" (every hour), "*/30 * *" (every 30 min), ' +
                    '"0 9-17 *" (hourly during work hours). Leave empty for manual checks only.',
            },
            max_checks: {
                type: "number",
                description: "Maximum number of checks before goal is marked as failed. Leave empty for unlimited.",
            },
        },
        required: ["name", "description", "success_criteria"],
    },
    execute: async (args) => {
        const name = String(args.name ?? "");
        const description = String(args.description ?? "");
        const successCriteria = String(args.success_criteria ?? "");

        if (!name || !description || !successCriteria) {
            return { type: "text", content: "Error: name, description, and success_criteria are required." };
        }

        const agenda = getAgendaManager();
        const goal = agenda.addGoal({
            name,
            description,
            successCriteria,
            priority: typeof args.priority === "number" ? args.priority : 5,
            checkExpression: typeof args.check_expression === "string" ? args.check_expression : undefined,
            maxChecks: typeof args.max_checks === "number" ? args.max_checks : undefined,
        });

        return {
            type: "text",
            content:
                `🎯 Goal created!\n` +
                `ID: ${goal.id}\n` +
                `Name: ${goal.name}\n` +
                `Priority: ${goal.priority}\n` +
                `Success criteria: ${goal.successCriteria}\n` +
                (goal.checkExpression ? `Scheduled check: ${goal.checkExpression}\n` : "Manual checks only\n") +
                (goal.maxChecks ? `Max checks: ${goal.maxChecks}` : ""),
        };
    },
};

// ─── Tool: agenda_list ───────────────────────────────────────────────────────

const agendaListTool: ToolDefinition = {
    name: "agenda_list",
    description: "List all goals in the agenda, optionally filtered by status.",
    parameters: {
        type: "object",
        properties: {
            status: {
                type: "string",
                description: 'Filter by status: "active", "paused", "completed", "failed". Leave empty for all.',
                enum: ["active", "paused", "completed", "failed"],
            },
        },
        required: [],
    },
    execute: async (args) => {
        const agenda = getAgendaManager();
        const statusFilter = typeof args.status === "string"
            ? (args.status as GoalStatus)
            : undefined;
        const goals = agenda.listGoals(statusFilter);

        if (goals.length === 0) {
            return {
                type: "text",
                content: statusFilter
                    ? `No ${statusFilter} goals. Use agenda_add to create one.`
                    : "No goals in the agenda. Use agenda_add to create one.",
            };
        }

        const statusEmoji: Record<GoalStatus, string> = {
            active: "🟢",
            paused: "⏸️",
            completed: "✅",
            failed: "❌",
        };

        const lines = goals.map((g) => {
            const emoji = statusEmoji[g.status];
            const subtaskProgress = g.subtasks.length > 0
                ? ` | Subtasks: ${g.subtasks.filter((s) => s.completed).length}/${g.subtasks.length}`
                : "";
            const lastCheck = g.lastCheckedAt
                ? new Date(g.lastCheckedAt).toLocaleString()
                : "never";

            return (
                `${emoji} **${g.name}** [P${g.priority}]\n` +
                `  ID: ${g.id}\n` +
                `  ${g.description}\n` +
                `  Success: ${g.successCriteria}\n` +
                `  Checks: ${g.checkCount}${g.maxChecks ? `/${g.maxChecks}` : ""} | Last: ${lastCheck}${subtaskProgress}`
            );
        });

        return {
            type: "text",
            content: `📋 Agenda (${goals.length} goals):\n\n${lines.join("\n\n")}`,
        };
    },
};

// ─── Tool: agenda_status ─────────────────────────────────────────────────────

const agendaStatusTool: ToolDefinition = {
    name: "agenda_status",
    description:
        "Check the current progress of a specific goal. " +
        "Can also decompose a goal into subtasks or pause/resume it.",
    parameters: {
        type: "object",
        properties: {
            id: {
                type: "string",
                description: "The goal ID",
            },
            action: {
                type: "string",
                description: '"check" (verify progress), "decompose" (break into subtasks), "pause", or "resume"',
                enum: ["check", "decompose", "pause", "resume"],
            },
        },
        required: ["id"],
    },
    execute: async (args) => {
        const id = String(args.id ?? "");
        const action = String(args.action ?? "check");
        const agenda = getAgendaManager();

        const goal = agenda.getGoal(id);
        if (!goal) {
            return { type: "text", content: `❌ Goal not found: ${id}` };
        }

        switch (action) {
            case "decompose": {
                const subtasks = await agenda.decomposeGoal(id);
                if (subtasks.length === 0) {
                    return { type: "text", content: `Could not decompose goal "${goal.name}"` };
                }
                const lines = subtasks.map((s, i) => `  ${i + 1}. ${s.description}`);
                return {
                    type: "text",
                    content: `🔀 Goal "${goal.name}" decomposed:\n${lines.join("\n")}`,
                };
            }
            case "pause": {
                const paused = agenda.pauseGoal(id);
                return {
                    type: "text",
                    content: paused
                        ? `⏸️ Goal "${goal.name}" paused`
                        : `Cannot pause goal (status: ${goal.status})`,
                };
            }
            case "resume": {
                const resumed = agenda.resumeGoal(id);
                return {
                    type: "text",
                    content: resumed
                        ? `▶️ Goal "${goal.name}" resumed`
                        : `Cannot resume goal (status: ${goal.status})`,
                };
            }
            case "check":
            default: {
                const result = await agenda.checkGoal(id);
                const emoji = result.completed ? "✅" : "🔄";
                return {
                    type: "text",
                    content:
                        `${emoji} Goal "${goal.name}": ${result.message}\n` +
                        `Status: ${goal.status} | Checks: ${goal.checkCount}${goal.maxChecks ? `/${goal.maxChecks}` : ""}`,
                };
            }
        }
    },
};

// ─── Tool: agenda_remove ─────────────────────────────────────────────────────

const agendaRemoveTool: ToolDefinition = {
    name: "agenda_remove",
    description: "Remove a goal from the agenda. Also cleans up any scheduled check jobs.",
    parameters: {
        type: "object",
        properties: {
            id: {
                type: "string",
                description: "The goal ID to remove",
            },
        },
        required: ["id"],
    },
    execute: async (args) => {
        const id = String(args.id ?? "");
        if (!id) {
            return { type: "text", content: "Error: goal ID is required." };
        }

        const agenda = getAgendaManager();
        const removed = agenda.removeGoal(id);

        return {
            type: "text",
            content: removed
                ? `✅ Removed goal: ${id}`
                : `❌ Goal not found: ${id}`,
        };
    },
};

// ─── Export ──────────────────────────────────────────────────────────────────

export const agendaTools: ToolDefinition[] = [
    agendaAddTool,
    agendaListTool,
    agendaStatusTool,
    agendaRemoveTool,
];

/**
 * Workflow Tools — agent tools for creating and managing multi-step B2B automations.
 */

import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";
import { getWorkflowEngine } from "./workflow-engine.js";
import { logError } from "../logger.js";

const workflowCreateTool: ToolDefinition = {
    name: "workflow_create",
    description:
        "Create a multi-step automated workflow. Steps execute in sequence, can carry data between them, " +
        "and survive reboots. Use for complex B2B automations like: " +
        "'Watch competitor Instagram → screenshot → OCR → translate → draft in Docs → alert on Telegram'",
    parameters: {
        type: "object",
        properties: {
            name: {
                type: "string",
                description: "Human-readable workflow name (e.g., 'Competitor Monitor')",
            },
            description: {
                type: "string",
                description: "What this workflow does",
            },
            steps: {
                type: "string",
                description:
                    "JSON array of step objects. Each step: {instruction: string, condition?: string, waitForEvent?: string}. " +
                    "Example: [{\"instruction\":\"Take a screenshot of the current screen\"}, " +
                    "{\"instruction\":\"Translate the text to English\"}]",
            },
        },
        required: ["name", "steps"],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        try {
            const engine = getWorkflowEngine();
            let steps: Array<{ instruction: string; condition?: string; waitForEvent?: string }>;

            try {
                steps = JSON.parse(String(args.steps));
            } catch {
                return { type: "text", content: "Error: 'steps' must be valid JSON array" };
            }

            const workflow = engine.create({
                name: String(args.name),
                description: String(args.description ?? args.name),
                steps,
            });

            const stepList = workflow.steps
                .map((s, i) => `  ${i + 1}. ${s.instruction}${s.condition ? ` [if: ${s.condition}]` : ""}${s.waitForEvent ? ` [wait: ${s.waitForEvent}]` : ""}`)
                .join("\n");

            return {
                type: "text",
                content:
                    `✅ Workflow created: "${workflow.name}"\n` +
                    `ID: ${workflow.id}\n` +
                    `Steps (${workflow.steps.length}):\n${stepList}\n\n` +
                    `Status: ${workflow.status}. The workflow will execute automatically.`,
            };
        } catch (err) {
            logError(`Workflow create failed: ${err instanceof Error ? err.message : err}`);
            return { type: "text", content: `Error: ${err instanceof Error ? err.message : err}` };
        }
    },
};

const workflowListTool: ToolDefinition = {
    name: "workflow_list",
    description: "List all workflows — active, paused, completed, or failed.",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (): Promise<ToolResult> => {
        const engine = getWorkflowEngine();
        const workflows = engine.list();

        if (workflows.length === 0) {
            return { type: "text", content: "No workflows found. Use `workflow_create` to create one." };
        }

        const statusEmoji: Record<string, string> = {
            created: "🆕", running: "▶️", paused: "⏸️",
            waiting_trigger: "⏳", completed: "✅", failed: "❌", cancelled: "🚫",
        };

        const lines = workflows.map((wf, i) => {
            const emoji = statusEmoji[wf.status] ?? "❓";
            const progress = `${wf.currentStepIndex}/${wf.steps.length}`;
            return `${i + 1}. ${emoji} **${wf.name}** [${progress} steps] — ${wf.status}\n   ID: ${wf.id}`;
        });

        return { type: "text", content: `🔄 Workflows:\n\n${lines.join("\n\n")}` };
    },
};

const workflowCancelTool: ToolDefinition = {
    name: "workflow_cancel",
    description: "Cancel a running or waiting workflow.",
    parameters: {
        type: "object",
        properties: {
            id: {
                type: "string",
                description: "Workflow ID or name to cancel",
            },
        },
        required: ["id"],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const engine = getWorkflowEngine();
        const id = String(args.id);

        let cancelled = engine.cancel(id);
        if (!cancelled) {
            const byName = engine.getByName(id);
            if (byName) cancelled = engine.cancel(byName.id);
        }

        if (cancelled) {
            return { type: "text", content: `🚫 Workflow "${id}" cancelled.` };
        }
        return { type: "text", content: `Workflow "${id}" not found.` };
    },
};

export const workflowTools: ToolDefinition[] = [
    workflowCreateTool,
    workflowListTool,
    workflowCancelTool,
];

/**
 * Cron Tools — allow the agent to create, list, and remove scheduled tasks.
 *
 * These tools are registered in the tool registry so the LLM can use them.
 */

import type { ToolDefinition } from "../agent/tool-registry.js";
import { getCronScheduler } from "./scheduler.js";

// ─── Tool: cron_add ──────────────────────────────────────────────────────────

const cronAddTool: ToolDefinition = {
    name: "cron_add",
    description:
        'Schedule a task to run at a specific time or interval. ' +
        'Use expression formats: ' +
        '"once:2025-02-20T17:00:00" for one-time at specific datetime, ' +
        '"in:120000" for a one-shot delay in milliseconds (e.g., "in:120000" = 2 minutes from now), ' +
        '"30 9 *" for recurring at 9:30 every day (minute hour day-of-week), ' +
        '"0 */2 *" for every 2 hours, ' +
        '"0 9 1" for every Monday at 9:00 (0=Sun, 1=Mon, ..., 6=Sat). ' +
        'The task parameter is a natural language description that will be executed by the agent when the job fires.',
    parameters: {
        type: "object",
        properties: {
            expression: {
                type: "string",
                description:
                    'Cron expression. Examples: "once:2025-02-20T17:00:00", "in:120000", "30 9 *", "0 */2 1-5"',
            },
            task: {
                type: "string",
                description: "The task to execute when the job fires (natural language)",
            },
            description: {
                type: "string",
                description: "Human-readable description of this scheduled task",
            },
        },
        required: ["expression", "task", "description"],
    },
    execute: async (args) => {
        const expression = String(args.expression ?? "");
        const task = String(args.task ?? "");
        const description = String(args.description ?? task);

        if (!expression || !task) {
            return { type: "text", content: "Error: expression and task are required." };
        }

        const scheduler = getCronScheduler();
        const isOneShot = expression.startsWith("once:") || expression.startsWith("in:");
        const job = scheduler.addJob({ expression, task, description, oneShot: isOneShot });

        return {
            type: "text",
            content: `✅ Scheduled task created!\nID: ${job.id}\nExpression: ${expression}\nTask: ${task}\nType: ${isOneShot ? "one-shot" : "recurring"}`,
        };
    },
};

// ─── Tool: cron_list ─────────────────────────────────────────────────────────

const cronListTool: ToolDefinition = {
    name: "cron_list",
    description: "List all scheduled cron jobs (active and inactive).",
    parameters: {
        type: "object",
        properties: {},
        required: [],
    },
    execute: async () => {
        const scheduler = getCronScheduler();
        const jobs = scheduler.listJobs();

        if (jobs.length === 0) {
            return { type: "text", content: "No scheduled jobs." };
        }

        const lines = jobs.map((j) => {
            const status = j.enabled ? "✅ Active" : "⏸️ Disabled";
            const lastRun = j.lastRunAt
                ? new Date(j.lastRunAt).toLocaleString()
                : "never";
            return `- **${j.description}** [${status}]\n  ID: ${j.id}\n  Schedule: ${j.expression}\n  Task: ${j.task}\n  Last run: ${lastRun}`;
        });

        return { type: "text", content: `📋 Scheduled Jobs (${jobs.length}):\n\n${lines.join("\n\n")}` };
    },
};

// ─── Tool: cron_remove ───────────────────────────────────────────────────────

const cronRemoveTool: ToolDefinition = {
    name: "cron_remove",
    description: "Remove a scheduled cron job by its ID.",
    parameters: {
        type: "object",
        properties: {
            id: {
                type: "string",
                description: "The job ID to remove (returned by cron_add or cron_list)",
            },
        },
        required: ["id"],
    },
    execute: async (args) => {
        const id = String(args.id ?? "");
        if (!id) {
            return { type: "text", content: "Error: job ID is required." };
        }

        const scheduler = getCronScheduler();
        const removed = scheduler.removeJob(id);

        return {
            type: "text",
            content: removed
                ? `✅ Removed scheduled job: ${id}`
                : `❌ Job not found: ${id}`,
        };
    },
};

// ─── Export ──────────────────────────────────────────────────────────────────

export const cronTools: ToolDefinition[] = [cronAddTool, cronListTool, cronRemoveTool];

/**
 * Google Tasks API tools.
 * Manage task lists and individual tasks.
 */
import { simpleGet, simplePost, simplePatch, simpleDelete } from "./api-client.js";
import type { ToolDefinition } from "../agent/tool-registry.js";

const BASE = "https://tasks.googleapis.com/tasks/v1";

export const tasksTools: ToolDefinition[] = [
    {
        name: "tasks_list",
        description: "List tasks from Google Tasks. Shows all tasks from default task list.",
        parameters: {
            type: "object",
            properties: {
                maxResults: { type: "string", description: "Max tasks to return (default 20)" },
            },
            required: [],
        },
        execute: async (args) => {
            try {
                const max = String(args.maxResults ?? "20");
                const lists = await simpleGet(`${BASE}/users/@me/lists`);
                const listId = lists.items?.[0]?.id;
                if (!listId) return { type: "text", content: "No task lists found." };
                const data = await simpleGet(`${BASE}/lists/${listId}/tasks?maxResults=${max}&showCompleted=false`);
                if (!data.items?.length) return { type: "text", content: "No tasks found." };
                const rows = data.items.map((t: any, i: number) =>
                    `${i + 1}. ${t.title}${t.due ? ` (due: ${new Date(t.due).toLocaleDateString()})` : ""}${t.notes ? ` — ${t.notes}` : ""} [id:${t.id}]`
                );
                return { type: "text", content: `📋 Tasks:\n${rows.join("\n")}` };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
    {
        name: "tasks_create",
        description: "Create a new task in Google Tasks.",
        parameters: {
            type: "object",
            properties: {
                title: { type: "string", description: "Task title" },
                notes: { type: "string", description: "Task notes/details" },
                due: { type: "string", description: "Due date (ISO format, e.g. 2026-02-25)" },
            },
            required: ["title"],
        },
        execute: async (args) => {
            try {
                const lists = await simpleGet(`${BASE}/users/@me/lists`);
                const listId = lists.items?.[0]?.id;
                if (!listId) return { type: "text", content: "No task lists found." };
                const body: any = { title: String(args.title) };
                if (args.notes) body.notes = String(args.notes);
                if (args.due) body.due = new Date(String(args.due)).toISOString();
                const task = await simplePost(`${BASE}/lists/${listId}/tasks`, body);
                return { type: "text", content: `✅ Task created: "${task.title}" [id:${task.id}]` };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
    {
        name: "tasks_complete",
        description: "Mark a task as completed.",
        parameters: {
            type: "object",
            properties: {
                taskId: { type: "string", description: "Task ID to complete" },
            },
            required: ["taskId"],
        },
        execute: async (args) => {
            try {
                const lists = await simpleGet(`${BASE}/users/@me/lists`);
                const listId = lists.items?.[0]?.id;
                if (!listId) return { type: "text", content: "No task lists found." };
                await simplePatch(`${BASE}/lists/${listId}/tasks/${args.taskId}`, { status: "completed" });
                return { type: "text", content: `✅ Task marked as completed.` };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
    {
        name: "tasks_delete",
        description: "Delete a task from Google Tasks.",
        parameters: {
            type: "object",
            properties: {
                taskId: { type: "string", description: "Task ID to delete" },
            },
            required: ["taskId"],
        },
        execute: async (args) => {
            try {
                const lists = await simpleGet(`${BASE}/users/@me/lists`);
                const listId = lists.items?.[0]?.id;
                if (!listId) return { type: "text", content: "No task lists found." };
                await simpleDelete(`${BASE}/lists/${listId}/tasks/${args.taskId}`);
                return { type: "text", content: `🗑️ Task deleted.` };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
];

/**
 * Google Chat API tools.
 * Read and send messages in Google Chat spaces.
 */
import { simpleGet, simplePost } from "./api-client.js";
import type { ToolDefinition } from "../agent/tool-registry.js";

const BASE = "https://chat.googleapis.com/v1";

export const chatTools: ToolDefinition[] = [
    {
        name: "chat_spaces",
        description: "List Google Chat spaces (rooms and DMs).",
        parameters: {
            type: "object",
            properties: {
                maxResults: { type: "string", description: "Max spaces to return (default 20)" },
            },
            required: [],
        },
        execute: async (args) => {
            try {
                const max = String(args.maxResults ?? "20");
                const data = await simpleGet(`${BASE}/spaces?pageSize=${max}`);
                if (!data.spaces?.length) return { type: "text", content: "No Chat spaces found." };
                const rows = data.spaces.map((s: any, i: number) =>
                    `${i + 1}. ${s.displayName ?? "DM"} (${s.type}) [name:${s.name}]`
                );
                return { type: "text", content: `💬 Chat spaces:\n${rows.join("\n")}` };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
    {
        name: "chat_read",
        description: "Read recent messages from a Google Chat space.",
        parameters: {
            type: "object",
            properties: {
                spaceName: { type: "string", description: "Space name (e.g. spaces/AAAA)" },
                maxResults: { type: "string", description: "Max messages (default 20)" },
            },
            required: ["spaceName"],
        },
        execute: async (args) => {
            try {
                const max = String(args.maxResults ?? "20");
                const data = await simpleGet(`${BASE}/${args.spaceName}/messages?pageSize=${max}`);
                if (!data.messages?.length) return { type: "text", content: "No messages found." };
                const rows = data.messages.map((m: any, i: number) =>
                    `${i + 1}. ${m.sender?.displayName ?? "Unknown"}: ${m.text ?? "(attachment)"} — ${new Date(m.createTime).toLocaleString()}`
                );
                return { type: "text", content: `💬 Messages:\n${rows.join("\n")}` };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
    {
        name: "chat_send",
        description: "Send a message to a Google Chat space.",
        parameters: {
            type: "object",
            properties: {
                spaceName: { type: "string", description: "Space name (e.g. spaces/AAAA)" },
                text: { type: "string", description: "Message text to send" },
            },
            required: ["spaceName", "text"],
        },
        execute: async (args) => {
            try {
                await simplePost(`${BASE}/${args.spaceName}/messages`, { text: String(args.text) });
                return { type: "text", content: `✅ Message sent to ${args.spaceName}` };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
];

/**
 * Gmail Tools — read, send, and search emails via Gmail API.
 */

import { googleGet, googlePost, requireGoogleAuth } from "./api-client.js";
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

// ─── Types ───────────────────────────────────────────────────────────────────

type GmailMessage = { id: string; threadId: string };
type GmailList = { messages?: GmailMessage[]; resultSizeEstimate: number };
type GmailFull = { id: string; snippet: string; payload: { headers: { name: string; value: string }[]; body?: { data?: string }; parts?: { mimeType: string; body?: { data?: string } }[] }; internalDate: string };

function decodeBase64Url(data: string): string {
    return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

function getHeader(msg: GmailFull, name: string): string {
    return msg.payload.headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function getBody(msg: GmailFull): string {
    if (msg.payload.body?.data) return decodeBase64Url(msg.payload.body.data);
    const textPart = msg.payload.parts?.find(p => p.mimeType === "text/plain");
    if (textPart?.body?.data) return decodeBase64Url(textPart.body.data);
    const htmlPart = msg.payload.parts?.find(p => p.mimeType === "text/html");
    if (htmlPart?.body?.data) return decodeBase64Url(htmlPart.body.data).replace(/<[^>]+>/g, "");
    return "(no readable body)";
}

// ─── Tools ───────────────────────────────────────────────────────────────────

export const gmailTools: ToolDefinition[] = [
    {
        name: "gmail_inbox",
        description: "List recent emails from Gmail inbox. Returns subject, from, date, and snippet for each.",
        parameters: {
            type: "object" as const,
            properties: {
                max_results: { type: "number", description: "Number of emails to retrieve (default 10, max 20)" },
            },
            required: [],
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            const authErr = requireGoogleAuth();
            if (authErr) return { type: "text", content: authErr };

            const max = Math.min(typeof args.max_results === "number" ? args.max_results : 10, 20);
            const res = await googleGet<GmailList>(`${BASE}/messages`, { maxResults: String(max), q: "in:inbox" });
            if (!res.ok) return { type: "text", content: `Gmail API error: ${res.error}` };
            if (!res.data.messages?.length) return { type: "text", content: "Inbox is empty." };

            const emails: string[] = [];
            for (const m of res.data.messages.slice(0, max)) {
                const full = await googleGet<GmailFull>(`${BASE}/messages/${m.id}`, { format: "full" });
                if (!full.ok) continue;
                const d = full.data;
                const date = new Date(parseInt(d.internalDate)).toLocaleString();
                emails.push(`📧 ${getHeader(d, "Subject")}\n   From: ${getHeader(d, "From")}\n   Date: ${date}\n   ${d.snippet}\n   ID: ${m.id}`);
            }
            return { type: "text", content: emails.join("\n\n") };
        },
    },
    {
        name: "gmail_read",
        description: "Read the full content of an email by its ID. Use gmail_inbox first to get IDs.",
        parameters: {
            type: "object" as const,
            properties: {
                message_id: { type: "string", description: "The email message ID" },
            },
            required: ["message_id"],
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            const authErr = requireGoogleAuth();
            if (authErr) return { type: "text", content: authErr };

            const messageId = args.message_id as string;
            const res = await googleGet<GmailFull>(`${BASE}/messages/${messageId}`, { format: "full" });
            if (!res.ok) return { type: "text", content: `Gmail API error: ${res.error}` };

            const d = res.data;
            const body = getBody(d).slice(0, 3000);
            return {
                type: "text",
                content: `Subject: ${getHeader(d, "Subject")}\nFrom: ${getHeader(d, "From")}\nTo: ${getHeader(d, "To")}\nDate: ${new Date(parseInt(d.internalDate)).toLocaleString()}\n\n${body}`,
            };
        },
    },
    {
        name: "gmail_send",
        description: "Send an email via Gmail.",
        parameters: {
            type: "object" as const,
            properties: {
                to: { type: "string", description: "Recipient email address" },
                subject: { type: "string", description: "Email subject" },
                body: { type: "string", description: "Email body (plain text)" },
            },
            required: ["to", "subject", "body"],
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            const authErr = requireGoogleAuth();
            if (authErr) return { type: "text", content: authErr };

            const raw = [
                `To: ${args.to}`,
                `Subject: ${args.subject}`,
                "Content-Type: text/plain; charset=utf-8",
                "",
                args.body,
            ].join("\r\n");

            const encoded = Buffer.from(raw).toString("base64url");
            const res = await googlePost(`${BASE}/messages/send`, { raw: encoded });
            if (!res.ok) return { type: "text", content: `Send failed: ${res.error}` };
            return { type: "text", content: `✅ Email sent to ${args.to}` };
        },
    },
    {
        name: "gmail_search",
        description: "Search emails using Gmail query syntax (e.g., 'from:boss@company.com after:2024/01/01').",
        parameters: {
            type: "object" as const,
            properties: {
                query: { type: "string", description: "Gmail search query" },
                max_results: { type: "number", description: "Max results (default 10)" },
            },
            required: ["query"],
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            const authErr = requireGoogleAuth();
            if (authErr) return { type: "text", content: authErr };

            const query = args.query as string;
            const max = Math.min(typeof args.max_results === "number" ? args.max_results : 10, 20);
            const res = await googleGet<GmailList>(`${BASE}/messages`, { maxResults: String(max), q: query });
            if (!res.ok) return { type: "text", content: `Search failed: ${res.error}` };
            if (!res.data.messages?.length) return { type: "text", content: "No emails found." };

            const emails: string[] = [];
            for (const m of res.data.messages.slice(0, max)) {
                const full = await googleGet<GmailFull>(`${BASE}/messages/${m.id}`, { format: "metadata", metadataHeaders: "Subject,From,Date" });
                if (!full.ok) continue;
                emails.push(`📧 ${getHeader(full.data, "Subject")} — From: ${getHeader(full.data, "From")} [ID: ${m.id}]`);
            }
            return { type: "text", content: emails.join("\n") };
        },
    },
];

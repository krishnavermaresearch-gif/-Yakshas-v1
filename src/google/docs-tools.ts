/**
 * Google Docs Tools — read, create, and append to Google Docs.
 */

import { googleGet, googlePost, requireGoogleAuth } from "./api-client.js";
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";

const DOCS_BASE = "https://docs.googleapis.com/v1/documents";

// ─── Types ───────────────────────────────────────────────────────────────────

type DocContent = {
    documentId: string;
    title: string;
    body: {
        content: {
            paragraph?: { elements: { textRun?: { content: string } }[] };
            endIndex?: number;
        }[];
    };
};

function extractText(doc: DocContent): string {
    const parts: string[] = [];
    for (const block of doc.body.content) {
        if (block.paragraph) {
            for (const el of block.paragraph.elements) {
                if (el.textRun?.content) parts.push(el.textRun.content);
            }
        }
    }
    return parts.join("").slice(0, 5000);
}

// ─── Tools ───────────────────────────────────────────────────────────────────

export const docsTools: ToolDefinition[] = [
    {
        name: "docs_read",
        description: "Read the content of a Google Doc by its ID.",
        parameters: {
            type: "object" as const,
            properties: {
                doc_id: { type: "string", description: "The Google Doc ID (from drive_list or drive_search)" },
            },
            required: ["doc_id"],
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            const authErr = requireGoogleAuth();
            if (authErr) return { type: "text", content: authErr };

            const res = await googleGet<DocContent>(`${DOCS_BASE}/${args.doc_id}`);
            if (!res.ok) return { type: "text", content: `Docs error: ${res.error}` };
            const text = extractText(res.data);
            return { type: "text", content: `📄 ${res.data.title}\n\n${text}` };
        },
    },
    {
        name: "docs_create",
        description: "Create a new Google Doc with the given title and content.",
        parameters: {
            type: "object" as const,
            properties: {
                title: { type: "string", description: "Document title" },
                content: { type: "string", description: "Initial text content" },
            },
            required: ["title"],
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            const authErr = requireGoogleAuth();
            if (authErr) return { type: "text", content: authErr };

            const createRes = await googlePost<{ documentId: string; title: string }>(`${DOCS_BASE}`, {
                title: args.title,
            });
            if (!createRes.ok) return { type: "text", content: `Create failed: ${createRes.error}` };

            if (args.content) {
                await googlePost(`${DOCS_BASE}/${createRes.data.documentId}:batchUpdate`, {
                    requests: [{
                        insertText: {
                            location: { index: 1 },
                            text: args.content as string,
                        },
                    }],
                });
            }

            return {
                type: "text",
                content: `✅ Doc created: "${createRes.data.title}"\nID: ${createRes.data.documentId}\nhttps://docs.google.com/document/d/${createRes.data.documentId}`,
            };
        },
    },
    {
        name: "docs_append",
        description: "Append text to an existing Google Doc.",
        parameters: {
            type: "object" as const,
            properties: {
                doc_id: { type: "string", description: "The Google Doc ID" },
                text: { type: "string", description: "Text to append" },
            },
            required: ["doc_id", "text"],
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            const authErr = requireGoogleAuth();
            if (authErr) return { type: "text", content: authErr };

            const docRes = await googleGet<DocContent>(`${DOCS_BASE}/${args.doc_id}`);
            if (!docRes.ok) return { type: "text", content: `Read error: ${docRes.error}` };

            const content = docRes.data.body.content;
            const lastBlock = content[content.length - 1];
            const endIndex = (lastBlock?.endIndex ?? 2) - 1;

            const res = await googlePost(`${DOCS_BASE}/${args.doc_id}:batchUpdate`, {
                requests: [{
                    insertText: {
                        location: { index: endIndex },
                        text: "\n" + (args.text as string),
                    },
                }],
            });
            if (!res.ok) return { type: "text", content: `Append failed: ${res.error}` };
            return { type: "text", content: `✅ Text appended to doc.` };
        },
    },
];

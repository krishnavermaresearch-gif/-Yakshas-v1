/**
 * Google Drive Tools — list, search, and read files.
 */

import { googleGet, requireGoogleAuth } from "./api-client.js";
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";

const BASE = "https://www.googleapis.com/drive/v3";

// ─── Types ───────────────────────────────────────────────────────────────────

type DriveFile = { id: string; name: string; mimeType: string; modifiedTime: string; size?: string; webViewLink?: string };
type DriveList = { files?: DriveFile[] };

function formatFile(f: DriveFile): string {
    const size = f.size ? `${(parseInt(f.size) / 1024).toFixed(1)}KB` : "—";
    const date = new Date(f.modifiedTime).toLocaleDateString();
    const icon = f.mimeType.includes("folder") ? "📁" : f.mimeType.includes("spreadsheet") ? "📊" : f.mimeType.includes("document") ? "📄" : f.mimeType.includes("presentation") ? "📑" : f.mimeType.includes("image") ? "🖼️" : "📎";
    return `${icon} ${f.name}  (${size}, ${date})  [ID: ${f.id}]`;
}

// ─── Tools ───────────────────────────────────────────────────────────────────

export const driveTools: ToolDefinition[] = [
    {
        name: "drive_list",
        description: "List recent files in Google Drive.",
        parameters: {
            type: "object" as const,
            properties: {
                max_results: { type: "number", description: "Number of files (default 15)" },
            },
            required: [],
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            const authErr = requireGoogleAuth();
            if (authErr) return { type: "text", content: authErr };

            const max = Math.min(typeof args.max_results === "number" ? args.max_results : 15, 30);
            const res = await googleGet<DriveList>(`${BASE}/files`, {
                pageSize: String(max),
                fields: "files(id,name,mimeType,modifiedTime,size,webViewLink)",
                orderBy: "modifiedTime desc",
            });
            if (!res.ok) return { type: "text", content: `Drive error: ${res.error}` };
            if (!res.data.files?.length) return { type: "text", content: "No files found." };
            return { type: "text", content: res.data.files.map(formatFile).join("\n") };
        },
    },
    {
        name: "drive_search",
        description: "Search files in Google Drive by name or type.",
        parameters: {
            type: "object" as const,
            properties: {
                query: { type: "string", description: "Search term (file name)" },
                file_type: { type: "string", description: "Optional: 'document', 'spreadsheet', 'presentation', 'folder', 'image'" },
            },
            required: ["query"],
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            const authErr = requireGoogleAuth();
            if (authErr) return { type: "text", content: authErr };

            const query = args.query as string;
            let q = `name contains '${query.replace(/'/g, "\\'")}'`;
            if (args.file_type) {
                const mimeTypes: Record<string, string> = {
                    document: "application/vnd.google-apps.document",
                    spreadsheet: "application/vnd.google-apps.spreadsheet",
                    presentation: "application/vnd.google-apps.presentation",
                    folder: "application/vnd.google-apps.folder",
                    image: "image/",
                };
                const mt = mimeTypes[args.file_type as string];
                if (mt) q += ` and mimeType ${mt.endsWith("/") ? "contains" : "="} '${mt}'`;
            }

            const res = await googleGet<DriveList>(`${BASE}/files`, {
                q,
                pageSize: "20",
                fields: "files(id,name,mimeType,modifiedTime,size,webViewLink)",
            });
            if (!res.ok) return { type: "text", content: `Search error: ${res.error}` };
            if (!res.data.files?.length) return { type: "text", content: "No files found." };
            return { type: "text", content: res.data.files.map(formatFile).join("\n") };
        },
    },
    {
        name: "drive_read",
        description: "Read the text content of a Google Drive file (Docs, Sheets, or text files). Use drive_list or drive_search to get the file ID.",
        parameters: {
            type: "object" as const,
            properties: {
                file_id: { type: "string", description: "The file ID" },
            },
            required: ["file_id"],
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            const authErr = requireGoogleAuth();
            if (authErr) return { type: "text", content: authErr };

            const fileId = args.file_id as string;
            const res = await googleGet<string>(`${BASE}/files/${fileId}/export`, { mimeType: "text/plain" });
            if (!res.ok) {
                const dl = await googleGet<string>(`${BASE}/files/${fileId}`, { alt: "media" });
                if (!dl.ok) return { type: "text", content: `Read error: ${dl.error}` };
                return { type: "text", content: String(dl.data).slice(0, 5000) };
            }
            return { type: "text", content: String(res.data).slice(0, 5000) };
        },
    },
];

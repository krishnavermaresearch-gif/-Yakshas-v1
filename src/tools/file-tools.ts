/**
 * File Tools — read, write, and list files of any type.
 *
 * Supports text, images (as base64), PDFs (text extraction), JSON, CSV.
 * The agent uses these to process files, read documents, save results.
 */

import {
    readFileSync,
    writeFileSync,
    readdirSync,
    statSync,
    existsSync,
    mkdirSync,
} from "node:fs";
import { resolve, extname, basename, join } from "node:path";
import { logInfo } from "../logger.js";
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_TEXT_CHARS = 50_000;
const WORKSPACE_DIR = resolve(process.cwd(), "data");

// ─── Read File ───────────────────────────────────────────────────────────────

export const readFileTool: ToolDefinition = {
    name: "read_file",
    description: `Read a file from the local filesystem. Supports:
- Text files (.txt, .md, .csv, .json, .xml, .ts, .js, .py, etc.)
- Images (.png, .jpg, .gif, .webp) — returned as base64 description
- Binary files — returns size and type info
For PDFs, use execute_code with a Python PDF reader instead.`,
    parameters: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description: "Absolute path or path relative to the workspace (data/) directory",
            },
        },
        required: ["path"],
    },
    execute: async (args): Promise<ToolResult> => {
        let filePath = args.path as string;
        if (!filePath?.trim()) {
            return { type: "text", content: "Error: No file path provided" };
        }

        // Resolve relative paths against workspace
        if (!filePath.match(/^[A-Z]:\\/i) && !filePath.startsWith("/")) {
            filePath = resolve(WORKSPACE_DIR, filePath);
        }

        if (!existsSync(filePath)) {
            return { type: "text", content: `Error: File not found: ${filePath}` };
        }

        const stat = statSync(filePath);
        if (stat.isDirectory()) {
            return { type: "text", content: `Error: ${filePath} is a directory. Use list_files instead.` };
        }

        if (stat.size > MAX_FILE_SIZE) {
            return { type: "text", content: `Error: File too large (${(stat.size / 1024 / 1024).toFixed(1)} MB). Max: 10 MB` };
        }

        const ext = extname(filePath).toLowerCase();
        logInfo(`📄 Reading file: ${filePath} (${(stat.size / 1024).toFixed(1)} KB)`);

        // Image files
        if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"].includes(ext)) {
            const buffer = readFileSync(filePath);
            const base64 = buffer.toString("base64");
            const mimeTypes: Record<string, string> = {
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".gif": "image/gif",
                ".webp": "image/webp",
                ".bmp": "image/bmp",
            };
            return {
                type: "image",
                content: `Image file: ${basename(filePath)} (${(stat.size / 1024).toFixed(1)} KB, ${ext})`,
                image: { base64, mimeType: mimeTypes[ext] ?? "image/png" },
                buffer,
            };
        }

        // Text/code files
        try {
            const content = readFileSync(filePath, "utf-8");
            return {
                type: "text",
                content: content.length > MAX_TEXT_CHARS
                    ? content.slice(0, MAX_TEXT_CHARS) + `\n\n... (truncated, ${content.length} chars total)`
                    : content,
            };
        } catch {
            // Binary file — report metadata
            return {
                type: "text",
                content: `Binary file: ${basename(filePath)} (${(stat.size / 1024).toFixed(1)} KB, type: ${ext}). Use execute_code to process this file.`,
            };
        }
    },
};

// ─── Write File ──────────────────────────────────────────────────────────────

export const writeFileTool: ToolDefinition = {
    name: "write_file",
    description: `Write content to a file. Creates the file and any parent directories if they don't exist.
Use this to save text, code, data, or results to disk.`,
    parameters: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description: "Absolute path or path relative to the workspace (data/) directory",
            },
            content: {
                type: "string",
                description: "The content to write to the file",
            },
        },
        required: ["path", "content"],
    },
    execute: async (args): Promise<ToolResult> => {
        let filePath = args.path as string;
        const content = args.content as string;

        if (!filePath?.trim()) {
            return { type: "text", content: "Error: No file path provided" };
        }

        // Resolve relative paths
        if (!filePath.match(/^[A-Z]:\\/i) && !filePath.startsWith("/")) {
            filePath = resolve(WORKSPACE_DIR, filePath);
        }

        // Ensure parent directory exists
        const dir = resolve(filePath, "..");
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

        logInfo(`📝 Writing file: ${filePath} (${content.length} chars)`);
        writeFileSync(filePath, content, "utf-8");

        return {
            type: "text",
            content: `✅ Written ${content.length} chars to ${filePath}`,
        };
    },
};

// ─── List Files ──────────────────────────────────────────────────────────────

export const listFilesTool: ToolDefinition = {
    name: "list_files",
    description: `List files and directories in a given path. Returns name, type (file/dir), and size.`,
    parameters: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description: "Directory path to list. Defaults to workspace (data/) directory.",
            },
        },
        required: [],
    },
    execute: async (args): Promise<ToolResult> => {
        let dirPath = (args.path as string) ?? WORKSPACE_DIR;

        if (!dirPath.match(/^[A-Z]:\\/i) && !dirPath.startsWith("/")) {
            dirPath = resolve(WORKSPACE_DIR, dirPath);
        }

        if (!existsSync(dirPath)) {
            return { type: "text", content: `Error: Directory not found: ${dirPath}` };
        }

        const stat = statSync(dirPath);
        if (!stat.isDirectory()) {
            return { type: "text", content: `Error: ${dirPath} is a file, not a directory` };
        }

        logInfo(`📂 Listing: ${dirPath}`);
        const entries = readdirSync(dirPath);
        const lines: string[] = [`Directory: ${dirPath}\n`];

        for (const entry of entries.slice(0, 100)) {
            try {
                const fullPath = join(dirPath, entry);
                const entryStat = statSync(fullPath);
                if (entryStat.isDirectory()) {
                    lines.push(`  📁 ${entry}/`);
                } else {
                    const sizeKb = (entryStat.size / 1024).toFixed(1);
                    lines.push(`  📄 ${entry} (${sizeKb} KB)`);
                }
            } catch {
                lines.push(`  ❓ ${entry} (inaccessible)`);
            }
        }

        if (entries.length > 100) lines.push(`  ... and ${entries.length - 100} more`);
        lines.push(`\nTotal: ${entries.length} items`);

        return { type: "text", content: lines.join("\n") };
    },
};

export const fileTools: ToolDefinition[] = [readFileTool, writeFileTool, listFilesTool];

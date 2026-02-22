/**
 * File System Tools — Read, Write, Search Files on the Host PC
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { logInfo, logWarn } from "../logger.js";
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";

const BLOCKED_PATHS = [/^\/etc\//i, /^\/sys\//i, /^\/proc\//i, /^C:\\Windows\\/i, /^C:\\Program Files/i, /\.ssh/i, /\.gnupg/i, /\.env$/i, /password/i];

function isBlocked(p: string): boolean { return BLOCKED_PATHS.some((r) => r.test(resolve(p))); }
function expandHome(p: string): string { return p.startsWith("~") ? join(homedir(), p.slice(1)) : p; }

export const pcReadFileTool: ToolDefinition = {
    name: "pc_read_file",
    description: "Read a text file on the host PC (max 10000 chars). ⚠️ System/credential files blocked.",
    parameters: { type: "object" as const, properties: { path: { type: "string", description: "File path" } }, required: ["path"] },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const p = resolve(expandHome(String(args.path ?? "").trim()));
        if (!p) return { type: "text", content: "Error: path is required." };
        if (isBlocked(p)) { logWarn(`🛡️ Blocked: ${p}`); return { type: "text", content: "SECURITY FAULT: Access blocked." }; }
        if (!existsSync(p)) return { type: "text", content: `Not found: ${p}` };
        try {
            let c = readFileSync(p, "utf-8");
            if (c.length > 10000) c = c.slice(0, 10000) + `\n... [truncated, ${c.length} total]`;
            logInfo(`📄 Read: ${p}`);
            return { type: "text", content: c };
        } catch (err) { return { type: "text", content: `Read failed: ${err instanceof Error ? err.message : err}` }; }
    },
};

export const pcWriteFileTool: ToolDefinition = {
    name: "pc_write_file",
    description: "Write content to a file on the host PC. ⚠️ Cannot write executables or system files.",
    parameters: { type: "object" as const, properties: { path: { type: "string", description: "File path" }, content: { type: "string", description: "Text content" } }, required: ["path", "content"] },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const p = resolve(expandHome(String(args.path ?? "").trim()));
        const content = String(args.content ?? "");
        if (!p) return { type: "text", content: "Error: path is required." };
        if (isBlocked(p)) { logWarn(`🛡️ Blocked: ${p}`); return { type: "text", content: "SECURITY FAULT: Write blocked." }; }
        if ([".exe", ".bat", ".cmd", ".scr", ".pif", ".msi", ".vbs", ".ps1"].includes(extname(p).toLowerCase())) {
            return { type: "text", content: "SECURITY FAULT: Writing executables is blocked." };
        }
        try {
            const dir = join(p, "..");
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            writeFileSync(p, content, "utf-8");
            logInfo(`📝 Wrote: ${p} (${content.length} chars)`);
            return { type: "text", content: `Written: ${p} (${content.length} chars)` };
        } catch (err) { return { type: "text", content: `Write failed: ${err instanceof Error ? err.message : err}` }; }
    },
};

export const pcListDirTool: ToolDefinition = {
    name: "pc_list_dir",
    description: "List files and folders in a directory on the host PC.",
    parameters: { type: "object" as const, properties: { path: { type: "string", description: "Directory path" } }, required: ["path"] },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const p = resolve(expandHome(String(args.path ?? "").trim()));
        if (!p) return { type: "text", content: "Error: path is required." };
        if (isBlocked(p)) return { type: "text", content: "SECURITY FAULT: Access blocked." };
        if (!existsSync(p)) return { type: "text", content: `Not found: ${p}` };
        try {
            const entries = readdirSync(p);
            const fmt = (b: number) => b < 1024 ? `${b}B` : b < 1048576 ? `${(b / 1024).toFixed(1)}KB` : `${(b / 1048576).toFixed(1)}MB`;
            const lines = [`📁 ${p} (${entries.length} items)`, ""];
            for (const e of entries.slice(0, 100)) {
                try { const s = statSync(join(p, e)); lines.push(`  ${s.isDirectory() ? "📁" : "📄"} ${e}${s.isDirectory() ? "" : ` (${fmt(s.size)})`}`); }
                catch { lines.push(`  ❓ ${e}`); }
            }
            if (entries.length > 100) lines.push(`  ... and ${entries.length - 100} more`);
            return { type: "text", content: lines.join("\n") };
        } catch (err) { return { type: "text", content: `List failed: ${err instanceof Error ? err.message : err}` }; }
    },
};

export const pcSearchFilesTool: ToolDefinition = {
    name: "pc_search_files",
    description: "Search for files by name pattern in a directory (recursive).",
    parameters: { type: "object" as const, properties: { directory: { type: "string", description: "Starting directory" }, pattern: { type: "string", description: "Filename pattern (e.g., '*.pdf')" } }, required: ["directory", "pattern"] },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const dir = resolve(expandHome(String(args.directory ?? "").trim()));
        const pattern = String(args.pattern ?? "").trim();
        if (!dir || !pattern) return { type: "text", content: "Error: directory and pattern required." };
        if (isBlocked(dir)) return { type: "text", content: "SECURITY FAULT: Access blocked." };
        try {
            const results = process.platform === "win32"
                ? execSync(`powershell -NoProfile -Command "Get-ChildItem -Path '${dir}' -Recurse -Filter '${pattern}' -EA SilentlyContinue | Select -First 50 FullName | % { $_.FullName }"`, { encoding: "utf-8", timeout: 30_000, windowsHide: true })
                : execSync(`find "${dir}" -iname "${pattern}" -maxdepth 5 2>/dev/null | head -50`, { encoding: "utf-8", timeout: 30_000 });
            const files = results.trim().split("\n").filter(Boolean);
            if (!files.length) return { type: "text", content: `No files matching "${pattern}" in ${dir}.` };
            logInfo(`🔍 Found ${files.length} files`);
            return { type: "text", content: `Found ${files.length} file(s):\n\n${files.join("\n")}` };
        } catch (err) { return { type: "text", content: `Search failed: ${err instanceof Error ? err.message : err}` }; }
    },
};

export const fileSystemTools: ToolDefinition[] = [pcReadFileTool, pcWriteFileTool, pcListDirTool, pcSearchFilesTool];

/**
 * Browser Automation — Web Browsing for PC
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { logInfo } from "../logger.js";
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";

function openUrl(url: string): void {
    switch (process.platform) {
        case "win32": execSync(`start "" "${url}"`, { windowsHide: true }); break;
        case "darwin": execSync(`open "${url}"`); break;
        default: execSync(`xdg-open "${url}" 2>/dev/null`); break;
    }
}

export const pcBrowseTool: ToolDefinition = {
    name: "pc_browse",
    description: "Open a URL in the default web browser on the host PC.",
    parameters: { type: "object" as const, properties: { url: { type: "string", description: "URL to open" } }, required: ["url"] },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const url = String(args.url ?? "").trim();
        if (!url) return { type: "text", content: "Error: url is required." };
        const fullUrl = url.startsWith("http") ? url : `https://${url}`;
        try {
            openUrl(fullUrl);
            await new Promise((r) => setTimeout(r, 2000));
            logInfo(`🌐 Opened: ${fullUrl}`);
            return { type: "text", content: `Opened "${fullUrl}" in browser. Use pc_screenshot to see it.` };
        } catch (err) {
            return { type: "text", content: `Failed: ${err instanceof Error ? err.message : err}` };
        }
    },
};

export const pcWebSearchTool: ToolDefinition = {
    name: "pc_web_search",
    description: "Search Google in the default browser. Use pc_screenshot to read results.",
    parameters: { type: "object" as const, properties: { query: { type: "string", description: "Search query" } }, required: ["query"] },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const query = String(args.query ?? "").trim();
        if (!query) return { type: "text", content: "Error: query is required." };
        try {
            openUrl(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
            await new Promise((r) => setTimeout(r, 2500));
            logInfo(`🔍 Searched: "${query}"`);
            return { type: "text", content: `Searched Google for "${query}". Use pc_screenshot to read results.` };
        } catch (err) {
            return { type: "text", content: `Search failed: ${err instanceof Error ? err.message : err}` };
        }
    },
};

export const pcDownloadTool: ToolDefinition = {
    name: "pc_download",
    description: "Download a file from a URL to ~/Downloads. ⚠️ Executable files are blocked.",
    parameters: {
        type: "object" as const,
        properties: {
            url: { type: "string", description: "URL of the file to download" },
            filename: { type: "string", description: "Optional filename to save as" },
        },
        required: ["url"],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const url = String(args.url ?? "").trim();
        if (!url) return { type: "text", content: "Error: url is required." };
        if (/\.(exe|bat|cmd|scr|pif|msi|vbs|ps1|sh)$/i.test(url)) {
            return { type: "text", content: "SECURITY FAULT: Downloading executable files is blocked." };
        }
        const dir = join(homedir(), "Downloads");
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const filename = String(args.filename ?? "") || url.split("/").pop()?.split("?")[0] || `download_${Date.now()}`;
        const filepath = join(dir, filename);
        try {
            if (process.platform === "win32") {
                execSync(`powershell -NoProfile -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${filepath.replace(/\\/g, "\\\\")}' -UseBasicParsing"`, { timeout: 60_000, windowsHide: true });
            } else {
                execSync(`curl -sL -o "${filepath}" "${url}"`, { timeout: 60_000 });
            }
            logInfo(`⬇️ Downloaded: ${filepath}`);
            return { type: "text", content: `Downloaded to: ${filepath}\n⚠️ File was NOT executed.` };
        } catch (err) {
            return { type: "text", content: `Download failed: ${err instanceof Error ? err.message : err}` };
        }
    },
};

export const browserTools: ToolDefinition[] = [pcBrowseTool, pcWebSearchTool, pcDownloadTool];

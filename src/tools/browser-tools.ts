/**
 * Browser & Internet Tools — web search, page reading, file download.
 *
 * Uses built-in Node.js fetch (no Playwright needed).
 * The agent uses these to research information, read docs, download files.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { logInfo } from "../logger.js";
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const DOWNLOADS_DIR = resolve(process.cwd(), "data", "downloads");
const MAX_PAGE_CHARS = 30_000;
const FETCH_TIMEOUT_MS = 15_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Strip HTML tags and collapse whitespace */
function htmlToText(html: string): string {
    return html
        // Remove script and style blocks
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        // Remove HTML comments
        .replace(/<!--[\s\S]*?-->/g, "")
        // Convert common block elements to newlines
        .replace(/<\/(p|div|h[1-6]|li|tr|br\s*\/?)>/gi, "\n")
        .replace(/<br\s*\/?>/gi, "\n")
        // Remove remaining tags
        .replace(/<[^>]+>/g, "")
        // Decode common entities
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        // Collapse whitespace
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

// ─── Web Search ──────────────────────────────────────────────────────────────

export const webSearchTool: ToolDefinition = {
    name: "web_search",
    description: `Search the internet using Google. Returns top results with titles, descriptions, and URLs.
Use this to find information, look up facts, research topics, find documentation.`,
    parameters: {
        type: "object",
        properties: {
            query: {
                type: "string",
                description: "Search query (e.g. 'weather in Tokyo today')",
            },
            num_results: {
                type: "string",
                description: "Number of results to return (default: 5, max: 10)",
            },
        },
        required: ["query"],
    },
    execute: async (args): Promise<ToolResult> => {
        const query = args.query as string;
        const numResults = Math.min(Number(args.num_results) || 5, 10);

        if (!query?.trim()) {
            return { type: "text", content: "Error: No search query provided" };
        }

        logInfo(`🔍 Web search: "${query}"`);

        try {
            // Use Google's search page and parse results
            const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${numResults}`;
            const res = await fetch(url, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Accept-Language": "en-US,en;q=0.9",
                },
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });

            if (!res.ok) {
                return { type: "text", content: `Search failed: HTTP ${res.status}` };
            }

            const html = await res.text();
            const text = htmlToText(html);

            // Return the cleaned text (Google's text results are quite readable)
            return {
                type: "text",
                content: `Search results for "${query}":\n\n${text.slice(0, MAX_PAGE_CHARS)}`,
            };
        } catch (err) {
            return {
                type: "text",
                content: `Search error: ${err instanceof Error ? err.message : err}`,
            };
        }
    },
};

// ─── Web Read Page ───────────────────────────────────────────────────────────

export const webReadPageTool: ToolDefinition = {
    name: "web_read_page",
    description: `Fetch and read the text content of a web page. Strips HTML tags and returns clean text.
Use this to read articles, documentation, API responses, or any web page.`,
    parameters: {
        type: "object",
        properties: {
            url: {
                type: "string",
                description: "The URL to fetch and read",
            },
        },
        required: ["url"],
    },
    execute: async (args): Promise<ToolResult> => {
        const url = args.url as string;

        if (!url?.trim()) {
            return { type: "text", content: "Error: No URL provided" };
        }

        logInfo(`🌐 Reading page: ${url}`);

        try {
            const res = await fetch(url, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                },
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });

            if (!res.ok) {
                return { type: "text", content: `Failed to fetch ${url}: HTTP ${res.status}` };
            }

            const contentType = res.headers.get("content-type") ?? "";

            // If JSON, return formatted
            if (contentType.includes("application/json")) {
                const json = await res.json();
                return { type: "text", content: JSON.stringify(json, null, 2).slice(0, MAX_PAGE_CHARS) };
            }

            // If text/plain, return as-is
            if (contentType.includes("text/plain")) {
                const text = await res.text();
                return { type: "text", content: text.slice(0, MAX_PAGE_CHARS) };
            }

            // HTML — convert to text
            const html = await res.text();
            const text = htmlToText(html);
            return { type: "text", content: text.slice(0, MAX_PAGE_CHARS) };
        } catch (err) {
            return {
                type: "text",
                content: `Error reading ${url}: ${err instanceof Error ? err.message : err}`,
            };
        }
    },
};

// ─── Web Download File ───────────────────────────────────────────────────────

export const webDownloadFileTool: ToolDefinition = {
    name: "web_download_file",
    description: `Download a file from the internet to the local filesystem.
Use this to download images, documents, data files, etc.`,
    parameters: {
        type: "object",
        properties: {
            url: {
                type: "string",
                description: "URL of the file to download",
            },
            filename: {
                type: "string",
                description: "Optional filename to save as. If not provided, uses the URL's filename.",
            },
        },
        required: ["url"],
    },
    execute: async (args): Promise<ToolResult> => {
        const url = args.url as string;
        const filename = (args.filename as string) || basename(new URL(url).pathname) || "download";

        if (!url?.trim()) {
            return { type: "text", content: "Error: No URL provided" };
        }

        logInfo(`📥 Downloading: ${url} → ${filename}`);

        try {
            if (!existsSync(DOWNLOADS_DIR)) mkdirSync(DOWNLOADS_DIR, { recursive: true });

            const res = await fetch(url, {
                signal: AbortSignal.timeout(60_000), // 60s for downloads
            });

            if (!res.ok) {
                return { type: "text", content: `Download failed: HTTP ${res.status}` };
            }

            const buffer = Buffer.from(await res.arrayBuffer());
            const filePath = join(DOWNLOADS_DIR, filename);
            writeFileSync(filePath, buffer);

            return {
                type: "text",
                content: `✅ Downloaded to ${filePath} (${(buffer.length / 1024).toFixed(1)} KB)`,
            };
        } catch (err) {
            return {
                type: "text",
                content: `Download error: ${err instanceof Error ? err.message : err}`,
            };
        }
    },
};

export const browserTools: ToolDefinition[] = [webSearchTool, webReadPageTool, webDownloadFileTool];

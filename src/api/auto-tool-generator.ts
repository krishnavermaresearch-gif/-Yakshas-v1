/**
 * Auto Tool Generator — automatically creates tools from API configurations.
 *
 * When a user adds an API via `/addapi`, this module generates a live tool
 * that the agent can use to make HTTP requests to that API. No hardcoded
 * templates — the AI figures out endpoints, methods, and payloads based on
 * its training knowledge of each service.
 *
 * Each API gets a `api_<name>` tool that can:
 * - GET, POST, PUT, DELETE, PATCH to any endpoint
 * - Pass query params, headers, and JSON body
 * - Returns the API response directly to the agent
 */

import { logInfo, logDebug } from "../logger.js";
import { getApiManager, type ApiConfig } from "./api-manager.js";
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";
import { type ToolRegistry } from "../agent/tool-registry.js";

// ─── Auto Tool Generator ────────────────────────────────────────────────────

/**
 * Generate tools for all configured APIs and register them.
 * Called during orchestrator init and after /addapi.
 */
export function generateApiTools(registry: ToolRegistry): number {
    const manager = getApiManager();
    const apis = manager.listApis();
    let count = 0;

    for (const name of apis) {
        const config = manager.getApi(name);
        if (!config) continue;

        const tool = createApiTool(config);
        registry.register(tool);
        count++;
        logInfo(`Auto-tool created: ${tool.name} → ${config.baseUrl ?? name}`);
    }

    return count;
}

/**
 * Create a single tool for one API config.
 * The tool allows the agent to make arbitrary HTTP requests to the API.
 */
function createApiTool(config: ApiConfig): ToolDefinition {
    const toolName = `api_${config.name.replace(/[^a-z0-9]/g, "_")}`;

    return {
        name: toolName,
        description:
            `Make HTTP requests to the ${config.name} API.` +
            (config.baseUrl ? ` Base URL: ${config.baseUrl}.` : "") +
            ` Authentication is handled automatically. ` +
            `Use your knowledge of the ${config.name} API to choose the right endpoint, method, and parameters.`,
        parameters: {
            type: "object",
            properties: {
                endpoint: {
                    type: "string",
                    description:
                        "API endpoint path (e.g., '/v1/messages', '/users/me'). " +
                        "Will be appended to the base URL. Include leading slash.",
                },
                method: {
                    type: "string",
                    description: "HTTP method to use.",
                    enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
                },
                body: {
                    type: "string",
                    description:
                        "JSON body for POST/PUT/PATCH requests. Must be valid JSON string. " +
                        "Omit for GET/DELETE requests.",
                },
                query: {
                    type: "string",
                    description:
                        "Query parameters as key=value pairs joined by '&' (e.g., 'limit=10&offset=0'). " +
                        "Omit if not needed.",
                },
                headers: {
                    type: "string",
                    description:
                        "Extra headers as JSON object (e.g., '{\"X-Custom\": \"value\"}'). " +
                        "Auth headers are added automatically. Omit if not needed.",
                },
            },
            required: ["endpoint", "method"],
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            return executeApiRequest(config, args);
        },
    };
}

/**
 * Execute an API request with auto-authentication.
 */
async function executeApiRequest(
    config: ApiConfig,
    args: Record<string, unknown>,
): Promise<ToolResult> {
    const endpoint = String(args.endpoint ?? "/");
    const method = String(args.method ?? "GET").toUpperCase();
    const bodyStr = args.body ? String(args.body) : undefined;
    const queryStr = args.query ? String(args.query) : undefined;
    const extraHeadersStr = args.headers ? String(args.headers) : undefined;

    // Build URL
    let baseUrl = config.baseUrl ?? `https://api.${config.name}.com`;
    // Remove trailing slash from base
    baseUrl = baseUrl.replace(/\/+$/, "");
    // Ensure endpoint starts with /
    const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    let url = `${baseUrl}${path}`;

    // Add query params
    if (queryStr) {
        const separator = url.includes("?") ? "&" : "?";
        url += `${separator}${queryStr}`;
    }

    // Build headers with auto-auth
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...buildAuthHeaders(config),
    };

    // Merge extra headers
    if (extraHeadersStr) {
        try {
            const extra = JSON.parse(extraHeadersStr) as Record<string, string>;
            Object.assign(headers, extra);
        } catch {
            // Ignore invalid header JSON
        }
    }

    // Add any extra config headers
    if (config.extra) {
        Object.assign(headers, config.extra);
    }

    logDebug(`API ${config.name}: ${method} ${url}`);

    try {
        const fetchOptions: RequestInit = {
            method,
            headers,
            signal: AbortSignal.timeout(30_000),
        };

        if (bodyStr && ["POST", "PUT", "PATCH"].includes(method)) {
            fetchOptions.body = bodyStr;
        }

        const resp = await fetch(url, fetchOptions);
        const contentType = resp.headers.get("content-type") ?? "";

        let responseText: string;
        if (contentType.includes("application/json")) {
            const json = await resp.json();
            responseText = JSON.stringify(json, null, 2);
        } else {
            responseText = await resp.text();
        }

        // Truncate very long responses
        if (responseText.length > 4000) {
            responseText = responseText.slice(0, 4000) + "\n... [truncated]";
        }

        const statusInfo = resp.ok ? "OK" : `Error ${resp.status}`;
        return {
            type: "text",
            content: `${config.name} API ${method} ${endpoint} → ${resp.status} ${statusInfo}\n\n${responseText}`,
        };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
            type: "text",
            content: `${config.name} API request failed: ${msg}`,
        };
    }
}

/**
 * Build authentication headers based on common API patterns.
 * Tries multiple auth strategies — the API will accept whichever is correct.
 */
function buildAuthHeaders(config: ApiConfig): Record<string, string> {
    const headers: Record<string, string> = {};
    const key = config.key;

    // Common auth header patterns
    headers["Authorization"] = `Bearer ${key}`;

    // Some APIs use X-API-Key
    headers["X-API-Key"] = key;

    return headers;
}

// ─── Singleton helper ────────────────────────────────────────────────────────

/**
 * Refresh all API tools in a registry. Called when APIs change.
 */
export function refreshApiTools(registry: ToolRegistry): void {
    const count = generateApiTools(registry);
    if (count > 0) {
        logInfo(`Refreshed ${count} API tools`);
    }
}

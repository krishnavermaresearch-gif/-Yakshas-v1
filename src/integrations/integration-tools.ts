/**
 * Integration Tools — let users add, manage, and call ANY third-party API.
 *
 * Tools:
 *  - integration_add      — Connect a new API (from template or custom)
 *  - integration_list     — List connected integrations
 *  - integration_remove   — Disconnect an integration
 *  - integration_call     — Make an API call to a connected service
 *  - integration_templates — Show available pre-built templates
 */

import { getIntegrationStore, type AuthType, type IntegrationCredentials } from "./integration-store.js";
import { getTemplate, listTemplates } from "./templates.js";
import { logInfo, logError } from "../logger.js";
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";

// ─── Helper: HTTP fetch with integration auth ────────────────────────────────

async function integrationFetch(
    integrationId: string,
    method: string,
    path: string,
    body?: unknown,
    queryParams?: Record<string, string>,
): Promise<{ status: number; data: unknown }> {
    const store = getIntegrationStore();
    const integration = store.get(integrationId) ?? store.getByName(integrationId);
    if (!integration) throw new Error(`Integration "${integrationId}" not found`);
    if (!integration.enabled) throw new Error(`Integration "${integration.displayName}" is disabled`);

    const authHeaders = store.buildAuthHeaders(integration);
    const url = new URL(path.startsWith("http") ? path : `${integration.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`);

    // Add default params + extra params
    for (const [k, v] of Object.entries({ ...integration.defaultParams, ...queryParams })) {
        url.searchParams.set(k, v);
    }

    const headers: Record<string, string> = {
        ...authHeaders,
    };
    if (body && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
    }

    const fetchOptions: RequestInit = {
        method: method.toUpperCase(),
        headers,
    };
    if (body && method.toUpperCase() !== "GET") {
        fetchOptions.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    const response = await fetch(url.toString(), fetchOptions);
    let data: unknown;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
        data = await response.json();
    } else {
        data = await response.text();
    }

    return { status: response.status, data };
}

// ─── Tools ───────────────────────────────────────────────────────────────────

const integrationAddTool: ToolDefinition = {
    name: "integration_add",
    description:
        "Connect a new third-party API integration. Use a template (odoo, shopify, whatsapp_business, " +
        "instagram, facebook, github, slack, notion, amazon_sp, openai) or provide custom config. " +
        "The agent stores credentials securely with AES-256-GCM encryption.",
    parameters: {
        type: "object",
        properties: {
            template: {
                type: "string",
                description:
                    "Template ID to use (e.g., 'odoo', 'shopify', 'github'). " +
                    "Use integration_templates to see all available. Leave empty for custom API.",
            },
            name: {
                type: "string",
                description: "Name for this integration (e.g., 'my_odoo', 'work_slack'). Required for custom APIs.",
            },
            base_url: {
                type: "string",
                description: "Base URL of the API (e.g., 'https://api.example.com/v1'). Required for custom, optional for templates.",
            },
            auth_type: {
                type: "string",
                description: "Auth type: api_key, bearer, basic, oauth2, custom_header, none",
            },
            api_key: {
                type: "string",
                description: "API key (for api_key auth type)",
            },
            token: {
                type: "string",
                description: "Bearer/access token (for bearer or oauth2 auth type)",
            },
            username: {
                type: "string",
                description: "Username (for basic auth type)",
            },
            password: {
                type: "string",
                description: "Password (for basic auth type)",
            },
        },
        required: [],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        try {
            const store = getIntegrationStore();
            const templateId = args.template as string | undefined;

            let name: string;
            let baseUrl: string;
            let authType: AuthType;
            let credentials: IntegrationCredentials = {};
            let displayName: string;
            let defaultHeaders: Record<string, string> = {};

            if (templateId) {
                const template = getTemplate(templateId);
                if (!template) {
                    const available = listTemplates().map(t => t.id).join(", ");
                    return { type: "text", content: `Template "${templateId}" not found. Available: ${available}` };
                }

                name = args.name as string ?? template.name;
                baseUrl = (args.base_url as string) ?? template.baseUrl;
                authType = template.authType;
                displayName = template.displayName;
                defaultHeaders = template.defaultHeaders;

                // Check if user needs to customize the URL
                if (baseUrl.includes("YOUR-")) {
                    if (!args.base_url) {
                        return {
                            type: "text",
                            content:
                                `Template "${template.displayName}" requires a custom URL.\n` +
                                `Current template URL: ${baseUrl}\n` +
                                `Please provide your actual URL via the base_url parameter.\n\n` +
                                `Setup: ${template.setupInstructions}`,
                        };
                    }
                }
            } else {
                name = args.name as string;
                baseUrl = args.base_url as string;
                authType = (args.auth_type as AuthType) ?? "bearer";
                displayName = name;
                if (!name || !baseUrl) {
                    return {
                        type: "text",
                        content: "For custom integrations, both 'name' and 'base_url' are required. Or use a template.",
                    };
                }
            }

            // Build credentials from args
            if (args.api_key) credentials.apiKey = String(args.api_key);
            if (args.token) {
                credentials.bearerToken = String(args.token);
                credentials.accessToken = String(args.token);
            }
            if (args.username) credentials.username = String(args.username);
            if (args.password) credentials.password = String(args.password);

            const integration = store.add({
                name,
                displayName,
                baseUrl,
                authType,
                credentials,
                defaultHeaders,
                templateId,
            });

            return {
                type: "text",
                content:
                    `✅ Integration connected: "${integration.displayName}"\n` +
                    `ID: ${integration.id}\n` +
                    `URL: ${integration.baseUrl}\n` +
                    `Auth: ${integration.authType}\n\n` +
                    `You can now use \`integration_call\` with name="${integration.name}" to make API calls.`,
            };
        } catch (err) {
            logError(`Integration add failed: ${err instanceof Error ? err.message : err}`);
            return { type: "text", content: `Error: ${err instanceof Error ? err.message : err}` };
        }
    },
};

const integrationListTool: ToolDefinition = {
    name: "integration_list",
    description: "List all connected third-party API integrations.",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (): Promise<ToolResult> => {
        const store = getIntegrationStore();
        const integrations = store.list();

        if (integrations.length === 0) {
            return {
                type: "text",
                content: "No integrations connected. Use `integration_add` or `integration_templates` to get started.",
            };
        }

        const lines = integrations.map((int, i) => {
            const status = int.enabled ? "✅" : "⛔";
            const template = int.templateId ? ` (template: ${int.templateId})` : "";
            return `${i + 1}. ${status} **${int.displayName}**${template}\n   URL: ${int.baseUrl}\n   Auth: ${int.authType} | ID: ${int.id}`;
        });

        return { type: "text", content: `🔗 Connected Integrations:\n\n${lines.join("\n\n")}` };
    },
};

const integrationRemoveTool: ToolDefinition = {
    name: "integration_remove",
    description: "Remove/disconnect a third-party API integration.",
    parameters: {
        type: "object",
        properties: {
            id: {
                type: "string",
                description: "Integration ID or name to remove",
            },
        },
        required: ["id"],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const store = getIntegrationStore();
        const id = String(args.id);

        // Try by ID first, then by name
        let removed = store.remove(id);
        if (!removed) {
            const byName = store.getByName(id);
            if (byName) removed = store.remove(byName.id);
        }

        if (removed) {
            return { type: "text", content: `✅ Integration "${id}" removed. Credentials securely deleted.` };
        }
        return { type: "text", content: `Integration "${id}" not found. Use integration_list to see all.` };
    },
};

const integrationCallTool: ToolDefinition = {
    name: "integration_call",
    description:
        "Make an API call to a connected third-party service. Supports GET, POST, PUT, PATCH, DELETE. " +
        "Example: integration_call name=odoo method=GET path=/api/contacts",
    parameters: {
        type: "object",
        properties: {
            name: {
                type: "string",
                description: "Integration name or ID (e.g., 'odoo', 'github', 'slack')",
            },
            method: {
                type: "string",
                description: "HTTP method: GET, POST, PUT, PATCH, DELETE (default: GET)",
            },
            path: {
                type: "string",
                description: "API endpoint path (e.g., '/repos/user/repo/issues'). Appended to base URL.",
            },
            body: {
                type: "string",
                description: "Request body as JSON string (for POST/PUT/PATCH)",
            },
            params: {
                type: "string",
                description: "Query parameters as JSON string (e.g., '{\"page\":\"1\",\"per_page\":\"10\"}')",
            },
        },
        required: ["name", "path"],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        try {
            const name = String(args.name);
            const method = String(args.method ?? "GET").toUpperCase();
            const path = String(args.path);

            let body: unknown;
            if (args.body) {
                try {
                    body = typeof args.body === "string" ? JSON.parse(args.body) : args.body;
                } catch {
                    body = args.body;
                }
            }

            let queryParams: Record<string, string> = {};
            if (args.params) {
                try {
                    queryParams = typeof args.params === "string" ? JSON.parse(args.params) : args.params as Record<string, string>;
                } catch {
                    // ignore
                }
            }

            logInfo(`Integration call: ${method} ${name}${path}`);
            const result = await integrationFetch(name, method, path, body, queryParams);

            const responseStr = typeof result.data === "string"
                ? result.data.slice(0, 3000)
                : JSON.stringify(result.data, null, 2).slice(0, 3000);

            return {
                type: "text",
                content: `📡 ${method} ${path} → ${result.status}\n\n${responseStr}`,
            };
        } catch (err) {
            logError(`Integration call failed: ${err instanceof Error ? err.message : err}`);
            return { type: "text", content: `Error: ${err instanceof Error ? err.message : err}` };
        }
    },
};

const integrationTemplatesTool: ToolDefinition = {
    name: "integration_templates",
    description: "Show available pre-built API integration templates (Odoo, Shopify, WhatsApp, Instagram, GitHub, etc.)",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (): Promise<ToolResult> => {
        const templates = listTemplates();
        const byCategory = new Map<string, typeof templates>();

        for (const t of templates) {
            const list = byCategory.get(t.category) ?? [];
            list.push(t);
            byCategory.set(t.category, list);
        }

        const sections: string[] = [];
        for (const [category, items] of byCategory) {
            const lines = items.map(t =>
                `  • **${t.displayName}** (\`${t.id}\`) — ${t.description}\n    Auth: ${t.authType} | Setup: ${t.setupInstructions.slice(0, 80)}...`
            );
            sections.push(`**${category}**\n${lines.join("\n")}`);
        }

        return {
            type: "text",
            content:
                `📦 Available Integration Templates:\n\n${sections.join("\n\n")}\n\n` +
                `To connect: \`integration_add template=<id> token=<your-token>\`\n` +
                `For custom API: \`integration_add name=myapi base_url=https://api.example.com token=abc123\``,
        };
    },
};

// ─── Export ──────────────────────────────────────────────────────────────────

export const integrationTools: ToolDefinition[] = [
    integrationAddTool,
    integrationListTool,
    integrationRemoveTool,
    integrationCallTool,
    integrationTemplatesTool,
];

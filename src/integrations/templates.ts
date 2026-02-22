/**
 * Integration Templates — pre-built configs for popular third-party APIs.
 *
 * Users can say "connect odoo" and the agent auto-fills the base URL,
 * auth type, and default headers — the user only provides credentials.
 */

import type { AuthType } from "./integration-store.js";

export interface IntegrationTemplate {
    id: string;
    name: string;
    displayName: string;
    description: string;
    category: string;
    baseUrl: string;
    authType: AuthType;
    defaultHeaders: Record<string, string>;
    defaultParams: Record<string, string>;
    /** What credentials the user needs to provide */
    requiredCredentials: string[];
    /** Help text for the user */
    setupInstructions: string;
}

export const INTEGRATION_TEMPLATES: IntegrationTemplate[] = [
    // ─── Business & ERP ─────────────────────────────────────────────────
    {
        id: "odoo",
        name: "odoo",
        displayName: "Odoo ERP",
        description: "ERP system — manage invoices, contacts, products, sales orders",
        category: "Business",
        baseUrl: "https://YOUR-DOMAIN.odoo.com",
        authType: "api_key",
        defaultHeaders: { "Content-Type": "application/json" },
        defaultParams: {},
        requiredCredentials: ["apiKey"],
        setupInstructions: "Go to Odoo → Settings → API Keys → Generate. Provide your Odoo domain (e.g., mycompany.odoo.com) and the API key.",
    },
    {
        id: "shopify",
        name: "shopify",
        displayName: "Shopify",
        description: "E-commerce — orders, products, customers, inventory",
        category: "Business",
        baseUrl: "https://YOUR-STORE.myshopify.com/admin/api/2024-01",
        authType: "bearer",
        defaultHeaders: { "Content-Type": "application/json" },
        defaultParams: {},
        requiredCredentials: ["bearerToken"],
        setupInstructions: "Go to Shopify Admin → Settings → Apps → Develop apps → Create app → Generate API access token.",
    },
    {
        id: "notion",
        name: "notion",
        displayName: "Notion",
        description: "Workspace — pages, databases, blocks, search",
        category: "Productivity",
        baseUrl: "https://api.notion.com/v1",
        authType: "bearer",
        defaultHeaders: { "Content-Type": "application/json", "Notion-Version": "2022-06-28" },
        defaultParams: {},
        requiredCredentials: ["bearerToken"],
        setupInstructions: "Go to notion.so/my-integrations → New integration → Copy the Internal Integration Token.",
    },

    // ─── Social Media ───────────────────────────────────────────────────
    {
        id: "whatsapp_business",
        name: "whatsapp_business",
        displayName: "WhatsApp Business",
        description: "WhatsApp Business API — send/receive messages, manage contacts",
        category: "Messaging",
        baseUrl: "https://graph.facebook.com/v18.0",
        authType: "bearer",
        defaultHeaders: { "Content-Type": "application/json" },
        defaultParams: {},
        requiredCredentials: ["bearerToken"],
        setupInstructions: "Go to developers.facebook.com → WhatsApp → API Setup → Copy the temporary or permanent access token. Also note your Phone Number ID.",
    },
    {
        id: "instagram",
        name: "instagram",
        displayName: "Instagram Graph API",
        description: "Instagram — posts, stories, insights, comments",
        category: "Social Media",
        baseUrl: "https://graph.facebook.com/v18.0",
        authType: "bearer",
        defaultHeaders: {},
        defaultParams: {},
        requiredCredentials: ["bearerToken"],
        setupInstructions: "Go to developers.facebook.com → Create App → Add Instagram Graph API → Generate User Token with required permissions.",
    },
    {
        id: "facebook",
        name: "facebook",
        displayName: "Facebook Graph API",
        description: "Facebook — pages, posts, insights, comments",
        category: "Social Media",
        baseUrl: "https://graph.facebook.com/v18.0",
        authType: "bearer",
        defaultHeaders: {},
        defaultParams: {},
        requiredCredentials: ["bearerToken"],
        setupInstructions: "Go to developers.facebook.com → Create App → Generate Page Access Token with manage_pages and publish_pages permissions.",
    },

    // ─── Developer Tools ────────────────────────────────────────────────
    {
        id: "github",
        name: "github",
        displayName: "GitHub",
        description: "GitHub — repos, issues, pull requests, actions",
        category: "Developer",
        baseUrl: "https://api.github.com",
        authType: "bearer",
        defaultHeaders: { "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
        defaultParams: {},
        requiredCredentials: ["bearerToken"],
        setupInstructions: "Go to github.com → Settings → Developer settings → Personal access tokens → Generate new token.",
    },
    {
        id: "slack",
        name: "slack",
        displayName: "Slack",
        description: "Slack — messages, channels, users, reactions",
        category: "Messaging",
        baseUrl: "https://slack.com/api",
        authType: "bearer",
        defaultHeaders: { "Content-Type": "application/json" },
        defaultParams: {},
        requiredCredentials: ["bearerToken"],
        setupInstructions: "Go to api.slack.com/apps → Create New App → OAuth & Permissions → Install to Workspace → Copy Bot User OAuth Token.",
    },

    // ─── E-commerce ─────────────────────────────────────────────────────
    {
        id: "amazon_sp",
        name: "amazon_sp",
        displayName: "Amazon SP-API",
        description: "Amazon Seller — orders, inventory, products, reports",
        category: "E-commerce",
        baseUrl: "https://sellingpartnerapi-na.amazon.com",
        authType: "oauth2",
        defaultHeaders: { "Content-Type": "application/json" },
        defaultParams: {},
        requiredCredentials: ["clientId", "clientSecret", "accessToken", "refreshToken"],
        setupInstructions: "Register as Amazon developer → Create SP-API app → Get LWA credentials (Client ID, Client Secret) → Generate Refresh Token.",
    },

    // ─── AI & Cloud ─────────────────────────────────────────────────────
    {
        id: "openai",
        name: "openai",
        displayName: "OpenAI API",
        description: "OpenAI — GPT, DALL-E, Whisper, embeddings",
        category: "AI",
        baseUrl: "https://api.openai.com/v1",
        authType: "bearer",
        defaultHeaders: { "Content-Type": "application/json" },
        defaultParams: {},
        requiredCredentials: ["bearerToken"],
        setupInstructions: "Go to platform.openai.com → API Keys → Create new secret key.",
    },
];

export function getTemplate(id: string): IntegrationTemplate | undefined {
    return INTEGRATION_TEMPLATES.find(t => t.id === id);
}

export function listTemplates(): IntegrationTemplate[] {
    return INTEGRATION_TEMPLATES;
}

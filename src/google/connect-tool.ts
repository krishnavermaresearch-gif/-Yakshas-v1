/**
 * Google Connect Tool — start/check/revoke the OAuth connection.
 */

import { getGoogleAuth, GOOGLE_SCOPES } from "../oauth/google-auth.js";
import { getOAuthServer } from "../oauth/oauth-server.js";
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";

export const connectTools: ToolDefinition[] = [
    {
        name: "google_connect",
        description: "Start the Google OAuth flow. Sends an authorization link for the user to click. After authorization, the agent gets access to Gmail, Drive, Calendar, Docs, Sheets, Contacts, YouTube, and Maps.",
        parameters: { type: "object" as const, properties: {}, required: [] },
        execute: async (): Promise<ToolResult> => {
            if (getGoogleAuth().isConnected()) {
                return { type: "text", content: "Google is already connected! Use google_status to see details." };
            }
            if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
                return {
                    type: "text", content: [
                        "⚠️ Google OAuth credentials not configured.",
                        "",
                        "Add to your .env file:",
                        "  GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com",
                        "  GOOGLE_CLIENT_SECRET=your-client-secret",
                        "",
                        "Setup: https://console.cloud.google.com → APIs & Services → Credentials",
                        `Redirect URI: http://localhost:${process.env.OAUTH_CALLBACK_PORT ?? "9876"}/oauth/callback`,
                    ].join("\n")
                };
            }
            try {
                const { authUrl, waitForCallback } = await getOAuthServer().startAuthFlow();
                waitForCallback().catch(() => { });
                return { type: "text", content: `🔗 Click to connect Google:\n\n${authUrl}\n\n✅ After authorizing:\n📧 Gmail  📅 Calendar  📁 Drive  📄 Docs  📊 Sheets  👤 Contacts  🎬 YouTube  🗺️ Maps` };
            } catch (err) {
                return { type: "text", content: `OAuth error: ${err instanceof Error ? err.message : err}` };
            }
        },
    },
    {
        name: "google_status",
        description: "Check Google connection status and available services.",
        parameters: { type: "object" as const, properties: {}, required: [] },
        execute: async (): Promise<ToolResult> => {
            const auth = getGoogleAuth();
            if (!auth.isConnected()) return { type: "text", content: "❌ Google not connected. Use google_connect." };
            const scopes = auth.getScopes();
            const icons: Record<string, string> = { gmail: "📧", drive: "📁", calendar: "📅", docs: "📄", sheets: "📊", people: "👤", youtube: "🎬", maps: "🗺️" };
            const services = Object.entries(GOOGLE_SCOPES)
                .filter(([, scope]) => scopes.some(s => s.includes(scope)))
                .map(([name]) => `  ${icons[name] ?? "✅"} ${name}`);
            return { type: "text", content: `✅ Google connected!\n\n${services.join("\n")}` };
        },
    },
    {
        name: "google_disconnect",
        description: "Disconnect Google — revokes access and removes stored tokens.",
        parameters: { type: "object" as const, properties: {}, required: [] },
        execute: async (): Promise<ToolResult> => {
            try {
                await getGoogleAuth().disconnect();
                return { type: "text", content: "✅ Google disconnected." };
            } catch (err) {
                return { type: "text", content: `Disconnect failed: ${err instanceof Error ? err.message : err}` };
            }
        },
    },
];

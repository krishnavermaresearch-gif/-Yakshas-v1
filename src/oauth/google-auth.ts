/**
 * Google OAuth 2.0 — Authorization code flow.
 *
 * Handles:
 *  - Building authorization URLs with all Google scopes
 *  - Exchanging auth codes for tokens
 *  - Auto-refreshing expired access tokens
 *  - Token revocation
 */

import { getTokenStore, type OAuthTokens } from "./token-store.js";
import { logInfo, logWarn, logError } from "../logger.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const PROVIDER = "google";

/** All Google API scopes the agent can request. */
export const GOOGLE_SCOPES: Record<string, string> = {
    // Core services
    gmail: "https://www.googleapis.com/auth/gmail.modify",
    drive: "https://www.googleapis.com/auth/drive",
    calendar: "https://www.googleapis.com/auth/calendar",
    docs: "https://www.googleapis.com/auth/documents",
    sheets: "https://www.googleapis.com/auth/spreadsheets",
    people: "https://www.googleapis.com/auth/contacts",
    youtube: "https://www.googleapis.com/auth/youtube",
    // Expanded services
    tasks: "https://www.googleapis.com/auth/tasks",
    photos: "https://www.googleapis.com/auth/photoslibrary",
    books: "https://www.googleapis.com/auth/books",
    blogger: "https://www.googleapis.com/auth/blogger",
    classroom: "https://www.googleapis.com/auth/classroom.courses.readonly",
    classroom_work: "https://www.googleapis.com/auth/classroom.coursework.me",
    forms: "https://www.googleapis.com/auth/forms.body.readonly",
    forms_responses: "https://www.googleapis.com/auth/forms.responses.readonly",
    chat: "https://www.googleapis.com/auth/chat.spaces.readonly",
    chat_messages: "https://www.googleapis.com/auth/chat.messages",
    slides: "https://www.googleapis.com/auth/presentations",
    translate: "https://www.googleapis.com/auth/cloud-translation",
    youtube_analytics: "https://www.googleapis.com/auth/yt-analytics.readonly",
};

// ─── Config ──────────────────────────────────────────────────────────────────

function getClientId(): string {
    const id = process.env.GOOGLE_CLIENT_ID;
    if (!id) throw new Error("GOOGLE_CLIENT_ID not set in .env");
    return id;
}

function getClientSecret(): string {
    const secret = process.env.GOOGLE_CLIENT_SECRET;
    if (!secret) throw new Error("GOOGLE_CLIENT_SECRET not set in .env");
    return secret;
}

function getRedirectUri(): string {
    const port = process.env.OAUTH_CALLBACK_PORT ?? "9876";
    return `http://localhost:${port}/oauth/callback`;
}

// ─── Google Auth ─────────────────────────────────────────────────────────────

export class GoogleAuth {

    /**
     * Generate the authorization URL for the user to click.
     * @param state  Random state parameter for CSRF prevention
     * @param scopes Which scopes to request (default: all)
     */
    getAuthUrl(state: string, scopes?: string[]): string {
        const scopeList = scopes ?? Object.values(GOOGLE_SCOPES);
        const params = new URLSearchParams({
            client_id: getClientId(),
            redirect_uri: getRedirectUri(),
            response_type: "code",
            scope: scopeList.join(" "),
            access_type: "offline",        // get refresh_token
            prompt: "consent",         // always show consent → ensures refresh_token
            state,
        });
        return `${GOOGLE_AUTH_URL}?${params.toString()}`;
    }

    /**
     * Exchange an authorization code for access + refresh tokens.
     */
    async exchangeCode(code: string): Promise<OAuthTokens> {
        logInfo("Exchanging Google auth code for tokens...");

        const body = new URLSearchParams({
            code,
            client_id: getClientId(),
            client_secret: getClientSecret(),
            redirect_uri: getRedirectUri(),
            grant_type: "authorization_code",
        });

        const res = await fetch(GOOGLE_TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
        });

        if (!res.ok) {
            const err = await res.text();
            logError(`Token exchange failed: ${err}`);
            throw new Error(`Google token exchange failed: ${res.status} ${err}`);
        }

        const data = await res.json() as {
            access_token: string;
            refresh_token?: string;
            expires_in: number;
            token_type: string;
            scope: string;
        };

        const tokens: OAuthTokens = {
            access_token: data.access_token,
            refresh_token: data.refresh_token ?? "",
            expires_at: Date.now() + data.expires_in * 1000,
            token_type: data.token_type,
            scope: data.scope,
        };

        // Persist
        getTokenStore().set(PROVIDER, tokens);
        logInfo("✅ Google OAuth tokens stored successfully");
        return tokens;
    }

    /**
     * Refresh the access token using the stored refresh token.
     */
    async refreshAccessToken(): Promise<OAuthTokens> {
        const store = getTokenStore();
        const current = store.get(PROVIDER);
        if (!current?.refresh_token) {
            throw new Error("No Google refresh token available — re-authorize");
        }

        logInfo("Refreshing Google access token...");

        const body = new URLSearchParams({
            client_id: getClientId(),
            client_secret: getClientSecret(),
            refresh_token: current.refresh_token,
            grant_type: "refresh_token",
        });

        const res = await fetch(GOOGLE_TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
        });

        if (!res.ok) {
            const err = await res.text();
            logError(`Token refresh failed: ${err}`);
            throw new Error(`Google token refresh failed: ${res.status}`);
        }

        const data = await res.json() as {
            access_token: string;
            expires_in: number;
            token_type: string;
            scope: string;
        };

        const updated: OAuthTokens = {
            access_token: data.access_token,
            refresh_token: current.refresh_token,  // refresh token doesn't rotate
            expires_at: Date.now() + data.expires_in * 1000,
            token_type: data.token_type,
            scope: data.scope ?? current.scope,
        };

        store.set(PROVIDER, updated);
        logInfo("✅ Google access token refreshed");
        return updated;
    }

    /**
     * Get a valid access token, refreshing if needed.
     * This is the main method tools should call.
     */
    async getAccessToken(): Promise<string> {
        const store = getTokenStore();
        if (!store.has(PROVIDER)) {
            throw new Error("Google not connected. Use the google_connect tool first.");
        }

        if (store.isExpired(PROVIDER)) {
            const refreshed = await this.refreshAccessToken();
            return refreshed.access_token;
        }

        return store.get(PROVIDER)!.access_token;
    }

    /** Check if Google is connected. */
    isConnected(): boolean {
        return getTokenStore().has(PROVIDER);
    }

    /** Get connected scopes. */
    getScopes(): string[] {
        const t = getTokenStore().get(PROVIDER);
        return t ? t.scope.split(" ") : [];
    }

    /**
     * Revoke access and remove stored tokens.
     */
    async disconnect(): Promise<void> {
        const store = getTokenStore();
        const tokens = store.get(PROVIDER);

        if (tokens) {
            try {
                await fetch(`${GOOGLE_REVOKE_URL}?token=${tokens.access_token}`, {
                    method: "POST",
                });
            } catch {
                logWarn("Could not revoke token at Google — removing locally anyway");
            }
        }

        store.remove(PROVIDER);
        logInfo("Google disconnected");
    }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _auth: GoogleAuth | null = null;

export function getGoogleAuth(): GoogleAuth {
    if (!_auth) _auth = new GoogleAuth();
    return _auth;
}

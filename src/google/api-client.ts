/**
 * Google API Client — shared fetch wrapper with automatic auth.
 *
 * All Google service tools use this client for API calls.
 * Handles: auth headers, auto-refresh, JSON parsing, error handling.
 */

import { getGoogleAuth } from "../oauth/google-auth.js";
import { logError, logDebug } from "../logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type GoogleApiResponse<T> = {
    ok: true;
    data: T;
} | {
    ok: false;
    error: string;
    status: number;
};

// ─── Google API Client ───────────────────────────────────────────────────────

/**
 * Make an authenticated GET request to a Google API.
 */
export async function googleGet<T = unknown>(url: string, params?: Record<string, string>): Promise<GoogleApiResponse<T>> {
    return googleFetch<T>(url, { method: "GET", params });
}

/**
 * Make an authenticated POST request to a Google API.
 */
export async function googlePost<T = unknown>(url: string, body?: unknown): Promise<GoogleApiResponse<T>> {
    return googleFetch<T>(url, { method: "POST", body });
}

/**
 * Make an authenticated DELETE request to a Google API.
 */
export async function googleDelete<T = unknown>(url: string): Promise<GoogleApiResponse<T>> {
    return googleFetch<T>(url, { method: "DELETE" });
}

/**
 * Make an authenticated PATCH request to a Google API.
 */
export async function googlePatch<T = unknown>(url: string, body?: unknown): Promise<GoogleApiResponse<T>> {
    return googleFetch<T>(url, { method: "PATCH", body });
}

/**
 * Core fetch wrapper with Google OAuth authentication.
 */
async function googleFetch<T>(
    url: string,
    opts: { method: string; params?: Record<string, string>; body?: unknown },
): Promise<GoogleApiResponse<T>> {
    try {
        const auth = getGoogleAuth();
        const accessToken = await auth.getAccessToken();

        // Build URL with query params
        let fullUrl = url;
        if (opts.params) {
            const qs = new URLSearchParams(opts.params).toString();
            fullUrl += (url.includes("?") ? "&" : "?") + qs;
        }

        const headers: Record<string, string> = {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
        };

        const fetchOpts: RequestInit = {
            method: opts.method,
            headers,
        };

        if (opts.body !== undefined) {
            headers["Content-Type"] = "application/json";
            fetchOpts.body = JSON.stringify(opts.body);
        }

        logDebug(`Google API: ${opts.method} ${url}`);

        const res = await fetch(fullUrl, fetchOpts);

        if (!res.ok) {
            const errText = await res.text();
            logError(`Google API error: ${res.status} ${errText.slice(0, 200)}`);
            return { ok: false, error: errText.slice(0, 500), status: res.status };
        }

        // Some endpoints return 204 No Content
        if (res.status === 204) {
            return { ok: true, data: {} as T };
        }

        const data = await res.json() as T;
        return { ok: true, data };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError(`Google API fetch error: ${msg}`);
        return { ok: false, error: msg, status: 0 };
    }
}

/**
 * Helper: Ensure Google is connected before making API calls.
 * Returns an error string if not connected, or null if OK.
 */
export function requireGoogleAuth(): string | null {
    if (!getGoogleAuth().isConnected()) {
        return "Google is not connected. Tell the user to use 'connect google' first.";
    }
    return null;
}

// ─── Simple helpers (throw on error, return data directly) ───────────────────
// Use these in new tools for cleaner code.

export async function simpleGet(url: string, params?: Record<string, string>): Promise<any> {
    const res = await googleGet(url, params);
    if (!res.ok) throw new Error(res.error);
    return res.data;
}

export async function simplePost(url: string, body?: unknown): Promise<any> {
    const res = await googlePost(url, body);
    if (!res.ok) throw new Error(res.error);
    return res.data;
}

export async function simplePatch(url: string, body?: unknown): Promise<any> {
    const res = await googlePatch(url, body);
    if (!res.ok) throw new Error(res.error);
    return res.data;
}

export async function simpleDelete(url: string): Promise<any> {
    const res = await googleDelete(url);
    if (!res.ok) throw new Error(res.error);
    return res.data;
}


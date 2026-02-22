/**
 * API Manager — manage third-party API keys via Telegram commands.
 *
 * Users can add/remove/list API keys for any app/service through Telegram:
 *   /addapi <service_name> <api_key>
 *   /removeapi <service_name>
 *   /listapis
 *
 * APIs are stored in data/apis.json and made available to the agent's tools.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { logInfo, logWarn } from "../logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ApiConfig = {
    name: string;
    key: string;
    /** Optional base URL for the API */
    baseUrl?: string;
    /** Extra headers or params */
    extra?: Record<string, string>;
    addedAt: number;
};

// ─── API Manager ─────────────────────────────────────────────────────────────

export class ApiManager {
    private apis: Map<string, ApiConfig> = new Map();
    private readonly storePath: string;

    constructor(storePath?: string) {
        this.storePath = storePath ?? resolve(process.cwd(), "data", "apis.json");
        this.load();
    }

    /** Add or update an API configuration. */
    addApi(name: string, key: string, baseUrl?: string, extra?: Record<string, string>): void {
        const normalized = name.toLowerCase().trim();
        this.apis.set(normalized, {
            name: normalized,
            key,
            baseUrl,
            extra,
            addedAt: Date.now(),
        });
        this.save();
        logInfo(`API added: ${normalized}`);
    }

    /** Remove an API by name. */
    removeApi(name: string): boolean {
        const normalized = name.toLowerCase().trim();
        const removed = this.apis.delete(normalized);
        if (removed) {
            this.save();
            logInfo(`API removed: ${normalized}`);
        }
        return removed;
    }

    /** Get an API config by name. */
    getApi(name: string): ApiConfig | undefined {
        return this.apis.get(name.toLowerCase().trim());
    }

    /** List all configured API names. */
    listApis(): string[] {
        return Array.from(this.apis.keys());
    }

    /** Get all APIs as a formatted string for prompt injection. */
    getApisForPrompt(): string {
        if (this.apis.size === 0) return "";

        const lines = Array.from(this.apis.values()).map((api) => {
            let desc = `- **${api.name}**: API key configured`;
            if (api.baseUrl) desc += ` (${api.baseUrl})`;
            return desc;
        });

        return `## Available APIs\nThese third-party APIs are available for enhanced functionality:\n${lines.join("\n")}`;
    }

    /** Get API key for use in tools (returns just the key string). */
    getKey(name: string): string | undefined {
        return this.getApi(name)?.key;
    }

    // ── Persistence ──────────────────────────────────────────────────────────

    private save(): void {
        try {
            const dir = dirname(this.storePath);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

            const data: Record<string, ApiConfig> = {};
            for (const [key, val] of this.apis) {
                data[key] = val;
            }
            writeFileSync(this.storePath, JSON.stringify(data, null, 2), "utf-8");
        } catch (err) {
            logWarn(`Failed to save APIs: ${err instanceof Error ? err.message : err}`);
        }
    }

    private load(): void {
        if (!existsSync(this.storePath)) return;

        try {
            const raw = readFileSync(this.storePath, "utf-8");
            const data = JSON.parse(raw) as Record<string, ApiConfig>;
            for (const [key, val] of Object.entries(data)) {
                this.apis.set(key, val);
            }
            logInfo(`Loaded ${this.apis.size} API configs`);
        } catch (err) {
            logWarn(`Failed to load APIs: ${err instanceof Error ? err.message : err}`);
        }
    }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _apiManager: ApiManager | null = null;

export function getApiManager(): ApiManager {
    if (!_apiManager) {
        _apiManager = new ApiManager();
    }
    return _apiManager;
}

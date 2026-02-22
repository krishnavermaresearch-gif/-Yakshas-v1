/**
 * Integration Store — encrypted storage for third-party API configurations.
 *
 * Stores API credentials (API keys, Bearer tokens, Basic auth, OAuth2)
 * securely using AES-256-GCM encryption, same pattern as token-store.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { createHash, randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { logInfo, logWarn } from "../logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AuthType = "api_key" | "bearer" | "basic" | "oauth2" | "custom_header" | "none";

export interface IntegrationConfig {
    id: string;
    name: string;               // e.g., "odoo", "shopify", "whatsapp"
    displayName: string;        // e.g., "My Odoo ERP"
    baseUrl: string;            // e.g., "https://mycompany.odoo.com/api"
    authType: AuthType;
    /** Encrypted credential blob */
    credentials: string;
    /** Extra default headers (non-secret) */
    defaultHeaders: Record<string, string>;
    /** Default query params */
    defaultParams: Record<string, string>;
    /** Template ID if created from template */
    templateId?: string;
    createdAt: number;
    enabled: boolean;
}

export interface IntegrationCredentials {
    apiKey?: string;
    bearerToken?: string;
    username?: string;
    password?: string;
    clientId?: string;
    clientSecret?: string;
    accessToken?: string;
    refreshToken?: string;
    /** Custom header name → value for custom_header auth */
    customHeaders?: Record<string, string>;
}

// ─── Config ──────────────────────────────────────────────────────────────────

const DATA_DIR = resolve(process.cwd(), "data");
const STORE_FILE = resolve(DATA_DIR, "integrations.json");
const ALGO = "aes-256-gcm";

// ─── Encryption ──────────────────────────────────────────────────────────────

function getEncKey(): Buffer {
    const seed = `integration-store-${process.env.TELEGRAM_BOT_TOKEN ?? "default"}-salt`;
    return createHash("sha256").update(seed).digest();
}

function encrypt(data: string): string {
    const key = getEncKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, key, iv);
    const encrypted = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decrypt(blob: string): string {
    const [ivHex, tagHex, dataHex] = blob.split(":");
    const key = getEncKey();
    const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return decipher.update(Buffer.from(dataHex, "hex"), undefined, "utf8") + decipher.final("utf8");
}

// ─── Store ───────────────────────────────────────────────────────────────────

class IntegrationStore {
    private integrations = new Map<string, IntegrationConfig>();

    constructor() {
        this.load();
    }

    add(config: {
        name: string;
        displayName?: string;
        baseUrl: string;
        authType: AuthType;
        credentials: IntegrationCredentials;
        defaultHeaders?: Record<string, string>;
        defaultParams?: Record<string, string>;
        templateId?: string;
    }): IntegrationConfig {
        const id = `int_${config.name.toLowerCase().replace(/\s+/g, "_")}_${Date.now().toString(36)}`;
        const integration: IntegrationConfig = {
            id,
            name: config.name.toLowerCase().replace(/\s+/g, "_"),
            displayName: config.displayName ?? config.name,
            baseUrl: config.baseUrl.replace(/\/+$/, ""),
            authType: config.authType,
            credentials: encrypt(JSON.stringify(config.credentials)),
            defaultHeaders: config.defaultHeaders ?? {},
            defaultParams: config.defaultParams ?? {},
            templateId: config.templateId,
            createdAt: Date.now(),
            enabled: true,
        };
        this.integrations.set(id, integration);
        this.save();
        logInfo(`Integration added: "${integration.displayName}" (${integration.name})`);
        return integration;
    }

    remove(id: string): boolean {
        const removed = this.integrations.delete(id);
        if (removed) this.save();
        return removed;
    }

    get(id: string): IntegrationConfig | undefined {
        return this.integrations.get(id);
    }

    getByName(name: string): IntegrationConfig | undefined {
        const normalized = name.toLowerCase().replace(/\s+/g, "_");
        for (const config of this.integrations.values()) {
            if (config.name === normalized || config.displayName.toLowerCase() === name.toLowerCase()) {
                return config;
            }
        }
        return undefined;
    }

    list(): IntegrationConfig[] {
        return Array.from(this.integrations.values());
    }

    getCredentials(integration: IntegrationConfig): IntegrationCredentials {
        return JSON.parse(decrypt(integration.credentials));
    }

    /** Build auth headers for an API call */
    buildAuthHeaders(integration: IntegrationConfig): Record<string, string> {
        const creds = this.getCredentials(integration);
        const headers: Record<string, string> = { ...integration.defaultHeaders };

        switch (integration.authType) {
            case "api_key":
                // Common patterns: X-API-Key, api_key query param
                headers["X-API-Key"] = creds.apiKey ?? "";
                break;
            case "bearer":
                headers["Authorization"] = `Bearer ${creds.bearerToken ?? creds.accessToken ?? ""}`;
                break;
            case "basic":
                const encoded = Buffer.from(`${creds.username ?? ""}:${creds.password ?? ""}`).toString("base64");
                headers["Authorization"] = `Basic ${encoded}`;
                break;
            case "oauth2":
                headers["Authorization"] = `Bearer ${creds.accessToken ?? ""}`;
                break;
            case "custom_header":
                if (creds.customHeaders) {
                    Object.assign(headers, creds.customHeaders);
                }
                break;
            case "none":
                break;
        }

        return headers;
    }

    private load(): void {
        try {
            if (existsSync(STORE_FILE)) {
                const data = JSON.parse(readFileSync(STORE_FILE, "utf-8")) as IntegrationConfig[];
                this.integrations = new Map(data.map((c) => [c.id, c]));
                logInfo(`Loaded ${this.integrations.size} integrations`);
            }
        } catch (err) {
            logWarn(`Failed to load integrations: ${err instanceof Error ? err.message : err}`);
        }
    }

    private save(): void {
        try {
            if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
            writeFileSync(STORE_FILE, JSON.stringify(Array.from(this.integrations.values()), null, 2), "utf-8");
        } catch (err) {
            logWarn(`Failed to save integrations: ${err instanceof Error ? err.message : err}`);
        }
    }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _store: IntegrationStore | null = null;

export function getIntegrationStore(): IntegrationStore {
    if (!_store) _store = new IntegrationStore();
    return _store;
}

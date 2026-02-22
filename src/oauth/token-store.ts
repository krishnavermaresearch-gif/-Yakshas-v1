/**
 * Token Store — secure persistence for OAuth tokens.
 *
 * Stores tokens in data/oauth-tokens.json with AES-256-GCM encryption.
 * Auto-handles token expiry checks and multi-provider storage.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { logInfo, logWarn } from "../logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type OAuthTokens = {
    access_token: string;
    refresh_token: string;
    expires_at: number;      // Unix timestamp (ms)
    token_type: string;
    scope: string;
};

type StoredData = Record<string, OAuthTokens>;  // keyed by provider name

// ─── Encryption helpers ──────────────────────────────────────────────────────

const ALGO = "aes-256-gcm";
const SALT = "yakshas-v1-oauth-salt";  // static salt — key derived from machine identity

function getEncryptionKey(): Buffer {
    // Derive key from hostname + user — unique per machine, no env var needed
    const identity = `${process.env.COMPUTERNAME ?? "agent"}-${process.env.USERNAME ?? "user"}`;
    return scryptSync(identity, SALT, 32);
}

function encrypt(plaintext: string): string {
    const key = getEncryptionKey();
    const iv = randomBytes(16);
    const cipher = createCipheriv(ALGO, key, iv);
    let enc = cipher.update(plaintext, "utf8", "hex");
    enc += cipher.final("hex");
    const tag = cipher.getAuthTag().toString("hex");
    return `${iv.toString("hex")}:${tag}:${enc}`;
}

function decrypt(ciphertext: string): string {
    const [ivHex, tagHex, enc] = ciphertext.split(":");
    if (!ivHex || !tagHex || !enc) throw new Error("Invalid token data");
    const key = getEncryptionKey();
    const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    let dec = decipher.update(enc, "hex", "utf8");
    dec += decipher.final("utf8");
    return dec;
}

// ─── Token Store ─────────────────────────────────────────────────────────────

const TOKEN_FILE = "data/oauth-tokens.json";

export class TokenStore {
    private tokens: StoredData = {};

    constructor() {
        this.load();
    }

    private load(): void {
        try {
            if (existsSync(TOKEN_FILE)) {
                const raw = readFileSync(TOKEN_FILE, "utf-8");
                const decrypted = decrypt(raw);
                this.tokens = JSON.parse(decrypted);
                logInfo(`Loaded OAuth tokens for: ${Object.keys(this.tokens).join(", ")}`);
            }
        } catch (err) {
            logWarn(`Could not load OAuth tokens: ${err instanceof Error ? err.message : err}`);
            this.tokens = {};
        }
    }

    private save(): void {
        try {
            mkdirSync("data", { recursive: true });
            const json = JSON.stringify(this.tokens, null, 2);
            const encrypted = encrypt(json);
            writeFileSync(TOKEN_FILE, encrypted, "utf-8");
        } catch (err) {
            logWarn(`Could not save OAuth tokens: ${err instanceof Error ? err.message : err}`);
        }
    }

    /** Store tokens for a provider. */
    set(provider: string, tokens: OAuthTokens): void {
        this.tokens[provider] = tokens;
        this.save();
        logInfo(`Stored OAuth tokens for: ${provider}`);
    }

    /** Get tokens for a provider (or null if not stored). */
    get(provider: string): OAuthTokens | null {
        return this.tokens[provider] ?? null;
    }

    /** Check if tokens exist for a provider. */
    has(provider: string): boolean {
        return provider in this.tokens;
    }

    /** Check if the access token is expired (with 5-minute buffer). */
    isExpired(provider: string): boolean {
        const t = this.tokens[provider];
        if (!t) return true;
        return Date.now() >= t.expires_at - 5 * 60 * 1000; // 5 min buffer
    }

    /** Remove tokens for a provider. */
    remove(provider: string): void {
        delete this.tokens[provider];
        this.save();
        logInfo(`Removed OAuth tokens for: ${provider}`);
    }

    /** List all connected providers. */
    providers(): string[] {
        return Object.keys(this.tokens);
    }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _store: TokenStore | null = null;

export function getTokenStore(): TokenStore {
    if (!_store) _store = new TokenStore();
    return _store;
}

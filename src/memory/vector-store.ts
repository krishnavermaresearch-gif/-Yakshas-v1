/**
 * Local file-based vector store — persistent memory with ZERO external dependencies.
 *
 * Stores embeddings + documents to disk as JSON. Performs cosine similarity
 * search locally. Works out of the box, persists across sessions, lifetime storage.
 *
 * No ChromaDB, no server, no setup — just persistent AI memory.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { logDebug, logInfo, logWarn } from "../logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type MemoryMetadata = {
    type: string;         // "user_message" | "agent_response" | "task_result" | "experience"
    timestamp: number;
    chatId?: number;
    summary?: string;
    [key: string]: unknown;
};

export type SearchResult = {
    id: string;
    text: string;
    metadata: MemoryMetadata;
    distance: number;     // 0 = identical, 1 = completely different (cosine distance)
};

type StoredEntry = {
    id: string;
    text: string;
    embedding: number[];
    metadata: MemoryMetadata;
};

type StoreData = {
    version: number;
    entries: StoredEntry[];
    createdAt: number;
    lastModified: number;
};

// ─── Local Vector Store ─────────────────────────────────────────────────────

export class VectorStore {
    private entries: StoredEntry[] = [];
    private readonly storePath: string;
    private dirty = false;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(collectionName: string = "phone_agent_memory", _chromaUrl?: string) {
        // _chromaUrl kept for API compatibility but ignored — we're fully local
        const dataDir = resolve(process.cwd(), "data", "memory");
        this.storePath = resolve(dataDir, `${collectionName}.json`);
    }

    /**
     * Initialize — load existing data from disk and register exit hook.
     */
    async initialize(): Promise<void> {
        this.load();

        // Register process exit hook to always flush data
        process.on("exit", () => {
            if (this.dirty) this.saveToDisk();
        });
        // Also flush on signals
        const flush = () => { this.forceSave(); process.exit(0); };
        process.once("SIGINT", flush);
        process.once("SIGTERM", flush);

        logInfo(`Memory loaded: "${this.storePath}" (${this.entries.length} entries)`);
    }

    /**
     * Add a memory entry with its embedding.
     */
    async add(id: string, text: string, embedding: number[], metadata: MemoryMetadata): Promise<void> {
        // Check for duplicate IDs — update if exists
        const existingIdx = this.entries.findIndex((e) => e.id === id);
        const entry: StoredEntry = { id, text, embedding, metadata };

        if (existingIdx >= 0) {
            this.entries[existingIdx] = entry;
        } else {
            this.entries.push(entry);
        }

        this.dirty = true;
        this.scheduleSave();
        logDebug(`Memory stored: ${id} (${metadata.type}), total: ${this.entries.length}`);
    }

    /**
     * Search for similar memories using cosine similarity.
     */
    async search(queryEmbedding: number[], topK: number = 5): Promise<SearchResult[]> {
        if (this.entries.length === 0) return [];

        // Compute cosine distance to all entries
        const scored = this.entries
            .map((entry) => ({
                entry,
                distance: cosineDistance(queryEmbedding, entry.embedding),
            }))
            .sort((a, b) => a.distance - b.distance) // Lower distance = more similar
            .slice(0, topK);

        return scored.map((s) => ({
            id: s.entry.id,
            text: s.entry.text,
            metadata: s.entry.metadata,
            distance: s.distance,
        }));
    }

    /**
     * Get recent entries by timestamp (sorted descending).
     */
    async getRecent(n: number = 10): Promise<SearchResult[]> {
        return [...this.entries]
            .sort((a, b) => (b.metadata.timestamp ?? 0) - (a.metadata.timestamp ?? 0))
            .slice(0, n)
            .map((e) => ({
                id: e.id,
                text: e.text,
                metadata: e.metadata,
                distance: 0,
            }));
    }

    /**
     * Get total number of stored memories.
     */
    async count(): Promise<number> {
        return this.entries.length;
    }

    /**
     * Clear all memories.
     */
    async clear(): Promise<void> {
        this.entries = [];
        this.dirty = true;
        this.forceSave();
        logInfo("Memory cleared");
    }

    /**
     * Force save to disk immediately.
     */
    forceSave(): void {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        this.saveToDisk();
    }

    // ── Persistence ──────────────────────────────────────────────────────────

    private load(): void {
        if (!existsSync(this.storePath)) return;

        try {
            const raw = readFileSync(this.storePath, "utf-8");
            const data = JSON.parse(raw) as StoreData;
            this.entries = data.entries ?? [];
            logDebug(`Loaded ${this.entries.length} memories from disk (v${data.version})`);
        } catch (err) {
            logWarn(`Failed to load memory store: ${err instanceof Error ? err.message : err}`);
            // Don't overwrite corrupt file — back it up
            try {
                const backupPath = `${this.storePath}.backup.${Date.now()}`;
                const fs = require("node:fs");
                fs.copyFileSync(this.storePath, backupPath);
                logWarn(`Corrupt store backed up to: ${backupPath}`);
            } catch {
                // Best effort
            }
        }
    }

    private saveToDisk(): void {
        if (!this.dirty) return;

        try {
            const dir = dirname(this.storePath);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

            const data: StoreData = {
                version: 1,
                entries: this.entries,
                createdAt: this.entries.length > 0
                    ? Math.min(...this.entries.map((e) => e.metadata.timestamp ?? Date.now()))
                    : Date.now(),
                lastModified: Date.now(),
            };

            writeFileSync(this.storePath, JSON.stringify(data), "utf-8");
            this.dirty = false;
            logDebug(`Memory saved: ${this.entries.length} entries to ${this.storePath}`);
        } catch (err) {
            logWarn(`Failed to save memory: ${err instanceof Error ? err.message : err}`);
        }
    }

    /**
     * Debounced save — batches rapid writes into one disk write.
     */
    private scheduleSave(): void {
        if (this.saveTimer) return;
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            this.saveToDisk();
        }, 2000); // Save at most every 2 seconds
    }
}

// ─── Math Utilities ──────────────────────────────────────────────────────────

/** Cosine distance: 0 = identical, 1 = orthogonal, 2 = opposite */
function cosineDistance(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 1;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i]! * b[i]!;
        normA += a[i]! * a[i]!;
        normB += b[i]! * b[i]!;
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom === 0) return 1;

    // Cosine similarity → cosine distance
    return 1 - (dotProduct / denom);
}

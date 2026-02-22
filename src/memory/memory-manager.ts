/**
 * Memory Manager — bridges local vector store with Ollama embeddings
 * to provide lifetime persistent conversation memory for Yakshas-v1.
 *
 * Stores user messages, agent responses, and task results.
 * Retrieves relevant past context for each new message via similarity search.
 * All data persists to local JSON files — no external server needed.
 */

import { logDebug, logInfo, logWarn } from "../logger.js";
import { VectorStore, type MemoryMetadata } from "./vector-store.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type MemoryConfig = {
    /** ChromaDB server URL. Default: http://localhost:8000 */
    chromaUrl?: string;
    /** Collection name. Default: phone_agent_memory */
    collectionName?: string;
    /** Number of relevant memories to retrieve per query. Default: 5 */
    retrievalCount?: number;
    /** Number of recent messages to always include. Default: 8 */
    recentWindowSize?: number;
};

export type ConversationTurn = {
    role: "user" | "assistant";
    content: string;
    timestamp: number;
};

// ─── Memory Manager ──────────────────────────────────────────────────────────

export class MemoryManager {
    private store: VectorStore;
    private readonly config: Required<MemoryConfig>;
    private ollamaUrl: string;
    private embeddingModel: string;
    /** Short-term conversation buffer (always included, no embedding needed) */
    private conversationBuffer: ConversationTurn[] = [];
    private initialized = false;

    constructor(config: MemoryConfig = {}) {
        this.config = {
            chromaUrl: config.chromaUrl ?? process.env.CHROMA_URL ?? "http://localhost:8000",
            collectionName: config.collectionName ?? "phone_agent_memory",
            retrievalCount: config.retrievalCount ?? 5,
            recentWindowSize: config.recentWindowSize ?? 8,
        };

        this.ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
        this.embeddingModel = process.env.OLLAMA_EMBEDDING_MODEL ?? "snowflake-arctic-embed:137m";

        this.store = new VectorStore(this.config.collectionName, this.config.chromaUrl);
    }

    /**
     * Initialize local vector store. Called lazily on first use.
     */
    async init(): Promise<boolean> {
        if (this.initialized) return true;

        try {
            await this.store.initialize();
            this.initialized = true;
            return true;
        } catch (err) {
            logWarn(`Memory init failed — running without long-term memory: ${err instanceof Error ? err.message : err}`);
            return false;
        }
    }

    // ── Core Operations ──────────────────────────────────────────────────────

    /**
     * Store a user message in memory.
     */
    async addUserMessage(text: string, chatId?: number): Promise<void> {
        // Add to short-term buffer
        this.conversationBuffer.push({
            role: "user",
            content: text,
            timestamp: Date.now(),
        });
        this.trimBuffer();

        // Store in ChromaDB (best-effort)
        await this.storeMemory(text, "user_message", chatId);
    }

    /**
     * Store an agent response in memory.
     */
    async addAgentResponse(text: string, chatId?: number): Promise<void> {
        // Add to short-term buffer
        this.conversationBuffer.push({
            role: "assistant",
            content: text,
            timestamp: Date.now(),
        });
        this.trimBuffer();

        // Store in ChromaDB
        await this.storeMemory(text, "agent_response", chatId);
    }

    /**
     * Store a task result summary.
     */
    async addTaskResult(task: string, result: string, chatId?: number): Promise<void> {
        const combined = `Task: ${task}\nResult: ${result}`;
        await this.storeMemory(combined, "task_result", chatId, result.slice(0, 200));
    }

    /**
     * Retrieve relevant context for a new message.
     * Returns a formatted string to inject into the system prompt.
     */
    async getContext(query: string): Promise<string> {
        const parts: string[] = [];

        // 1. Recent conversation buffer (always included — short-term memory)
        if (this.conversationBuffer.length > 0) {
            const recentLines = this.conversationBuffer.map((turn) => {
                const role = turn.role === "user" ? "User" : "Agent";
                const ago = formatTimeAgo(turn.timestamp);
                return `[${ago}] ${role}: ${turn.content.slice(0, 300)}`;
            });
            parts.push("## Recent Conversation\n" + recentLines.join("\n"));
        }

        // 2. Relevant past memories from ChromaDB (long-term)
        if (await this.init()) {
            try {
                const embedding = await this.embed(query);
                if (embedding) {
                    const results = await this.store.search(embedding, this.config.retrievalCount);

                    // Filter out entries already in the conversation buffer
                    const bufferTexts = new Set(this.conversationBuffer.map((t) => t.content));
                    const unique = results.filter((r) => !bufferTexts.has(r.text));

                    if (unique.length > 0) {
                        const memoryLines = unique.map((r) => {
                            const ago = formatTimeAgo(r.metadata.timestamp ?? Date.now());
                            const type = (r.metadata.type ?? "memory").replace("_", " ");
                            const sim = ((1 - r.distance) * 100).toFixed(0);
                            const preview = r.metadata.summary || r.text.slice(0, 200);
                            return `[${ago}, ${type}, ${sim}% match] ${preview}`;
                        });
                        parts.push("## Related Past Memories\n" + memoryLines.join("\n"));
                    }
                }
            } catch (err) {
                logDebug(`ChromaDB search failed: ${err instanceof Error ? err.message : err}`);
            }
        }

        return parts.join("\n\n");
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    private async storeMemory(
        text: string,
        type: string,
        chatId?: number,
        summary?: string,
    ): Promise<void> {
        if (!(await this.init())) return;

        try {
            const embedding = await this.embed(text);
            if (!embedding) return;

            const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const metadata: MemoryMetadata = {
                type,
                timestamp: Date.now(),
                chatId,
                summary,
            };

            await this.store.add(id, text, embedding, metadata);
        } catch (err) {
            logDebug(`Failed to store memory: ${err instanceof Error ? err.message : err}`);
        }
    }

    /**
     * Generate an embedding vector using Ollama's embed API.
     */
    private async embed(text: string): Promise<number[] | null> {
        try {
            const resp = await fetch(`${this.ollamaUrl}/api/embed`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: this.embeddingModel,
                    input: text.slice(0, 2000), // Limit input length
                }),
                signal: AbortSignal.timeout(15_000),
            });

            if (!resp.ok) {
                logDebug(`Embed API returned ${resp.status}`);
                return null;
            }

            const data = (await resp.json()) as { embeddings?: number[][] };
            if (data.embeddings && data.embeddings.length > 0) {
                return data.embeddings[0]!;
            }

            return null;
        } catch (err) {
            logDebug(`Embedding failed: ${err instanceof Error ? err.message : err}`);
            return null;
        }
    }

    private trimBuffer(): void {
        if (this.conversationBuffer.length > this.config.recentWindowSize * 2) {
            this.conversationBuffer = this.conversationBuffer.slice(-this.config.recentWindowSize);
        }
    }

    /** Shutdown — flush all pending data to disk. */
    shutdown(): void {
        this.store.forceSave();
        logInfo("Memory manager shutdown — data saved to disk");
    }

    /** Force save all data to disk immediately. */
    save(): void {
        this.store.forceSave();
    }

    /** Clear all memories. */
    async clearAll(): Promise<void> {
        if (await this.init()) {
            await this.store.clear();
        }
        this.conversationBuffer = [];
        logInfo("Memory cleared");
    }

    async memoryCount(): Promise<number> {
        if (!(await this.init())) return 0;
        return this.store.count();
    }

    get bufferSize(): number {
        return this.conversationBuffer.length;
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTimeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _memory: MemoryManager | null = null;

export function getMemoryManager(): MemoryManager {
    if (!_memory) {
        _memory = new MemoryManager();
    }
    return _memory;
}

export function resetMemory(): void {
    _memory?.shutdown();
    _memory = null;
}

/**
 * Persistent Episodic Memory — Long-Term Memory via SQLite
 */

import Database from "better-sqlite3";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { logInfo } from "../logger.js";
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";

const DATA_DIR = join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "memory.db");
let db: Database.Database | null = null;

function getDb(): Database.Database {
    if (db) return db;
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.exec(`
        CREATE TABLE IF NOT EXISTS memories (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now')), category TEXT NOT NULL DEFAULT 'general', content TEXT NOT NULL, importance INTEGER DEFAULT 5, tags TEXT DEFAULT '');
        CREATE TABLE IF NOT EXISTS user_preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now')));
        CREATE TABLE IF NOT EXISTS learned_facts (id INTEGER PRIMARY KEY AUTOINCREMENT, fact TEXT NOT NULL UNIQUE, confidence REAL DEFAULT 0.8, learned_at TEXT DEFAULT (datetime('now')));
        CREATE INDEX IF NOT EXISTS idx_mem_cat ON memories(category);
        CREATE INDEX IF NOT EXISTS idx_mem_time ON memories(created_at);
    `);
    logInfo(`🧠 Memory DB: ${DB_PATH}`);
    return db;
}

export const storeMemoryTool: ToolDefinition = {
    name: "store_memory",
    description: "Save an observation, fact, or context to long-term memory. Categories: 'user_pref', 'task_result', 'observation', 'conversation', 'general'.",
    parameters: { type: "object" as const, properties: { content: { type: "string", description: "Memory to store" }, category: { type: "string", description: "Category", enum: ["user_pref", "task_result", "observation", "conversation", "general"] }, importance: { type: "number", description: "1-10 importance" }, tags: { type: "string", description: "Comma-separated tags" } }, required: ["content"] },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const content = String(args.content ?? "").trim();
        if (!content) return { type: "text", content: "Error: content required." };
        const cat = String(args.category ?? "general"), imp = Math.min(10, Math.max(1, Number(args.importance ?? 5))), tags = String(args.tags ?? "");
        try { const r = getDb().prepare("INSERT INTO memories (content,category,importance,tags) VALUES (?,?,?,?)").run(content, cat, imp, tags); logInfo(`🧠 Stored [${cat}]: "${content.slice(0, 60)}"`); return { type: "text", content: `Memory stored (ID: ${r.lastInsertRowid}).` }; }
        catch (err) { return { type: "text", content: `Store failed: ${err instanceof Error ? err.message : err}` }; }
    },
};

export const recallMemoryTool: ToolDefinition = {
    name: "recall_memory",
    description: "Search long-term memory by keywords. Use BEFORE starting tasks to check for context.",
    parameters: { type: "object" as const, properties: { query: { type: "string", description: "Search keywords" }, category: { type: "string", description: "Filter by category" }, limit: { type: "number", description: "Max results (default: 10)" } }, required: ["query"] },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const query = String(args.query ?? "").trim();
        if (!query) return { type: "text", content: "Error: query required." };
        const cat = args.category ? String(args.category) : null;
        const limit = Math.min(50, Math.max(1, Number(args.limit ?? 10)));
        try {
            const words = query.split(/\s+/).map((w) => `%${w}%`);
            const conds = words.map(() => "(content LIKE ? OR tags LIKE ?)").join(" AND ");
            const params: (string | number)[] = []; words.forEach((w) => { params.push(w, w); });
            let sql = `SELECT id, created_at, category, content, importance, tags FROM memories WHERE ${conds}`;
            if (cat) { sql += " AND category = ?"; params.push(cat); }
            sql += " ORDER BY importance DESC, created_at DESC LIMIT ?"; params.push(limit);
            const rows = getDb().prepare(sql).all(...params) as Array<{ id: number; created_at: string; category: string; content: string; importance: number; tags: string }>;
            if (!rows.length) return { type: "text", content: `No memories for "${query}".` };
            return { type: "text", content: `Found ${rows.length}:\n\n${rows.map((r) => `[${r.id}] (${r.category}, ★${r.importance}, ${r.created_at}) ${r.content}`).join("\n\n")}` };
        } catch (err) { return { type: "text", content: `Recall failed: ${err instanceof Error ? err.message : err}` }; }
    },
};

export const listMemoriesTool: ToolDefinition = {
    name: "list_memories",
    description: "List recent memories from long-term storage.",
    parameters: { type: "object" as const, properties: { limit: { type: "number", description: "Count (default: 20)" } }, required: [] },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const limit = Math.min(100, Math.max(1, Number(args.limit ?? 20)));
        try {
            const rows = getDb().prepare("SELECT id,created_at,category,content,importance FROM memories ORDER BY created_at DESC LIMIT ?").all(limit) as Array<{ id: number; created_at: string; category: string; content: string; importance: number }>;
            if (!rows.length) return { type: "text", content: "No memories yet." };
            return { type: "text", content: rows.map((r) => `[${r.id}] ${r.created_at} [${r.category}] ★${r.importance} ${r.content.slice(0, 120)}`).join("\n") };
        } catch (err) { return { type: "text", content: `List failed: ${err instanceof Error ? err.message : err}` }; }
    },
};

export const setPreferenceTool: ToolDefinition = {
    name: "set_user_preference",
    description: "Store a user preference that persists across sessions (e.g., 'name', 'language', 'theme').",
    parameters: { type: "object" as const, properties: { key: { type: "string", description: "Preference key" }, value: { type: "string", description: "Preference value" } }, required: ["key", "value"] },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const key = String(args.key ?? "").trim(), value = String(args.value ?? "").trim();
        if (!key || !value) return { type: "text", content: "Error: key and value required." };
        try { getDb().prepare("INSERT OR REPLACE INTO user_preferences (key,value,updated_at) VALUES (?,?,datetime('now'))").run(key, value); logInfo(`🧠 Pref: ${key}=${value}`); return { type: "text", content: `Preference saved: ${key} = "${value}"` }; }
        catch (err) { return { type: "text", content: `Set pref failed: ${err instanceof Error ? err.message : err}` }; }
    },
};

export const getPreferencesTool: ToolDefinition = {
    name: "get_user_preferences",
    description: "Retrieve all stored user preferences. Call at conversation start to personalize.",
    parameters: { type: "object" as const, properties: {}, required: [] },
    execute: async (): Promise<ToolResult> => {
        try {
            const rows = getDb().prepare("SELECT key,value,updated_at FROM user_preferences ORDER BY key").all() as Array<{ key: string; value: string; updated_at: string }>;
            if (!rows.length) return { type: "text", content: "No preferences yet." };
            return { type: "text", content: `Preferences:\n${rows.map((r) => `  ${r.key}: ${r.value}`).join("\n")}` };
        } catch (err) { return { type: "text", content: `Get prefs failed: ${err instanceof Error ? err.message : err}` }; }
    },
};

export const learnFactTool: ToolDefinition = {
    name: "learn_fact",
    description: "Store a learned fact permanently. Auto-deduplicated.",
    parameters: { type: "object" as const, properties: { fact: { type: "string", description: "Fact to learn" }, confidence: { type: "number", description: "0.0-1.0 (default: 0.8)" } }, required: ["fact"] },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const fact = String(args.fact ?? "").trim();
        if (!fact) return { type: "text", content: "Error: fact required." };
        const conf = Math.min(1, Math.max(0, Number(args.confidence ?? 0.8)));
        try { getDb().prepare("INSERT OR REPLACE INTO learned_facts (fact,confidence,learned_at) VALUES (?,?,datetime('now'))").run(fact, conf); logInfo(`🧠 Fact: "${fact.slice(0, 60)}"`); return { type: "text", content: `Fact learned (confidence: ${conf}).` }; }
        catch (err) { return { type: "text", content: `Learn failed: ${err instanceof Error ? err.message : err}` }; }
    },
};

export const memoryTools: ToolDefinition[] = [storeMemoryTool, recallMemoryTool, listMemoriesTool, setPreferenceTool, getPreferencesTool, learnFactTool];

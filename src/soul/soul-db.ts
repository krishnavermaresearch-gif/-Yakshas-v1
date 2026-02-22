/**
 * Soul Database — SQLite-backed structured storage for the Digital Soul.
 *
 * Replaces JSON file scanning with fast SQL queries:
 *  - observations: timestamped app usage frames
 *  - messages: communication records with metadata
 *  - transitions: app-to-app transition events
 *  - daily_stats: pre-computed daily summaries
 *
 * "What app at 9 AM?" → SELECT, not LLM inference.
 */

import Database from "better-sqlite3";
import { resolve } from "path";
import { existsSync, mkdirSync } from "fs";
import { logInfo } from "../logger.js";

// ─── Schema ──────────────────────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS observations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   INTEGER NOT NULL,
    app         TEXT NOT NULL,
    activity    TEXT DEFAULT '',
    screen_on   INTEGER NOT NULL DEFAULT 1,
    hour        INTEGER NOT NULL,
    minute      INTEGER NOT NULL,
    day_of_week INTEGER NOT NULL,
    session_id  TEXT
);

CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp       INTEGER NOT NULL,
    contact         TEXT NOT NULL,
    direction       TEXT NOT NULL CHECK (direction IN ('sent', 'received')),
    text            TEXT NOT NULL,
    app             TEXT DEFAULT '',
    response_time_ms INTEGER,
    emoji_count     INTEGER DEFAULT 0,
    word_count      INTEGER DEFAULT 0,
    char_count      INTEGER DEFAULT 0,
    formality       REAL DEFAULT 0.5
);

CREATE TABLE IF NOT EXISTS transitions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   INTEGER NOT NULL,
    from_app    TEXT NOT NULL,
    to_app      TEXT NOT NULL,
    duration_ms INTEGER DEFAULT 0,
    session_id  TEXT
);

CREATE TABLE IF NOT EXISTS daily_stats (
    date            TEXT PRIMARY KEY,
    total_screen_ms INTEGER DEFAULT 0,
    unique_apps     INTEGER DEFAULT 0,
    wake_hour       INTEGER DEFAULT 7,
    sleep_hour      INTEGER DEFAULT 23,
    top_app         TEXT DEFAULT '',
    total_frames    INTEGER DEFAULT 0,
    is_weekend      INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_obs_timestamp ON observations(timestamp);
CREATE INDEX IF NOT EXISTS idx_obs_hour ON observations(hour);
CREATE INDEX IF NOT EXISTS idx_obs_app ON observations(app);
CREATE INDEX IF NOT EXISTS idx_msg_contact ON messages(contact);
CREATE INDEX IF NOT EXISTS idx_msg_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_trans_from ON transitions(from_app);
CREATE INDEX IF NOT EXISTS idx_trans_to ON transitions(to_app);
`;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ObsRow {
    timestamp: number;
    app: string;
    activity: string;
    screen_on: number;
    hour: number;
    minute: number;
    day_of_week: number;
    session_id: string;
}

export interface MsgRow {
    timestamp: number;
    contact: string;
    direction: "sent" | "received";
    text: string;
    app: string;
    response_time_ms: number | null;
    emoji_count: number;
    word_count: number;
    char_count: number;
    formality: number;
}

export interface TransRow {
    timestamp: number;
    from_app: string;
    to_app: string;
    duration_ms: number;
    session_id: string;
}

export interface AppUsageResult {
    app: string;
    count: number;
    total_duration_ms: number;
}

export interface HourlyPattern {
    hour: number;
    top_app: string;
    count: number;
    screen_on_pct: number;
}

export interface ContactStats {
    contact: string;
    sent: number;
    received: number;
    avg_length: number;
    avg_response_ms: number;
    emoji_rate: number;
    avg_formality: number;
}

// ─── Soul Database ───────────────────────────────────────────────────────────

export class SoulDB {
    private db: Database.Database;

    constructor(dbPath?: string) {
        const dir = dbPath
            ? resolve(dbPath, "..")
            : resolve(process.cwd(), "data");
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

        const fullPath = dbPath ?? resolve(dir, "soul.db");
        this.db = new Database(fullPath);
        this.db.pragma("journal_mode = WAL"); // fast concurrent reads
        this.db.pragma("synchronous = NORMAL");
        this.db.exec(SCHEMA);
        logInfo(`📀 Soul DB opened: ${fullPath}`);
    }

    // ── Insert ───────────────────────────────────────────────────────

    insertObservation(obs: ObsRow): void {
        this.db.prepare(`
            INSERT INTO observations (timestamp, app, activity, screen_on, hour, minute, day_of_week, session_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(obs.timestamp, obs.app, obs.activity, obs.screen_on, obs.hour, obs.minute, obs.day_of_week, obs.session_id);
    }

    insertObservationBatch(rows: ObsRow[]): void {
        const stmt = this.db.prepare(`
            INSERT INTO observations (timestamp, app, activity, screen_on, hour, minute, day_of_week, session_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const tx = this.db.transaction((items: ObsRow[]) => {
            for (const o of items) {
                stmt.run(o.timestamp, o.app, o.activity, o.screen_on, o.hour, o.minute, o.day_of_week, o.session_id);
            }
        });
        tx(rows);
    }

    insertMessage(msg: MsgRow): void {
        this.db.prepare(`
            INSERT INTO messages (timestamp, contact, direction, text, app, response_time_ms, emoji_count, word_count, char_count, formality)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(msg.timestamp, msg.contact, msg.direction, msg.text, msg.app,
            msg.response_time_ms, msg.emoji_count, msg.word_count, msg.char_count, msg.formality);
    }

    insertMessageBatch(rows: MsgRow[]): void {
        const stmt = this.db.prepare(`
            INSERT INTO messages (timestamp, contact, direction, text, app, response_time_ms, emoji_count, word_count, char_count, formality)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const tx = this.db.transaction((items: MsgRow[]) => {
            for (const m of items) {
                stmt.run(m.timestamp, m.contact, m.direction, m.text, m.app,
                    m.response_time_ms, m.emoji_count, m.word_count, m.char_count, m.formality);
            }
        });
        tx(rows);
    }

    insertTransition(t: TransRow): void {
        this.db.prepare(`
            INSERT INTO transitions (timestamp, from_app, to_app, duration_ms, session_id)
            VALUES (?, ?, ?, ?, ?)
        `).run(t.timestamp, t.from_app, t.to_app, t.duration_ms, t.session_id);
    }

    upsertDailyStats(date: string, stats: {
        total_screen_ms: number;
        unique_apps: number;
        wake_hour: number;
        sleep_hour: number;
        top_app: string;
        total_frames: number;
        is_weekend: number;
    }): void {
        this.db.prepare(`
            INSERT INTO daily_stats (date, total_screen_ms, unique_apps, wake_hour, sleep_hour, top_app, total_frames, is_weekend)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date) DO UPDATE SET
                total_screen_ms = excluded.total_screen_ms,
                unique_apps = excluded.unique_apps,
                wake_hour = excluded.wake_hour,
                sleep_hour = excluded.sleep_hour,
                top_app = excluded.top_app,
                total_frames = excluded.total_frames,
                is_weekend = excluded.is_weekend
        `).run(date, stats.total_screen_ms, stats.unique_apps, stats.wake_hour,
            stats.sleep_hour, stats.top_app, stats.total_frames, stats.is_weekend);
    }

    // ── Query: App Usage ─────────────────────────────────────────────

    /** Top N apps by observation count (overall or for a specific hour) */
    topApps(limit = 10, hour?: number): AppUsageResult[] {
        if (hour !== undefined) {
            return this.db.prepare(`
                SELECT app, COUNT(*) as count, COALESCE(SUM(t.duration_ms), 0) as total_duration_ms
                FROM observations o
                LEFT JOIN transitions t ON t.from_app = o.app AND t.session_id = o.session_id
                WHERE o.hour = ? AND o.app != 'unknown'
                GROUP BY o.app ORDER BY count DESC LIMIT ?
            `).all(hour, limit) as AppUsageResult[];
        }
        return this.db.prepare(`
            SELECT app, COUNT(*) as count, COALESCE(SUM(t.duration_ms), 0) as total_duration_ms
            FROM observations o
            LEFT JOIN transitions t ON t.from_app = o.app AND t.session_id = o.session_id
            WHERE o.app != 'unknown'
            GROUP BY o.app ORDER BY count DESC LIMIT ?
        `).all(limit) as AppUsageResult[];
    }

    /** Get hourly usage pattern: for each hour, top app + screen-on % */
    hourlyPattern(): HourlyPattern[] {
        return this.db.prepare(`
            SELECT
                hour,
                (SELECT app FROM observations o2 WHERE o2.hour = o.hour AND o2.app != 'unknown'
                 GROUP BY app ORDER BY COUNT(*) DESC LIMIT 1) as top_app,
                COUNT(*) as count,
                ROUND(AVG(screen_on) * 100, 1) as screen_on_pct
            FROM observations o
            GROUP BY hour ORDER BY hour
        `).all() as HourlyPattern[];
    }

    /** Detect wake hour (first hour with >30% screen-on) */
    wakeHour(): number {
        const row = this.db.prepare(`
            SELECT hour FROM observations
            WHERE screen_on = 1 AND hour BETWEEN 4 AND 12
            GROUP BY hour HAVING COUNT(*) * 100.0 / (SELECT COUNT(*) FROM observations WHERE hour = observations.hour) > 30
            ORDER BY hour LIMIT 1
        `).get() as { hour: number } | undefined;
        return row?.hour ?? 7;
    }

    /** Detect sleep hour (last hour with >20% screen-on) */
    sleepHour(): number {
        const row = this.db.prepare(`
            SELECT hour FROM observations
            WHERE screen_on = 1 AND hour BETWEEN 18 AND 23
            GROUP BY hour HAVING COUNT(*) * 100.0 / (SELECT COUNT(*) FROM observations WHERE hour = observations.hour) > 20
            ORDER BY hour DESC LIMIT 1
        `).get() as { hour: number } | undefined;
        return row?.hour ?? 23;
    }

    /** Total screen time in ms */
    totalScreenTimeMs(): number {
        const row = this.db.prepare(`
            SELECT COALESCE(SUM(duration_ms), 0) as total FROM transitions
        `).get() as { total: number };
        return row.total;
    }

    /** Total observation days */
    totalDays(): number {
        const row = this.db.prepare(`
            SELECT COUNT(DISTINCT date(timestamp / 1000, 'unixepoch', 'localtime')) as days FROM observations
        `).get() as { days: number };
        return row.days;
    }

    // ── Query: Communication ─────────────────────────────────────────

    /** Per-contact communication stats */
    contactStats(limit = 20): ContactStats[] {
        return this.db.prepare(`
            SELECT
                contact,
                SUM(CASE WHEN direction = 'sent' THEN 1 ELSE 0 END) as sent,
                SUM(CASE WHEN direction = 'received' THEN 1 ELSE 0 END) as received,
                ROUND(AVG(char_count), 0) as avg_length,
                ROUND(AVG(CASE WHEN response_time_ms IS NOT NULL THEN response_time_ms END), 0) as avg_response_ms,
                ROUND(AVG(CASE WHEN emoji_count > 0 THEN 1.0 ELSE 0.0 END), 2) as emoji_rate,
                ROUND(AVG(formality), 2) as avg_formality
            FROM messages
            GROUP BY contact
            ORDER BY (sent + received) DESC
            LIMIT ?
        `).all(limit) as ContactStats[];
    }

    /** Get message count */
    messageCount(): number {
        const row = this.db.prepare(`SELECT COUNT(*) as count FROM messages`).get() as { count: number };
        return row.count;
    }

    /** Top emojis across all messages */
    topEmojis(limit = 10): string[] {
        // Emojis are stored in the text — we extract them in JS since SQLite lacks regex
        const rows = this.db.prepare(`
            SELECT text FROM messages WHERE emoji_count > 0 ORDER BY timestamp DESC LIMIT 500
        `).all() as { text: string }[];

        const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
        const counts = new Map<string, number>();
        for (const { text } of rows) {
            for (const e of text.match(emojiRegex) ?? []) {
                counts.set(e, (counts.get(e) ?? 0) + 1);
            }
        }
        return Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([e]) => e);
    }

    // ── Query: Transitions / Patterns ────────────────────────────────

    /** Top N app transitions (from→to) */
    topTransitions(limit = 10): Array<{ from_app: string; to_app: string; count: number }> {
        return this.db.prepare(`
            SELECT from_app, to_app, COUNT(*) as count
            FROM transitions
            GROUP BY from_app, to_app
            ORDER BY count DESC LIMIT ?
        `).all(limit) as Array<{ from_app: string; to_app: string; count: number }>;
    }

    /** Predictability: Jaccard similarity of app sets across days */
    predictability(): number {
        const days = this.db.prepare(`
            SELECT DISTINCT date(timestamp / 1000, 'unixepoch', 'localtime') as day
            FROM observations LIMIT 30
        `).all() as { day: string }[];

        if (days.length < 2) return 0;

        const daySets: Set<string>[] = days.map(d => {
            const apps = this.db.prepare(`
                SELECT DISTINCT app FROM observations
                WHERE date(timestamp / 1000, 'unixepoch', 'localtime') = ? AND app != 'unknown'
            `).all(d.day) as { app: string }[];
            return new Set(apps.map(a => a.app));
        });

        let totalJaccard = 0;
        let pairs = 0;
        for (let i = 0; i < daySets.length; i++) {
            for (let j = i + 1; j < daySets.length; j++) {
                const a = daySets[i]!;
                const b = daySets[j]!;
                const intersection = new Set([...a].filter(x => b.has(x)));
                const union = new Set([...a, ...b]);
                totalJaccard += union.size > 0 ? intersection.size / union.size : 0;
                pairs++;
            }
        }
        return pairs > 0 ? Math.round((totalJaccard / pairs) * 100) / 100 : 0;
    }

    // ── Utility ──────────────────────────────────────────────────────

    /** Total observations count */
    observationCount(): number {
        const row = this.db.prepare(`SELECT COUNT(*) as count FROM observations`).get() as { count: number };
        return row.count;
    }

    /** Get raw database for advanced queries */
    raw(): Database.Database {
        return this.db;
    }

    /** Close database */
    close(): void {
        this.db.close();
    }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _soulDb: SoulDB | null = null;

export function getSoulDB(): SoulDB {
    if (!_soulDb) _soulDb = new SoulDB();
    return _soulDb;
}

export function resetSoulDB(): void {
    _soulDb?.close();
    _soulDb = null;
}

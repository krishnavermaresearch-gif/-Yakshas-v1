/**
 * Event Monitor — reactive event system for Yakshas-v1.
 *
 * Polls ADB logcat / dumpsys to detect phone events (notifications, battery,
 * app changes, connectivity) AND Google API events (new emails, upcoming
 * calendar events, drive changes, task deadlines).
 *
 * Users define rules that map events to actions (natural language tasks),
 * which are dispatched to the orchestrator.
 *
 * This is the "always on" backbone of proactive agent behavior.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { getAdb } from "../adb/connection.js";
import { logDebug, logError, logInfo, logWarn } from "../logger.js";
import { simpleGet } from "../google/api-client.js";
import { getGoogleAuth } from "../oauth/google-auth.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type PhoneEventType =
    | "notification"
    | "battery"
    | "app_change"
    | "connectivity"
    | "screen_change"
    // Google API event types
    | "gmail_new"
    | "calendar_upcoming"
    | "drive_change"
    | "tasks_due";

export type PhoneEvent = {
    type: PhoneEventType;
    source: string;               // e.g. "com.whatsapp", "battery", "wifi"
    data: Record<string, unknown>;
    timestamp: number;
};

export type EventRule = {
    id: string;
    name: string;
    eventType: PhoneEventType;
    /** Filters: each key is matched against event.data[key] (substring match). */
    filter: Record<string, string>;
    /** Natural language task for the orchestrator to execute. */
    action: string;
    enabled: boolean;
    cooldownMs: number;           // min ms between firings (default: 60_000)
    lastFiredAt?: number;
    createdAt: number;
};

export type EventCallback = (event: PhoneEvent, rule: EventRule) => Promise<void>;

// ─── Config ──────────────────────────────────────────────────────────────────

const DATA_DIR = resolve(process.cwd(), "data");
const RULES_FILE = resolve(DATA_DIR, "event-rules.json");
const DEFAULT_POLL_MS = 15_000;      // 15 seconds
const DEFAULT_COOLDOWN_MS = 60_000;  // 1 minute

// ─── Event Monitor ───────────────────────────────────────────────────────────

export class EventMonitor {
    private rules: Map<string, EventRule> = new Map();
    private timer: ReturnType<typeof setInterval> | null = null;
    private callback: EventCallback | null = null;
    private pollIntervalMs: number;

    // ── Cached state for change detection ──
    private lastBatteryLevel = -1;
    private lastBatteryCharging = false;
    private lastForegroundApp = "";
    private lastWifiConnected: boolean | null = null;
    private lastNotificationKeys = new Set<string>();

    // ── Google API state ──
    private lastSeenEmailIds = new Set<string>();
    private lastSeenDriveIds = new Set<string>();
    private googlePollCount = 0;
    private static GOOGLE_POLL_EVERY_N = 4; // poll Google every 4th tick (~60s at 15s interval)

    constructor(pollIntervalMs?: number) {
        this.pollIntervalMs =
            pollIntervalMs ??
            (Number(process.env.EVENT_POLL_INTERVAL_MS) || DEFAULT_POLL_MS);
        this.load();
    }

    /** Set callback for when a rule fires. */
    setCallback(cb: EventCallback): void {
        this.callback = cb;
    }

    // ── Rule CRUD ────────────────────────────────────────────────────────────

    addRule(options: {
        name: string;
        eventType: PhoneEventType;
        filter: Record<string, string>;
        action: string;
        cooldownMs?: number;
    }): EventRule {
        const id = `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const rule: EventRule = {
            id,
            name: options.name,
            eventType: options.eventType,
            filter: options.filter,
            action: options.action,
            enabled: true,
            cooldownMs: options.cooldownMs ?? DEFAULT_COOLDOWN_MS,
            createdAt: Date.now(),
        };
        this.rules.set(id, rule);
        this.save();
        logInfo(`Event rule added: "${rule.name}" (${rule.eventType}) → "${rule.action}"`);
        return rule;
    }

    removeRule(id: string): boolean {
        const removed = this.rules.delete(id);
        if (removed) this.save();
        return removed;
    }

    listRules(): EventRule[] {
        return Array.from(this.rules.values());
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    start(): void {
        if (this.timer) return;
        logInfo(`Event monitor started (polling every ${this.pollIntervalMs}ms)`);
        this.timer = setInterval(() => {
            this.tick().catch((err) =>
                logError(`Event monitor tick failed: ${err instanceof Error ? err.message : err}`),
            );
        }, this.pollIntervalMs);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            logInfo("Event monitor stopped");
        }
    }

    // ── Polling Tick ─────────────────────────────────────────────────────────

    async tick(): Promise<void> {
        const events: PhoneEvent[] = [];
        const adb = getAdb();

        // Parallel polling — all independent (ADB)
        const [notifEvents, batteryEvents, appEvents, connectEvents] = await Promise.allSettled([
            this.pollNotifications(adb),
            this.pollBattery(adb),
            this.pollCurrentApp(adb),
            this.pollConnectivity(adb),
        ]);

        // Collect successful ADB events
        for (const result of [notifEvents, batteryEvents, appEvents, connectEvents]) {
            if (result.status === "fulfilled" && result.value) {
                events.push(...result.value);
            }
        }

        // Google API polling — runs every Nth tick (~60s) to avoid rate limits
        this.googlePollCount++;
        if (this.googlePollCount >= EventMonitor.GOOGLE_POLL_EVERY_N && this.isGoogleConnected()) {
            this.googlePollCount = 0;
            const googleResults = await Promise.allSettled([
                this.pollGmail(),
                this.pollCalendarUpcoming(),
                this.pollDriveChanges(),
                this.pollTasksDue(),
            ]);
            for (const result of googleResults) {
                if (result.status === "fulfilled" && result.value) {
                    events.push(...result.value);
                }
            }
        }

        // Match rules for each event
        for (const event of events) {
            await this.matchAndFire(event);
        }
    }

    private isGoogleConnected(): boolean {
        try { return getGoogleAuth().isConnected(); } catch { return false; }
    }

    // ── Pollers ──────────────────────────────────────────────────────────────

    private async pollNotifications(adb: ReturnType<typeof getAdb>): Promise<PhoneEvent[]> {
        const events: PhoneEvent[] = [];
        try {
            const result = await adb.shell(
                "dumpsys notification --noredact 2>/dev/null | grep -E 'pkg=|android.title=|android.text=' | head -60",
                { timeoutMs: 10_000 },
            );

            const lines = result.stdout.split("\n");
            const currentKeys = new Set<string>();
            let pkg = "";
            let title = "";
            let text = "";

            for (const line of lines) {
                const trimmed = line.trim();
                const pkgMatch = trimmed.match(/pkg=([^\s|]+)/);
                if (pkgMatch) {
                    // Flush previous notification
                    if (pkg && title) {
                        const key = `${pkg}:${title}`;
                        currentKeys.add(key);
                        if (!this.lastNotificationKeys.has(key)) {
                            events.push({
                                type: "notification",
                                source: pkg,
                                data: { package: pkg, title, text },
                                timestamp: Date.now(),
                            });
                        }
                    }
                    pkg = pkgMatch[1]!;
                    title = "";
                    text = "";
                    continue;
                }
                const titleMatch = trimmed.match(/android\.title=(.+)/);
                if (titleMatch) { title = titleMatch[1]!.trim(); continue; }
                const textMatch = trimmed.match(/android\.text=(.+)/);
                if (textMatch) { text = textMatch[1]!.trim(); }
            }

            // Flush last notification
            if (pkg && title) {
                const key = `${pkg}:${title}`;
                currentKeys.add(key);
                if (!this.lastNotificationKeys.has(key)) {
                    events.push({
                        type: "notification",
                        source: pkg,
                        data: { package: pkg, title, text },
                        timestamp: Date.now(),
                    });
                }
            }

            this.lastNotificationKeys = currentKeys;
        } catch (err) {
            logDebug(`Notification poll failed: ${err instanceof Error ? err.message : err}`);
        }
        return events;
    }

    private async pollBattery(adb: ReturnType<typeof getAdb>): Promise<PhoneEvent[]> {
        const events: PhoneEvent[] = [];
        try {
            const result = await adb.shell("dumpsys battery", { timeoutMs: 5_000 });
            const levelMatch = result.stdout.match(/level:\s*(\d+)/);
            const statusMatch = result.stdout.match(/status:\s*(\d+)/);

            const level = levelMatch ? Number(levelMatch[1]) : -1;
            const charging = statusMatch ? [2, 5].includes(Number(statusMatch[1])) : false;

            if (level !== this.lastBatteryLevel || charging !== this.lastBatteryCharging) {
                // Only emit if this isn't the first poll (initialization)
                if (this.lastBatteryLevel !== -1) {
                    events.push({
                        type: "battery",
                        source: "battery",
                        data: {
                            level,
                            charging,
                            previousLevel: this.lastBatteryLevel,
                            previousCharging: this.lastBatteryCharging,
                            direction: level > this.lastBatteryLevel ? "rising" : "falling",
                        },
                        timestamp: Date.now(),
                    });
                }
                this.lastBatteryLevel = level;
                this.lastBatteryCharging = charging;
            }
        } catch (err) {
            logDebug(`Battery poll failed: ${err instanceof Error ? err.message : err}`);
        }
        return events;
    }

    private async pollCurrentApp(adb: ReturnType<typeof getAdb>): Promise<PhoneEvent[]> {
        const events: PhoneEvent[] = [];
        try {
            const result = await adb.shell(
                "dumpsys activity activities 2>/dev/null | grep -E 'mResumedActivity|topResumedActivity' | head -1",
                { timeoutMs: 5_000 },
            );
            const match = result.stdout.match(/(?:u0|{)\s*([a-zA-Z0-9_.]+\/[a-zA-Z0-9_.]+)/);
            const currentApp = match?.[1] ?? "";

            if (currentApp && currentApp !== this.lastForegroundApp) {
                if (this.lastForegroundApp) {
                    events.push({
                        type: "app_change",
                        source: currentApp.split("/")[0] ?? currentApp,
                        data: {
                            currentApp,
                            previousApp: this.lastForegroundApp,
                            package: currentApp.split("/")[0] ?? "",
                        },
                        timestamp: Date.now(),
                    });
                }
                this.lastForegroundApp = currentApp;
            }
        } catch (err) {
            logDebug(`App poll failed: ${err instanceof Error ? err.message : err}`);
        }
        return events;
    }

    private async pollConnectivity(adb: ReturnType<typeof getAdb>): Promise<PhoneEvent[]> {
        const events: PhoneEvent[] = [];
        try {
            const result = await adb.shell(
                "ip addr show wlan0 2>/dev/null | grep 'inet '",
                { timeoutMs: 5_000 },
            );
            const match = result.stdout.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
            const connected = !!match;
            const ip = match?.[1] ?? "0.0.0.0";

            if (this.lastWifiConnected !== null && connected !== this.lastWifiConnected) {
                events.push({
                    type: "connectivity",
                    source: "wifi",
                    data: {
                        wifiConnected: connected,
                        previousState: this.lastWifiConnected,
                        ip,
                    },
                    timestamp: Date.now(),
                });
            }
            this.lastWifiConnected = connected;
        } catch (err) {
            logDebug(`Connectivity poll failed: ${err instanceof Error ? err.message : err}`);
        }
        return events;
    }

    // ── Screen Watcher (opt-in) ──────────────────────────────────────────────

    private screenWatchTimer: ReturnType<typeof setInterval> | null = null;
    private lastUiTreeHash = "";

    startScreenWatch(intervalMs: number = 30_000): void {
        if (this.screenWatchTimer) return;
        logInfo(`Screen watcher started (interval: ${intervalMs}ms)`);
        this.screenWatchTimer = setInterval(() => {
            this.pollScreen().catch((err) =>
                logDebug(`Screen watch poll failed: ${err instanceof Error ? err.message : err}`),
            );
        }, intervalMs);
    }

    stopScreenWatch(): void {
        if (this.screenWatchTimer) {
            clearInterval(this.screenWatchTimer);
            this.screenWatchTimer = null;
            logInfo("Screen watcher stopped");
        }
    }

    get isScreenWatchActive(): boolean {
        return this.screenWatchTimer !== null;
    }

    private async pollScreen(): Promise<void> {
        try {
            const adb = getAdb();
            const result = await adb.shell(
                "uiautomator dump /dev/tty 2>/dev/null | head -200",
                { timeoutMs: 10_000 },
            );
            const output = result.stdout.trim();
            if (!output) return;

            // Simple hash of the UI tree for change detection
            const hash = quickHash(output);
            if (hash === this.lastUiTreeHash) return;

            // Detect what changed
            const oldHash = this.lastUiTreeHash;
            this.lastUiTreeHash = hash;

            if (!oldHash) return; // first poll, skip

            const event: PhoneEvent = {
                type: "screen_change",
                source: "screen",
                data: {
                    treeLength: output.length,
                    // Extract visible package from the dump
                    visiblePackage: output.match(/package="([^"]+)"/)?.[1] ?? "unknown",
                },
                timestamp: Date.now(),
            };

            await this.matchAndFire(event);
        } catch {
            // Silently ignore — screen watching is best-effort
        }
    }

    // ── Google API Pollers ───────────────────────────────────────────────────

    private async pollGmail(): Promise<PhoneEvent[]> {
        const events: PhoneEvent[] = [];
        try {
            const data = await simpleGet("https://gmail.googleapis.com/gmail/v1/users/me/messages", {
                maxResults: "5", q: "is:unread in:inbox", labelIds: "INBOX",
            });
            if (data.messages?.length) {
                for (const msg of data.messages) {
                    if (!this.lastSeenEmailIds.has(msg.id)) {
                        // Fetch summary
                        const full = await simpleGet(
                            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`,
                            { format: "metadata", metadataHeaders: "Subject,From" }
                        );
                        const headers = full.payload?.headers ?? [];
                        const subject = headers.find((h: any) => h.name === "Subject")?.value ?? "";
                        const from = headers.find((h: any) => h.name === "From")?.value ?? "";
                        events.push({
                            type: "gmail_new",
                            source: "gmail",
                            data: { messageId: msg.id, subject, from, snippet: full.snippet ?? "" },
                            timestamp: Date.now(),
                        });
                        logInfo(`Google trigger: New email from ${from} — "${subject}"`);
                    }
                }
                // Update seen set (keep last 50)
                this.lastSeenEmailIds = new Set(data.messages.map((m: any) => m.id));
            }

        } catch (err) {
            logDebug(`Gmail poll failed: ${err instanceof Error ? err.message : err}`);
        }
        return events;
    }

    private async pollCalendarUpcoming(): Promise<PhoneEvent[]> {
        const events: PhoneEvent[] = [];
        try {
            const now = new Date();
            const soon = new Date(now.getTime() + 15 * 60 * 1000); // 15 min window
            const data = await simpleGet("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
                timeMin: now.toISOString(),
                timeMax: soon.toISOString(),
                singleEvents: "true",
                orderBy: "startTime",
                maxResults: "5",
            });
            if (data.items?.length) {
                for (const item of data.items) {
                    const start = item.start?.dateTime ?? item.start?.date ?? "";
                    const eventKey = `${item.id}_${start}`;
                    // Only fire once per event per time window
                    if (!this.lastSeenDriveIds.has(eventKey)) {
                        events.push({
                            type: "calendar_upcoming",
                            source: "calendar",
                            data: {
                                eventId: item.id,
                                title: item.summary ?? "Untitled",
                                start,
                                location: item.location ?? "",
                                description: item.description?.slice(0, 200) ?? "",
                            },
                            timestamp: Date.now(),
                        });
                        logInfo(`Google trigger: Upcoming event "${item.summary}" at ${start}`);
                        this.lastSeenDriveIds.add(eventKey);
                    }
                }
            }

        } catch (err) {
            logDebug(`Calendar poll failed: ${err instanceof Error ? err.message : err}`);
        }
        return events;
    }

    private async pollDriveChanges(): Promise<PhoneEvent[]> {
        const events: PhoneEvent[] = [];
        try {
            // Check recently modified files (last 2 minutes)
            const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
            const data = await simpleGet("https://www.googleapis.com/drive/v3/files", {
                q: `modifiedTime > '${since}' and trashed = false`,
                orderBy: "modifiedTime desc",
                pageSize: "5",
                fields: "files(id,name,mimeType,modifiedTime,lastModifyingUser)",
            });
            if (data.files?.length) {
                for (const file of data.files) {
                    const key = `${file.id}_${file.modifiedTime}`;
                    if (!this.lastSeenDriveIds.has(key)) {
                        events.push({
                            type: "drive_change",
                            source: "drive",
                            data: {
                                fileId: file.id,
                                name: file.name,
                                mimeType: file.mimeType,
                                modifiedBy: file.lastModifyingUser?.displayName ?? "unknown",
                            },
                            timestamp: Date.now(),
                        });
                        logInfo(`Google trigger: Drive file changed — "${file.name}"`);
                        this.lastSeenDriveIds.add(key);
                    }
                }
                // Prune old entries (keep last 100)
                if (this.lastSeenDriveIds.size > 100) {
                    const arr = [...this.lastSeenDriveIds];
                    this.lastSeenDriveIds = new Set(arr.slice(-100));
                }
            }

        } catch (err) {
            logDebug(`Drive poll failed: ${err instanceof Error ? err.message : err}`);
        }
        return events;
    }

    private async pollTasksDue(): Promise<PhoneEvent[]> {
        const events: PhoneEvent[] = [];
        try {
            const lists = await simpleGet("https://tasks.googleapis.com/tasks/v1/users/@me/lists");
            const listId = lists.items?.[0]?.id;
            if (!listId) return events;

            const now = new Date();
            const data = await simpleGet(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`, {
                maxResults: "10", showCompleted: "false",
            });
            if (data.items?.length) {
                for (const task of data.items) {
                    if (task.due) {
                        const dueDate = new Date(task.due);
                        const hoursUntilDue = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60);
                        // Fire if due within 1 hour
                        if (hoursUntilDue > 0 && hoursUntilDue <= 1) {
                            events.push({
                                type: "tasks_due",
                                source: "tasks",
                                data: {
                                    taskId: task.id,
                                    title: task.title,
                                    due: task.due,
                                    notes: task.notes ?? "",
                                },
                                timestamp: Date.now(),
                            });
                            logInfo(`Google trigger: Task due soon — "${task.title}"`);
                        }
                    }
                }
            }

        } catch (err) {
            logDebug(`Tasks poll failed: ${err instanceof Error ? err.message : err}`);
        }
        return events;
    }

    // ── Rule Matching ────────────────────────────────────────────────────────

    private async matchAndFire(event: PhoneEvent): Promise<void> {
        const now = Date.now();

        for (const rule of this.rules.values()) {
            if (!rule.enabled) continue;
            if (rule.eventType !== event.type) continue;

            // Check cooldown
            if (rule.lastFiredAt && (now - rule.lastFiredAt) < rule.cooldownMs) continue;

            // Check filters — all filter keys must match (substring)
            const matches = Object.entries(rule.filter).every(([key, value]) => {
                const eventValue = String(event.data[key] ?? event.source ?? "");
                return eventValue.toLowerCase().includes(value.toLowerCase());
            });

            if (!matches) continue;

            // Fire!
            logInfo(`Event rule fired: "${rule.name}" on ${event.type} from ${event.source}`);
            rule.lastFiredAt = now;
            this.save();

            if (this.callback) {
                try {
                    await this.callback(event, rule);
                } catch (err) {
                    logError(`Event rule callback failed: ${err instanceof Error ? err.message : err}`);
                }
            }
        }
    }

    // ── Persistence ──────────────────────────────────────────────────────────

    private load(): void {
        try {
            if (existsSync(RULES_FILE)) {
                const data = JSON.parse(readFileSync(RULES_FILE, "utf-8")) as EventRule[];
                this.rules = new Map(data.map((r) => [r.id, r]));
                logInfo(`Loaded ${this.rules.size} event rules`);
            }
        } catch (err) {
            logWarn(`Failed to load event rules: ${err instanceof Error ? err.message : err}`);
        }
    }

    private save(): void {
        try {
            if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
            const data = Array.from(this.rules.values());
            writeFileSync(RULES_FILE, JSON.stringify(data, null, 2), "utf-8");
        } catch (err) {
            logWarn(`Failed to save event rules: ${err instanceof Error ? err.message : err}`);
        }
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function quickHash(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        const ch = input.charCodeAt(i);
        hash = ((hash << 5) - hash) + ch;
        hash |= 0; // Convert to 32-bit int
    }
    return hash.toString(36);
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _monitor: EventMonitor | null = null;

export function getEventMonitor(): EventMonitor {
    if (!_monitor) _monitor = new EventMonitor();
    return _monitor;
}

export function resetEventMonitor(): void {
    _monitor?.stop();
    _monitor?.stopScreenWatch();
    _monitor = null;
}

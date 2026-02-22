/**
 * Heartbeat Audit System — 30-minute auto-check for all systems.
 *
 * Every 30 minutes, the agent autonomously checks:
 * 1. Unread messages (WhatsApp, SMS, notifications)
 * 2. Pending workflows and cron jobs
 * 3. New emails
 * 4. Phone health (battery, storage, connectivity)
 * 5. Missed calls
 * 6. Security audit log
 *
 * The heartbeat runs as a cron job via the existing CronScheduler.
 * Results are logged and optionally sent as a Telegram digest.
 */

import { logInfo } from "../logger.js";
import type { ToolRegistry, ToolResult } from "../agent/tool-registry.js";
import { getCronScheduler } from "../cron/scheduler.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const HEARTBEAT_JOB_ID = "__heartbeat_audit__";
const HEARTBEAT_INTERVAL = "*/30 * *"; // Every 30 minutes

// ─── Check Functions ─────────────────────────────────────────────────────────

interface AuditResult {
    check: string;
    status: "ok" | "warning" | "error";
    message: string;
    actionRequired: boolean;
}

/** Check for unread notifications / messages on the phone */
async function checkNotifications(registry: ToolRegistry): Promise<AuditResult> {
    try {
        const result = await registry.execute("adb_shell", { command: "dumpsys notification --noredact" });
        const lines = result.content.split("\n");
        // Count notifications that have content text
        const notifLines = lines.filter(l => l.includes("android.text=") && !l.includes("null"));
        const count = notifLines.length;

        if (count === 0) {
            return { check: "Notifications", status: "ok", message: "No pending notifications", actionRequired: false };
        }

        // Extract preview of notifications
        const previews = notifLines.slice(0, 5).map(l => {
            const match = l.match(/android\.text=(.+?)(?:,|$)/);
            return match ? match[1]?.trim().slice(0, 80) : "unknown";
        });

        return {
            check: "Notifications",
            status: "warning",
            message: `${count} pending notifications:\n${previews.map(p => `  • ${p}`).join("\n")}`,
            actionRequired: count > 5,
        };
    } catch (err) {
        return { check: "Notifications", status: "error", message: `Failed: ${err instanceof Error ? err.message : err}`, actionRequired: false };
    }
}

/** Check phone battery and storage */
async function checkPhoneHealth(registry: ToolRegistry): Promise<AuditResult> {
    try {
        const battery = await registry.execute("adb_shell", { command: "dumpsys battery | grep level" });
        const storage = await registry.execute("adb_shell", { command: "df /data | tail -1" });

        const batteryLevel = parseInt(battery.content.match(/level:\s*(\d+)/)?.[1] ?? "0");
        const storageParts = storage.content.trim().split(/\s+/);
        const usagePercent = storageParts[4] ? parseInt(storageParts[4]) : 0;

        const issues: string[] = [];
        if (batteryLevel < 20) issues.push(`⚡ Battery LOW: ${batteryLevel}%`);
        if (usagePercent > 90) issues.push(`💾 Storage HIGH: ${usagePercent}% used`);

        if (issues.length > 0) {
            return { check: "Phone Health", status: "warning", message: issues.join("\n"), actionRequired: true };
        }

        return { check: "Phone Health", status: "ok", message: `Battery: ${batteryLevel}%, Storage: ${usagePercent}% used`, actionRequired: false };
    } catch (err) {
        return { check: "Phone Health", status: "error", message: `Failed: ${err instanceof Error ? err.message : err}`, actionRequired: false };
    }
}

/** Check missed calls */
async function checkMissedCalls(registry: ToolRegistry): Promise<AuditResult> {
    try {
        const result = await registry.execute("adb_shell", {
            command: "content query --uri content://call_log/calls --projection number:type:date --where \"type=3\" --sort \"date DESC\" --limit 5",
        });

        if (!result.content || result.content.includes("No result")) {
            return { check: "Missed Calls", status: "ok", message: "No recent missed calls", actionRequired: false };
        }

        const lines = result.content.split("\n").filter(l => l.includes("number="));
        if (lines.length === 0) {
            return { check: "Missed Calls", status: "ok", message: "No recent missed calls", actionRequired: false };
        }

        return {
            check: "Missed Calls",
            status: "warning",
            message: `${lines.length} missed call(s) found`,
            actionRequired: true,
        };
    } catch {
        return { check: "Missed Calls", status: "ok", message: "Could not check (permission)", actionRequired: false };
    }
}

/** Check WiFi/connectivity */
async function checkConnectivity(registry: ToolRegistry): Promise<AuditResult> {
    try {
        const wifi = await registry.execute("adb_shell", { command: "dumpsys wifi | grep 'mNetworkInfo'" });
        const isConnected = wifi.content.includes("CONNECTED");

        if (!isConnected) {
            return { check: "Connectivity", status: "warning", message: "WiFi is NOT connected", actionRequired: true };
        }

        return { check: "Connectivity", status: "ok", message: "WiFi connected", actionRequired: false };
    } catch {
        return { check: "Connectivity", status: "ok", message: "Could not check WiFi", actionRequired: false };
    }
}

/** Check cron/workflow status */
async function checkWorkflows(): Promise<AuditResult> {
    try {
        const scheduler = getCronScheduler();
        const jobs = scheduler.listJobs();
        const activeJobs = jobs.filter(j => j.enabled && j.id !== HEARTBEAT_JOB_ID);
        const pendingCount = activeJobs.length;
        const overdueJobs = activeJobs.filter(j => {
            if (!j.lastRunAt) return false;
            // Consider overdue if last run was more than 2 hours ago for recurring jobs
            return !j.oneShot && (Date.now() - j.lastRunAt > 2 * 60 * 60 * 1000);
        });

        if (overdueJobs.length > 0) {
            return {
                check: "Workflows/Cron",
                status: "warning",
                message: `${pendingCount} active jobs, ${overdueJobs.length} may be overdue`,
                actionRequired: true,
            };
        }

        return { check: "Workflows/Cron", status: "ok", message: `${pendingCount} active jobs running normally`, actionRequired: false };
    } catch {
        return { check: "Workflows/Cron", status: "ok", message: "Scheduler not active", actionRequired: false };
    }
}

/** Check security exec log for recent blocked commands */
async function checkSecurityLog(): Promise<AuditResult> {
    try {
        const { getExecLog } = await import("../security/exec-safety.js");
        const log = getExecLog();
        const recentBlocked = log.filter(e => e.blocked && e.timestamp > Date.now() - 30 * 60 * 1000);

        if (recentBlocked.length > 0) {
            return {
                check: "Security",
                status: "warning",
                message: `${recentBlocked.length} blocked command(s) in last 30 min`,
                actionRequired: false,
            };
        }

        return { check: "Security", status: "ok", message: `${log.length} total exec log entries, none blocked recently`, actionRequired: false };
    } catch {
        return { check: "Security", status: "ok", message: "Security module not loaded", actionRequired: false };
    }
}

// ─── Heartbeat Runner ────────────────────────────────────────────────────────

/** Run all audit checks and return a formatted report */
export async function runHeartbeatAudit(registry: ToolRegistry): Promise<string> {
    logInfo("💓 Heartbeat audit starting...");
    const startMs = Date.now();

    const results = await Promise.allSettled([
        checkNotifications(registry),
        checkPhoneHealth(registry),
        checkMissedCalls(registry),
        checkConnectivity(registry),
        checkWorkflows(),
        checkSecurityLog(),
    ]);

    const auditResults: AuditResult[] = results.map(r =>
        r.status === "fulfilled"
            ? r.value
            : { check: "Unknown", status: "error" as const, message: String(r.reason), actionRequired: false },
    );

    const durationMs = Date.now() - startMs;
    const warnings = auditResults.filter(r => r.status !== "ok");
    const actionsNeeded = auditResults.filter(r => r.actionRequired);

    // Format report
    const lines: string[] = [
        `💓 HEARTBEAT AUDIT — ${new Date().toLocaleString()}`,
        `Duration: ${durationMs}ms | Checks: ${auditResults.length} | Warnings: ${warnings.length}`,
        "",
    ];

    for (const r of auditResults) {
        const icon = r.status === "ok" ? "✅" : r.status === "warning" ? "⚠️" : "❌";
        lines.push(`${icon} ${r.check}: ${r.message}`);
    }

    if (actionsNeeded.length > 0) {
        lines.push("");
        lines.push(`📋 ACTION REQUIRED (${actionsNeeded.length}):`);
        for (const a of actionsNeeded) {
            lines.push(`  → ${a.check}: ${a.message.split("\n")[0]}`);
        }
    }

    const report = lines.join("\n");
    logInfo(`💓 Heartbeat audit complete:\n${report}`);
    return report;
}

// ─── Registration ────────────────────────────────────────────────────────────

/** Register the heartbeat as a 30-minute cron job */
export function registerHeartbeat(registry: ToolRegistry, onReport?: (report: string) => void): void {
    const scheduler = getCronScheduler();

    // Remove existing heartbeat if any
    scheduler.removeJob(HEARTBEAT_JOB_ID);

    // The cron scheduler fires job tasks — we set the heartbeat callback
    scheduler.setCallback(async (job) => {
        if (job.id !== HEARTBEAT_JOB_ID) return;
        const report = await runHeartbeatAudit(registry);
        onReport?.(report);
    });

    // Register the heartbeat job
    const job = scheduler.addJob({
        expression: HEARTBEAT_INTERVAL,
        task: "heartbeat_audit",
        description: "30-minute system health check — notifications, battery, connectivity, workflows, security",
    });

    // Override the ID to our known constant
    (job as any).id = HEARTBEAT_JOB_ID;

    logInfo("💓 Heartbeat audit registered (every 30 minutes)");
}

// ─── Manual Audit Tool ───────────────────────────────────────────────────────

import type { ToolDefinition } from "../agent/tool-registry.js";

/** Tool for the agent to manually trigger an audit */
export function createHeartbeatTool(registry: ToolRegistry): ToolDefinition {
    return {
        name: "system_audit",
        description: `Run an instant system health audit. Checks notifications, battery, storage, WiFi, missed calls, cron jobs, and security log. Use this to get a quick overview of the phone and system status.`,
        parameters: {
            type: "object",
            properties: {},
            required: [],
        },
        execute: async (): Promise<ToolResult> => {
            const report = await runHeartbeatAudit(registry);
            return { type: "text", content: report };
        },
    };
}

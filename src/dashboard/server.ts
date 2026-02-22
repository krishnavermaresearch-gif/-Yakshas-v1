/**
 * Agent Dashboard — web UI showing all system status at a glance.
 *
 * Serves on port 3456 (configurable via DASHBOARD_PORT env).
 * Shows: agent status, tools, heartbeat results, exec log, cron jobs, dynamic tools.
 * Uses built-in Node.js HTTP server — no dependencies.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { logInfo, logWarn } from "../logger.js";
import type { ToolRegistry } from "../agent/tool-registry.js";
import { getCronScheduler } from "../cron/scheduler.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const PORT = Number(process.env.DASHBOARD_PORT) || 3456;
let serverStartedAt = 0;

// ─── State Collectors ────────────────────────────────────────────────────────

interface DashboardData {
    uptime: string;
    startedAt: string;
    totalTools: number;
    toolNames: string[];
    cronJobs: Array<{ id: string; description: string; expression: string; enabled: boolean; lastRunAt: string }>;
    execLog: Array<{ timestamp: string; tool: string; command: string; blocked: boolean; reason?: string }>;
    heartbeatReports: string[];
    dynamicTools: string[];
}

const heartbeatReports: string[] = [];
const MAX_REPORTS = 50;

export function pushHeartbeatReport(report: string): void {
    heartbeatReports.unshift(report);
    if (heartbeatReports.length > MAX_REPORTS) heartbeatReports.pop();
}

async function collectData(registry: ToolRegistry | null): Promise<DashboardData> {
    const uptimeMs = Date.now() - serverStartedAt;
    const uptimeH = Math.floor(uptimeMs / 3600000);
    const uptimeM = Math.floor((uptimeMs % 3600000) / 60000);

    // Cron jobs
    let cronJobs: DashboardData["cronJobs"] = [];
    try {
        const scheduler = getCronScheduler();
        cronJobs = scheduler.listJobs().map(j => ({
            id: j.id.slice(0, 8),
            description: j.description,
            expression: j.expression,
            enabled: j.enabled,
            lastRunAt: j.lastRunAt ? new Date(j.lastRunAt).toLocaleString() : "never",
        }));
    } catch { /* scheduler not initialized */ }

    // Exec log
    let execLog: DashboardData["execLog"] = [];
    try {
        const { getExecLog } = await import("../security/exec-safety.js");
        execLog = getExecLog().slice(-30).reverse().map(e => ({
            timestamp: new Date(e.timestamp).toLocaleString(),
            tool: e.tool,
            command: e.command,
            blocked: e.blocked,
            reason: e.reason,
        }));
    } catch { /* security not loaded */ }

    // Dynamic tools
    let dynamicTools: string[] = [];
    try {
        const { readdirSync } = await import("node:fs");
        const { resolve } = await import("node:path");
        const dir = resolve(process.cwd(), "data", "dynamic-tools");
        dynamicTools = readdirSync(dir).filter(f => f.endsWith(".json")).map(f => f.replace(".json", ""));
    } catch { /* no dynamic tools */ }

    return {
        uptime: `${uptimeH}h ${uptimeM}m`,
        startedAt: new Date(serverStartedAt).toLocaleString(),
        totalTools: registry?.size ?? 0,
        toolNames: registry?.names() ?? [],
        cronJobs,
        execLog,
        heartbeatReports: heartbeatReports.slice(0, 10),
        dynamicTools,
    };
}

// ─── HTML Template ───────────────────────────────────────────────────────────

function renderDashboard(data: DashboardData): string {
    const toolCards = data.toolNames.map(name => {
        const isDynamic = data.dynamicTools.includes(name);
        const badge = isDynamic ? `<span class="badge dynamic">dynamic</span>` : "";
        return `<div class="tool-chip">${name}${badge}</div>`;
    }).join("");

    const cronRows = data.cronJobs.map(j => `
        <tr>
            <td><code>${j.id}</code></td>
            <td>${j.description}</td>
            <td><code>${j.expression}</code></td>
            <td><span class="status ${j.enabled ? "active" : "inactive"}">${j.enabled ? "Active" : "Off"}</span></td>
            <td>${j.lastRunAt}</td>
        </tr>`).join("") || `<tr><td colspan="5" class="empty">No cron jobs</td></tr>`;

    const execRows = data.execLog.map(e => `
        <tr class="${e.blocked ? "blocked" : ""}">
            <td>${e.timestamp}</td>
            <td>${e.tool}</td>
            <td><code>${escapeHtml(e.command.slice(0, 60))}</code></td>
            <td>${e.blocked ? `<span class="status blocked">🛡️ BLOCKED</span>` : `<span class="status active">✅</span>`}</td>
            <td>${e.reason || ""}</td>
        </tr>`).join("") || `<tr><td colspan="5" class="empty">No exec log entries</td></tr>`;

    const heartbeatCards = data.heartbeatReports.map(r =>
        `<div class="heartbeat-card"><pre>${escapeHtml(r)}</pre></div>`
    ).join("") || `<div class="heartbeat-card"><pre>No heartbeat reports yet. First report in ~30 min.</pre></div>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Yakshas-v1 Dashboard</title>
    <meta http-equiv="refresh" content="30">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            background: #0a0a1a;
            color: #e0e0f0;
            min-height: 100vh;
        }
        .header {
            background: linear-gradient(135deg, #1a1a3e 0%, #0d0d2b 100%);
            border-bottom: 1px solid #2a2a5e;
            padding: 20px 30px;
            display: flex;
            align-items: center;
            gap: 15px;
        }
        .header h1 {
            font-size: 24px;
            background: linear-gradient(90deg, #6ee7b7, #3b82f6, #a78bfa);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .header .meta {
            margin-left: auto;
            font-size: 13px;
            color: #888;
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
            gap: 20px;
            padding: 25px;
        }
        .card {
            background: #12122e;
            border: 1px solid #1e1e4a;
            border-radius: 12px;
            overflow: hidden;
            transition: border-color 0.3s;
        }
        .card:hover { border-color: #3b82f6; }
        .card-header {
            padding: 14px 18px;
            background: linear-gradient(135deg, #1a1a3e, #15153a);
            border-bottom: 1px solid #1e1e4a;
            font-weight: 600;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #a0a0d0;
        }
        .card-body { padding: 16px 18px; }
        .stat-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
        }
        .stat-box {
            text-align: center;
            padding: 12px 8px;
            background: #0d0d25;
            border-radius: 8px;
            border: 1px solid #1e1e4a;
        }
        .stat-value {
            font-size: 28px;
            font-weight: 700;
            background: linear-gradient(90deg, #6ee7b7, #3b82f6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .stat-label { font-size: 11px; color: #666; margin-top: 4px; }
        .tool-chip {
            display: inline-block;
            padding: 4px 10px;
            margin: 3px;
            background: #1a1a3e;
            border: 1px solid #2a2a5e;
            border-radius: 6px;
            font-size: 12px;
            font-family: monospace;
        }
        .badge {
            display: inline-block;
            padding: 1px 6px;
            margin-left: 4px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 600;
        }
        .badge.dynamic { background: #2a1a4e; color: #a78bfa; border: 1px solid #5b21b6; }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }
        th {
            text-align: left;
            padding: 8px 10px;
            font-size: 11px;
            color: #666;
            text-transform: uppercase;
            border-bottom: 1px solid #1e1e4a;
        }
        td {
            padding: 8px 10px;
            border-bottom: 1px solid #0d0d25;
        }
        tr.blocked { background: rgba(220, 38, 38, 0.1); }
        .status {
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 600;
        }
        .status.active { background: rgba(34, 197, 94, 0.2); color: #6ee7b7; }
        .status.inactive { background: rgba(107, 114, 128, 0.2); color: #9ca3af; }
        .status.blocked { background: rgba(220, 38, 38, 0.2); color: #fca5a5; }
        .empty { color: #444; text-align: center; padding: 20px; }
        .full-width { grid-column: 1 / -1; }
        .heartbeat-card {
            background: #0d0d25;
            border: 1px solid #1e1e4a;
            border-radius: 8px;
            margin-bottom: 10px;
            overflow: auto;
        }
        .heartbeat-card pre {
            padding: 12px;
            font-size: 12px;
            font-family: monospace;
            white-space: pre-wrap;
            color: #b0b0d0;
        }
        code { color: #a78bfa; font-size: 12px; }
        .pulse {
            display: inline-block;
            width: 8px;
            height: 8px;
            background: #22c55e;
            border-radius: 50%;
            margin-right: 8px;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
            50% { opacity: 0.7; box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
        }
    </style>
</head>
<body>
    <div class="header">
        <span class="pulse"></span>
        <h1>Yakshas-v1 Dashboard</h1>
        <div class="meta">Auto-refresh: 30s | Uptime: ${data.uptime} | Started: ${data.startedAt}</div>
    </div>
    <div class="grid">
        <!-- Status Overview -->
        <div class="card">
            <div class="card-header">⚡ System Overview</div>
            <div class="card-body">
                <div class="stat-grid">
                    <div class="stat-box">
                        <div class="stat-value">${data.totalTools}</div>
                        <div class="stat-label">Total Tools</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-value">${data.dynamicTools.length}</div>
                        <div class="stat-label">Dynamic Tools</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-value">${data.cronJobs.length}</div>
                        <div class="stat-label">Cron Jobs</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Cron Jobs -->
        <div class="card">
            <div class="card-header">⏰ Scheduled Jobs</div>
            <div class="card-body">
                <table>
                    <tr><th>ID</th><th>Description</th><th>Schedule</th><th>Status</th><th>Last Run</th></tr>
                    ${cronRows}
                </table>
            </div>
        </div>

        <!-- Tools -->
        <div class="card full-width">
            <div class="card-header">🔧 Registered Tools (${data.totalTools})</div>
            <div class="card-body">${toolCards}</div>
        </div>

        <!-- Heartbeat -->
        <div class="card full-width">
            <div class="card-header">💓 Heartbeat Audit Reports</div>
            <div class="card-body">${heartbeatCards}</div>
        </div>

        <!-- Security Exec Log -->
        <div class="card full-width">
            <div class="card-header">🛡️ Security Exec Log (last 30)</div>
            <div class="card-body">
                <table>
                    <tr><th>Time</th><th>Tool</th><th>Command</th><th>Status</th><th>Reason</th></tr>
                    ${execRows}
                </table>
            </div>
        </div>
    </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── HTTP Server ─────────────────────────────────────────────────────────────

export function startDashboard(registry: ToolRegistry | null): void {
    serverStartedAt = Date.now();

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        // API endpoint for JSON data
        if (req.url === "/api/status") {
            const data = await collectData(registry);
            res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
            res.end(JSON.stringify(data));
            return;
        }

        // Dashboard HTML
        const data = await collectData(registry);
        const html = renderDashboard(data);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
    });

    server.listen(PORT, () => {
        logInfo(`📊 Dashboard running at http://localhost:${PORT}`);
    });

    server.on("error", (err) => {
        logWarn(`Dashboard server error: ${err.message}`);
    });
}

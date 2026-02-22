/**
 * PC Terminal Tool — Secure Shell Execution for Host Computer
 *
 * Multi-layer security: static denylist, output truncation, timeout enforcement.
 */

import { exec } from "node:child_process";
import { logInfo, logWarn, logError } from "../logger.js";
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";

// ─── Dangerous Command Denylist ─────────────────────────────────────────────

const BLOCKED_PATTERNS: RegExp[] = [
    /\brm\s+(-rf?|--recursive)\s+[\/~]/i,
    /\bdel\s+\/s/i,
    /\bformat\s+[a-z]:/i,
    /\brmdir\s+\/s/i,
    /\bmkfs\b/i,
    /\bdd\s+if=/i,
    /\bshutdown\b/i,
    /\breboot\b/i,
    /\bhalt\b/i,
    /\binit\s+0/i,
    /\bsystemctl\s+(poweroff|halt|reboot)/i,
    /\bsudo\s+su\b/i,
    /\bchmod\s+777\s+\//i,
    /\bchown\s+.*\s+\//i,
    /\bwget\s+.*\|\s*(ba)?sh/i,
    /\bcurl\s+.*\|\s*(ba)?sh/i,
    /\bcertutil\s+-decode/i,
    /\bcertutil\s+(-urlcache|-split)/i,
    /\bInvoke-WebRequest\b.*\|\s*iex/i,
    /\bIEX\s*\(/i,
    /\bInvoke-Expression\b/i,
    /\b-ExecutionPolicy\s+Bypass/i,
    /\bSet-ExecutionPolicy\s+Unrestricted/i,
    /\breg\s+(delete|add)\s+HKLM/i,
    /\bcipher\s+\/w/i,
    /\b(echo|printf)\s+.*\|\s*base64\s+-d\s*\|/i,
    /\bpowershell\s+-e(nc|ncodedCommand)?\s+[A-Za-z0-9+\/=]{20,}/i,
    /:\(\)\{\s*:\|:&\s*\};:/,
    /%0\|%0/,
];

function isCommandBlocked(command: string): { blocked: boolean; reason?: string } {
    for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(command)) return { blocked: true, reason: `Matched: ${pattern.source}` };
    }
    return { blocked: false };
}

function execWithTimeout(command: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    return new Promise((resolve, reject) => {
        exec(command, {
            timeout: timeoutMs,
            maxBuffer: 1024 * 1024,
            windowsHide: true,
            shell: process.platform === "win32" ? "powershell.exe" : "/bin/bash",
        }, (error, stdout, stderr) => {
            if (error && (error as any).killed) {
                reject(new Error(`Command timed out after ${timeoutMs}ms`));
                return;
            }
            resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode: error ? (error as any).code ?? 1 : 0 });
        });
    });
}

export const pcShellTool: ToolDefinition = {
    name: "pc_shell",
    description:
        "Execute a terminal command on the host PC (PowerShell on Windows, Bash on Mac/Linux). " +
        "⚠️ Dangerous commands (rm -rf, format, shutdown, etc.) are blocked.",
    parameters: {
        type: "object" as const,
        properties: {
            command: { type: "string", description: "Terminal command to execute" },
            timeout_ms: { type: "number", description: "Timeout in ms (default: 30000, max: 120000)" },
        },
        required: ["command"],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const command = String(args.command ?? "").trim();
        if (!command) return { type: "text", content: "Error: command is required." };

        const check = isCommandBlocked(command);
        if (check.blocked) {
            logWarn(`🛡️ BLOCKED PC command: "${command}" — ${check.reason}`);
            return { type: "text", content: `SECURITY FAULT: Command blocked. "${command}" matches a dangerous pattern.` };
        }

        const timeoutMs = Math.min(120_000, typeof args.timeout_ms === "number" ? args.timeout_ms : 30_000);
        try {
            logInfo(`🖥️ Executing PC command: ${command}`);
            const result = await execWithTimeout(command, timeoutMs);
            const MAX = 8000;
            let output = result.stdout;
            let truncated = false;
            if (output.length > MAX) {
                const half = Math.floor(MAX / 2);
                output = output.slice(0, half) + `\n\n... [${output.length - MAX} chars truncated] ...\n\n` + output.slice(-half);
                truncated = true;
            }
            const parts: string[] = [];
            if (output.trim()) parts.push(output.trim());
            if (result.stderr?.trim()) parts.push(`STDERR: ${result.stderr.trim()}`);
            if (result.exitCode !== null && result.exitCode !== 0) parts.push(`Exit code: ${result.exitCode}`);
            if (truncated) parts.push("(output was truncated)");
            return { type: "text", content: parts.join("\n") || "(no output)" };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logError(`PC shell failed: ${msg}`);
            return { type: "text", content: `PC shell failed: ${msg}` };
        }
    },
};

export const terminalTools: ToolDefinition[] = [pcShellTool];

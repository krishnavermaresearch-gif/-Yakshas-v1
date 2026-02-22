import { getAdb } from "../adb/connection.js";
import { logWarn } from "../logger.js";
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";

// ─── Blocked Commands ────────────────────────────────────────────────────────

const BLOCKED_PATTERNS = [
    /^\s*rm\s+-rf\s+\/\s*$/i,         // rm -rf /
    /^\s*rm\s+-rf\s+\/system/i,        // rm -rf /system
    /^\s*rm\s+-rf\s+\/data\s*$/i,      // rm -rf /data (whole data partition)
    /recovery\s+--wipe/i,              // factory reset via recovery
    /^\s*dd\s+if=/i,                   // dd (disk destroyer)
    /^\s*mkfs\./i,                     // format filesystem
    /^\s*reboot\s+bootloader/i,        // reboot to bootloader
    /flashall/i,                       // flash operations
];

function isCommandBlocked(command: string): boolean {
    return BLOCKED_PATTERNS.some((pattern) => pattern.test(command));
}

// ─── Shell Tool ──────────────────────────────────────────────────────────────

export const shellTool: ToolDefinition = {
    name: "adb_shell",
    description:
        "Run a Linux shell command on the Android phone. Since Android is a Linux-based OS, " +
        "standard Linux commands work: ls, cat, grep, ps, top, find, chmod, etc. " +
        "The shell runs as the 'shell' user (not root unless phone is rooted). " +
        "Use this for advanced operations not covered by other tools.",
    parameters: {
        type: "object" as const,
        properties: {
            command: {
                type: "string",
                description:
                    "The Linux command to execute on the phone. Examples: " +
                    "'ls /sdcard/', 'cat /proc/cpuinfo', 'ps -A | grep chrome', " +
                    "'dumpsys battery', 'getprop ro.product.model'",
            },
            timeout_ms: {
                type: "number",
                description: "Timeout in milliseconds (default: 30000, max: 120000)",
            },
        },
        required: ["command"],
    },
    execute: shellExecute,
};

async function shellExecute(
    args: Record<string, unknown>,
): Promise<ToolResult> {
    const command = String(args.command ?? "").trim();
    if (!command) {
        return { type: "text", content: "Error: command is required." };
    }

    // Security check
    if (isCommandBlocked(command)) {
        logWarn(`Blocked dangerous command: ${command}`);
        return {
            type: "text",
            content: `Command blocked for safety: "${command}". This command could damage the device.`,
        };
    }

    const timeoutMs = Math.min(
        120_000,
        typeof args.timeout_ms === "number" ? args.timeout_ms : 30_000,
    );

    try {
        const adb = getAdb();
        const result = await adb.shell(command, { timeoutMs });

        // Truncate very long output
        const MAX_OUTPUT = 8000;
        let output = result.stdout;
        let truncated = false;
        if (output.length > MAX_OUTPUT) {
            const half = Math.floor(MAX_OUTPUT / 2);
            output =
                output.slice(0, half) +
                `\n\n... [${output.length - MAX_OUTPUT} characters truncated] ...\n\n` +
                output.slice(-half);
            truncated = true;
        }

        const stderr = result.stderr?.trim();
        const parts: string[] = [];
        if (output.trim()) {
            parts.push(output.trim());
        }
        if (stderr) {
            parts.push(`STDERR: ${stderr}`);
        }
        if (result.exitCode !== null && result.exitCode !== 0) {
            parts.push(`Exit code: ${result.exitCode}`);
        }
        if (truncated) {
            parts.push("(output was truncated)");
        }

        return {
            type: "text",
            content: parts.join("\n") || "(no output)",
        };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { type: "text", content: `Shell command failed: ${msg}` };
    }
}

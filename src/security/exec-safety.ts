/**
 * Exec Safety — ADB command sanitizer and dangerous operation blocker.
 *
 * Inspired by OpenClaw's `node-invoke-system-run-approval.ts`.
 * Runs as a before-hook on all adb_* tools to prevent destructive operations.
 */

import { writeFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { logWarn } from "../logger.js";
import type { ToolHook, BeforeHookContext, AfterHookContext } from "../agent/tool-hooks.js";
import type { ToolResult } from "../agent/tool-registry.js";

// ─── Blocked Patterns ────────────────────────────────────────────────────────

/** Commands that should NEVER be executed — destructive/dangerous */
const BLOCKED_SHELL_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
    { pattern: /rm\s+(-rf?|--recursive)\s+\/(?!sdcard)/i, reason: "Recursive delete of system paths" },
    { pattern: /rm\s+-rf?\s+\/system/i, reason: "Deleting system partition" },
    { pattern: /rm\s+-rf?\s+\/data(?!\/local)/i, reason: "Deleting user data partition" },
    { pattern: /mkfs\./i, reason: "Formatting filesystem" },
    { pattern: /dd\s+if=.*of=\/dev/i, reason: "Raw write to device" },
    { pattern: /reboot\s+(bootloader|recovery|fastboot)/i, reason: "Rebooting to dangerous mode" },
    { pattern: /flash/i, reason: "Flashing firmware" },
    { pattern: /factory.?reset/i, reason: "Factory reset" },
    { pattern: /wipe\s+(data|cache|system)/i, reason: "Wiping partitions" },
    { pattern: /pm\s+uninstall.*--user\s+0\s+(com\.android|com\.google)/i, reason: "Uninstalling system apps" },
    { pattern: /settings\s+put\s+global\s+adb_enabled\s+0/i, reason: "Disabling ADB" },
    { pattern: /chmod\s+[0-7]{3}\s+\/system/i, reason: "Changing system file permissions" },
    { pattern: /su\s/i, reason: "Attempting root access" },
    { pattern: /mount\s+.*-o\s+remount.*\/system/i, reason: "Remounting system partition" },
];

/** Commands that are always safe — no approval needed */
const SAFE_PATTERNS: RegExp[] = [
    /^tap\s/i,
    /^swipe\s/i,
    /^input\s+(tap|swipe|text|keyevent)/i,
    /^screencap/i,
    /^dumpsys\s+(activity|window|display|power)/i,
    /^getprop/i,
    /^pm\s+list/i,
    /^am\s+start/i,
    /^uiautomator\s+dump/i,
    /^cat\s+\/proc/i,
    /^ls\s/i,
    /^echo\s/i,
    /^settings\s+get/i,
];

// ─── Exec Log ────────────────────────────────────────────────────────────────

interface ExecLogEntry {
    timestamp: number;
    tool: string;
    command: string;
    blocked: boolean;
    reason?: string;
}

const EXEC_LOG_DIR = resolve(process.cwd(), "data", "security");
const EXEC_LOG_FILE = resolve(EXEC_LOG_DIR, "exec-log.json");
const MAX_EXEC_LOG_ENTRIES = 5000;

let execLog: ExecLogEntry[] = [];
let execLogLoaded = false;

function loadExecLog(): void {
    if (execLogLoaded) return;
    execLogLoaded = true;
    try {
        if (existsSync(EXEC_LOG_FILE)) {
            execLog = JSON.parse(readFileSync(EXEC_LOG_FILE, "utf-8")) as ExecLogEntry[];
        }
    } catch { execLog = []; }
}

function saveExecLog(): void {
    if (!existsSync(EXEC_LOG_DIR)) mkdirSync(EXEC_LOG_DIR, { recursive: true });
    // Trim if too large
    if (execLog.length > MAX_EXEC_LOG_ENTRIES) {
        execLog = execLog.slice(-MAX_EXEC_LOG_ENTRIES);
    }
    writeFileSync(EXEC_LOG_FILE, JSON.stringify(execLog, null, 2), "utf-8");
}

function recordExecEntry(entry: ExecLogEntry): void {
    loadExecLog();
    execLog.push(entry);
    // Save every 10 entries
    if (execLog.length % 10 === 0) saveExecLog();
}

// ─── Sanitizer ───────────────────────────────────────────────────────────────

/** Extract the shell command from tool args */
function extractCommand(toolName: string, args: Record<string, unknown>): string | null {
    // adb_shell has a `command` arg
    if (toolName === "adb_shell" && typeof args.command === "string") {
        return args.command;
    }
    // adb_type has a `text` arg — always safe
    if (toolName === "adb_type") return null;
    // adb_key has a `key` arg — always safe
    if (toolName === "adb_key") return null;
    // adb_tap/swipe have coordinate args — always safe
    if (toolName === "adb_tap" || toolName === "adb_swipe") return null;
    // adb_app_launch/close have `package` arg — check it
    if ((toolName === "adb_app_launch" || toolName === "adb_app_close") && typeof args.package === "string") {
        return args.package;
    }
    return null;
}

/** Check if a command matches blocked patterns */
function checkBlocked(command: string): { blocked: boolean; reason?: string } {
    for (const { pattern, reason } of BLOCKED_SHELL_PATTERNS) {
        if (pattern.test(command)) {
            return { blocked: true, reason };
        }
    }
    return { blocked: false };
}

/** Check if a command is in the safe list (auto-approved) */
function isSafeCommand(command: string): boolean {
    return SAFE_PATTERNS.some(p => p.test(command));
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/** Creates the exec safety hook — blocks dangerous ADB commands */
export function createExecSafetyHook(): ToolHook {
    return {
        name: "security:exec-safety",
        priority: 2, // Run early (after logging, before others)
        before: (ctx: BeforeHookContext) => {
            // Only applies to adb_* tools
            if (!ctx.toolName.startsWith("adb_")) {
                return { blocked: false, args: ctx.args };
            }

            const command = extractCommand(ctx.toolName, ctx.args);

            // No extractable command (tap, swipe, type) — auto-safe
            if (command === null) {
                return { blocked: false, args: ctx.args };
            }

            // Check blocked patterns
            const blockCheck = checkBlocked(command);
            if (blockCheck.blocked) {
                logWarn(`🛡️ BLOCKED dangerous command: "${command}" — ${blockCheck.reason}`);
                recordExecEntry({
                    timestamp: Date.now(),
                    tool: ctx.toolName,
                    command,
                    blocked: true,
                    reason: blockCheck.reason,
                });
                return { blocked: true, reason: `🛡️ Security: ${blockCheck.reason}. Command "${command}" was blocked.` };
            }

            // Record allowed execution
            recordExecEntry({
                timestamp: Date.now(),
                tool: ctx.toolName,
                command,
                blocked: false,
            });

            return { blocked: false, args: ctx.args };
        },
        after: (ctx: AfterHookContext): ToolResult => {
            // Save exec log on after-hook to ensure persistence
            if (ctx.toolName.startsWith("adb_") && execLog.length > 0 && execLog.length % 10 === 0) {
                saveExecLog();
            }
            return ctx.result;
        },
    };
}

/** Get the execution log (for debugging/audit) */
export function getExecLog(): ExecLogEntry[] {
    loadExecLog();
    return [...execLog];
}

/** Clear the execution log */
export function clearExecLog(): void {
    execLog = [];
    execLogLoaded = true;
    saveExecLog();
}

// ─── Exports for testing ─────────────────────────────────────────────────────

export const __testing = {
    BLOCKED_SHELL_PATTERNS,
    SAFE_PATTERNS,
    extractCommand,
    checkBlocked,
    isSafeCommand,
};

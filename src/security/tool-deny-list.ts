/**
 * Tool Deny List — configurable tool blocking.
 *
 * Inspired by OpenClaw's `dangerous-tools.ts`.
 * Provides a hook that blocks execution of denied tools.
 */

import type { ToolHook } from "../agent/tool-hooks.js";

// ─── Default Deny List ───────────────────────────────────────────────────────

/** Tools that should be blocked by default (none — but infrastructure is ready) */
const DEFAULT_DENY: string[] = [];

// ─── Hook ────────────────────────────────────────────────────────────────────

/** Creates a tool deny list hook with configurable blocked tools */
export function createToolDenyListHook(denyList: string[] = DEFAULT_DENY): ToolHook {
    const denied = new Set(denyList.map(t => t.toLowerCase()));

    return {
        name: "security:tool-deny-list",
        priority: 3,
        before: (ctx) => {
            if (denied.has(ctx.toolName.toLowerCase())) {
                return {
                    blocked: true,
                    reason: `Tool "${ctx.toolName}" is blocked by security policy`,
                };
            }
            return { blocked: false, args: ctx.args };
        },
    };
}

/** Creates a tool allow list hook — only listed tools can execute */
export function createToolAllowListHook(allowList: string[]): ToolHook {
    const allowed = new Set(allowList.map(t => t.toLowerCase()));

    return {
        name: "security:tool-allow-list",
        priority: 3,
        before: (ctx) => {
            if (!allowed.has(ctx.toolName.toLowerCase())) {
                return {
                    blocked: true,
                    reason: `Tool "${ctx.toolName}" is not in the allowed tool list`,
                };
            }
            return { blocked: false, args: ctx.args };
        },
    };
}

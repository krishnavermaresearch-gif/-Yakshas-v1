import { getAdb } from "../adb/connection.js";
// Logger imported as needed
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";

// ─── Keycodes ────────────────────────────────────────────────────────────────

export const KEYCODES: Record<string, number> = {
    HOME: 3,
    BACK: 4,
    CALL: 5,
    END_CALL: 6,
    VOLUME_UP: 24,
    VOLUME_DOWN: 25,
    POWER: 26,
    CAMERA: 27,
    CLEAR: 28,
    ENTER: 66,
    DELETE: 67,
    TAB: 61,
    SPACE: 62,
    ESCAPE: 111,
    RECENT_APPS: 187,
    MENU: 82,
    SEARCH: 84,
    MEDIA_PLAY_PAUSE: 85,
    MEDIA_STOP: 86,
    MEDIA_NEXT: 87,
    MEDIA_PREVIOUS: 88,
    MOVE_HOME: 122,
    MOVE_END: 123,
    PAGE_UP: 92,
    PAGE_DOWN: 93,
    BRIGHTNESS_UP: 221,
    BRIGHTNESS_DOWN: 220,
    APP_SWITCH: 187,
    NOTIFICATION: 83,
    SETTINGS: 176,
    CONTACTS: 207,
    CALENDAR: 208,
    MUSIC: 209,
    CALCULATOR: 210,
};

// ─── Tap Tool ────────────────────────────────────────────────────────────────

export const tapTool: ToolDefinition = {
    name: "adb_tap",
    description:
        "Tap on the phone screen at the specified coordinates. " +
        "Use this after adb_ui_tree to tap on a specific UI element. " +
        "Get coordinates from the element's center property.",
    parameters: {
        type: "object" as const,
        properties: {
            x: {
                type: "number",
                description: "X coordinate to tap",
            },
            y: {
                type: "number",
                description: "Y coordinate to tap",
            },
        },
        required: ["x", "y"],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const x = Number(args.x);
        const y = Number(args.y);
        if (Number.isNaN(x) || Number.isNaN(y)) {
            return { type: "text", content: "Error: x and y must be valid numbers." };
        }
        try {
            const adb = getAdb();
            await adb.tap(x, y);
            await adb.sleep(500); // Wait for UI to react
            return { type: "text", content: `Tapped at (${x}, ${y}) successfully.` };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { type: "text", content: `Tap failed: ${msg}` };
        }
    },
};

// ─── Swipe Tool ──────────────────────────────────────────────────────────────

export const swipeTool: ToolDefinition = {
    name: "adb_swipe",
    description:
        "Perform a swipe gesture on the phone screen. " +
        "Useful for scrolling (swipe up to scroll down), swiping between pages, " +
        "or pulling down the notification shade.",
    parameters: {
        type: "object" as const,
        properties: {
            x1: { type: "number", description: "Start X coordinate" },
            y1: { type: "number", description: "Start Y coordinate" },
            x2: { type: "number", description: "End X coordinate" },
            y2: { type: "number", description: "End Y coordinate" },
            duration_ms: {
                type: "number",
                description: "Duration in milliseconds (default: 300). Use 500+ for slow scrolling.",
            },
        },
        required: ["x1", "y1", "x2", "y2"],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const x1 = Number(args.x1);
        const y1 = Number(args.y1);
        const x2 = Number(args.x2);
        const y2 = Number(args.y2);
        const duration = typeof args.duration_ms === "number" ? args.duration_ms : 300;

        if ([x1, y1, x2, y2].some(Number.isNaN)) {
            return { type: "text", content: "Error: all coordinates must be valid numbers." };
        }

        try {
            const adb = getAdb();
            await adb.swipe(x1, y1, x2, y2, duration);
            await adb.sleep(500);
            return {
                type: "text",
                content: `Swiped from (${x1},${y1}) to (${x2},${y2}) in ${duration}ms.`,
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { type: "text", content: `Swipe failed: ${msg}` };
        }
    },
};

// ─── Type Text Tool ──────────────────────────────────────────────────────────

export const typeTool: ToolDefinition = {
    name: "adb_type",
    description:
        "Type text on the phone. First tap on an input field to focus it, then use this " +
        "tool to type text. For special characters or non-English text, use adb_shell with " +
        "'am broadcast' instead.",
    parameters: {
        type: "object" as const,
        properties: {
            text: {
                type: "string",
                description: "Text to type. Spaces and basic punctuation are supported.",
            },
            clear_first: {
                type: "boolean",
                description: "If true, select all text and delete it before typing (default: false).",
            },
        },
        required: ["text"],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const text = String(args.text ?? "");
        const clearFirst = args.clear_first === true;

        if (!text) {
            return { type: "text", content: "Error: text cannot be empty." };
        }

        try {
            const adb = getAdb();

            if (clearFirst) {
                // Select all + delete
                await adb.keyevent("KEYCODE_MOVE_HOME");
                await adb.shell("input keyevent --longpress KEYCODE_SHIFT_LEFT KEYCODE_MOVE_END");
                await adb.keyevent(67); // DELETE
                await adb.sleep(200);
            }

            await adb.type(text);
            await adb.sleep(300);
            return {
                type: "text",
                content: `Typed "${text}"${clearFirst ? " (cleared field first)" : ""}.`,
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { type: "text", content: `Type failed: ${msg}` };
        }
    },
};

// ─── Key Event Tool ──────────────────────────────────────────────────────────

export const keyTool: ToolDefinition = {
    name: "adb_key",
    description:
        "Press a hardware/system key on the phone. Common keys: " +
        "BACK (go back), HOME (go home), ENTER (confirm), " +
        "RECENT_APPS (app switcher), DELETE (backspace), " +
        "VOLUME_UP, VOLUME_DOWN, POWER, TAB, SEARCH, NOTIFICATION.",
    parameters: {
        type: "object" as const,
        properties: {
            key: {
                type: "string",
                description:
                    "Key name (e.g., 'BACK', 'HOME', 'ENTER') or numeric keycode. " +
                    "Available: " + Object.keys(KEYCODES).join(", "),
            },
        },
        required: ["key"],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const key = String(args.key ?? "").toUpperCase().trim();
        if (!key) {
            return { type: "text", content: "Error: key name is required." };
        }

        const keycode = KEYCODES[key] ?? (Number.isFinite(Number(key)) ? Number(key) : null);
        if (keycode === null) {
            return {
                type: "text",
                content: `Unknown key "${key}". Available: ${Object.keys(KEYCODES).join(", ")}`,
            };
        }

        try {
            const adb = getAdb();
            await adb.keyevent(keycode);
            await adb.sleep(400);
            return { type: "text", content: `Pressed ${key} (keycode ${keycode}).` };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { type: "text", content: `Key press failed: ${msg}` };
        }
    },
};

// ─── Long Press Tool ─────────────────────────────────────────────────────────

export const longPressTool: ToolDefinition = {
    name: "adb_long_press",
    description:
        "Long press on a point on the screen. Useful for context menus, " +
        "dragging items, or activating edit mode.",
    parameters: {
        type: "object" as const,
        properties: {
            x: { type: "number", description: "X coordinate" },
            y: { type: "number", description: "Y coordinate" },
            duration_ms: {
                type: "number",
                description: "Duration in milliseconds (default: 1000)",
            },
        },
        required: ["x", "y"],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const x = Number(args.x);
        const y = Number(args.y);
        const duration = typeof args.duration_ms === "number" ? args.duration_ms : 1000;

        if (Number.isNaN(x) || Number.isNaN(y)) {
            return { type: "text", content: "Error: x and y must be valid numbers." };
        }

        try {
            const adb = getAdb();
            // Long press = swipe from same point to same point with duration
            await adb.swipe(x, y, x, y, duration);
            await adb.sleep(500);
            return { type: "text", content: `Long pressed at (${x}, ${y}) for ${duration}ms.` };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { type: "text", content: `Long press failed: ${msg}` };
        }
    },
};

// ─── Wait Tool ───────────────────────────────────────────────────────────────

export const waitTool: ToolDefinition = {
    name: "adb_wait",
    description:
        "Wait for a specified number of milliseconds. Useful for waiting for " +
        "animations, page loads, or app startup before taking the next action.",
    parameters: {
        type: "object" as const,
        properties: {
            ms: {
                type: "number",
                description: "Milliseconds to wait (100-10000, default: 1000)",
            },
        },
        required: [],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const ms = Math.min(10000, Math.max(100, typeof args.ms === "number" ? args.ms : 1000));
        await new Promise((resolve) => setTimeout(resolve, ms));
        return { type: "text", content: `Waited ${ms}ms.` };
    },
};

export const inputTools: ToolDefinition[] = [
    tapTool,
    swipeTool,
    typeTool,
    keyTool,
    longPressTool,
    waitTool,
];

import { getAdb } from "../adb/connection.js";
// Logger available for future use
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";

// ─── App List Tool ───────────────────────────────────────────────────────────

export const appListTool: ToolDefinition = {
    name: "adb_app_list",
    description:
        "List installed apps on the phone. Returns package names of installed applications. " +
        "By default shows only third-party (user-installed) apps.",
    parameters: {
        type: "object" as const,
        properties: {
            all: {
                type: "boolean",
                description: "If true, include system apps too (default: false, third-party only)",
            },
        },
        required: [],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        try {
            const adb = getAdb();
            const showAll = args.all === true;
            const packages = await adb.listPackages(!showAll);
            packages.sort();

            return {
                type: "text",
                content:
                    `Installed apps (${packages.length}${showAll ? ", including system" : ", third-party only"}):\n\n` +
                    packages.map((p, i) => `${i + 1}. ${p}`).join("\n"),
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { type: "text", content: `App list failed: ${msg}` };
        }
    },
};

// ─── App Launch Tool ─────────────────────────────────────────────────────────

export const appLaunchTool: ToolDefinition = {
    name: "adb_app_launch",
    description:
        "Launch (open) an app by its package name. Common packages: " +
        "com.whatsapp (WhatsApp), com.instagram.android (Instagram), " +
        "com.google.android.gm (Gmail), com.google.android.youtube (YouTube), " +
        "com.android.chrome (Chrome), com.google.android.apps.maps (Maps), " +
        "com.spotify.music (Spotify), com.twitter.android (Twitter/X), " +
        "com.facebook.katana (Facebook). " +
        "Use adb_app_list to find exact package names.",
    parameters: {
        type: "object" as const,
        properties: {
            package: {
                type: "string",
                description: "Package name of the app to launch (e.g., 'com.whatsapp')",
            },
        },
        required: ["package"],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const pkg = String(args.package ?? "").trim();
        if (!pkg) {
            return { type: "text", content: "Error: package name is required." };
        }

        try {
            const adb = getAdb();

            // Check if app is installed
            const installed = await adb.isInstalled(pkg);
            if (!installed) {
                return {
                    type: "text",
                    content: `App "${pkg}" is not installed. Use adb_app_list to see available apps.`,
                };
            }

            await adb.launchApp(pkg);
            await adb.sleep(2000); // Wait for app to start

            return {
                type: "text",
                content: `Launched ${pkg}. Wait a moment then use adb_ui_tree or adb_screenshot to see the app.`,
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { type: "text", content: `App launch failed: ${msg}` };
        }
    },
};

// ─── App Stop Tool ───────────────────────────────────────────────────────────

export const appStopTool: ToolDefinition = {
    name: "adb_app_stop",
    description:
        "Force stop (close) an app by its package name. " +
        "This completely kills the app process.",
    parameters: {
        type: "object" as const,
        properties: {
            package: {
                type: "string",
                description: "Package name of the app to stop",
            },
        },
        required: ["package"],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const pkg = String(args.package ?? "").trim();
        if (!pkg) {
            return { type: "text", content: "Error: package name is required." };
        }

        try {
            const adb = getAdb();
            await adb.stopApp(pkg);
            return { type: "text", content: `Stopped ${pkg}.` };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { type: "text", content: `App stop failed: ${msg}` };
        }
    },
};

// ─── App Info Tool ───────────────────────────────────────────────────────────

export const appInfoTool: ToolDefinition = {
    name: "adb_app_info",
    description:
        "Get detailed information about an installed app: version, install date, " +
        "permissions, data size.",
    parameters: {
        type: "object" as const,
        properties: {
            package: {
                type: "string",
                description: "Package name to inspect",
            },
        },
        required: ["package"],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const pkg = String(args.package ?? "").trim();
        if (!pkg) {
            return { type: "text", content: "Error: package name is required." };
        }

        try {
            const adb = getAdb();
            const result = await adb.shell(`dumpsys package ${pkg} | head -50`);
            return {
                type: "text",
                content: `App info for ${pkg}:\n${result.stdout.trim() || "No information found."}`,
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { type: "text", content: `App info failed: ${msg}` };
        }
    },
};

export const appTools: ToolDefinition[] = [
    appListTool,
    appLaunchTool,
    appStopTool,
    appInfoTool,
];

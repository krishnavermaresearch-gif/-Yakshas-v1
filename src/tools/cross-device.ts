/**
 * Cross-Device Orchestrator — PC ↔ Phone Task Router
 */

import { execSync } from "node:child_process";
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";

export const deviceStatusTool: ToolDefinition = {
    name: "device_status",
    description: "Check status of all connected devices (PC + Android phone). Shows available tools per device.",
    parameters: { type: "object" as const, properties: {}, required: [] },
    execute: async (): Promise<ToolResult> => {
        const platform = process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux";
        const status: string[] = [
            "═══ Connected Devices ═══\n",
            `🖥️ PC: ONLINE (${platform})`,
            "   pc_screenshot, pc_click, pc_type, pc_open_app, pc_key, pc_shell",
            "   pc_browse, pc_web_search, pc_download, pc_read_file, pc_write_file",
            "   pc_list_dir, pc_search_files, pc_clipboard_read/write, pc_list/focus_window",
            "",
        ];
        try {
            const out = execSync("adb devices -l", { encoding: "utf-8", timeout: 5000, windowsHide: true });
            const devs = out.split("\n").filter((l) => l.includes("device") && !l.startsWith("List"));
            if (devs.length) {
                status.push("📱 Android: ONLINE");
                devs.forEach((d) => status.push(`   ${d.trim()}`));
                status.push("   adb_tap, adb_swipe, adb_type, adb_key, adb_shell, adb_screenshot, adb_ui_tree");
            } else status.push("📱 Android: OFFLINE (no device)");
        } catch { status.push("📱 Android: OFFLINE (ADB unavailable)"); }
        status.push("", "═══ Routing ═══", "• PC tasks → pc_* tools", "• Phone tasks → adb_* tools");
        return { type: "text", content: status.join("\n") };
    },
};

export const smartRouteTool: ToolDefinition = {
    name: "smart_route",
    description: "Analyze a task and suggest which device (PC or Phone) should handle it.",
    parameters: { type: "object" as const, properties: { task: { type: "string", description: "Task description to analyze" } }, required: ["task"] },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const task = String(args.task ?? "").toLowerCase();
        const phoneKw = ["phone", "mobile", "android", "whatsapp", "instagram", "call", "sms", "camera", "selfie", "notification", "contacts"];
        const pcKw = ["computer", "pc", "laptop", "browser", "chrome", "firefox", "vscode", "code", "terminal", "powershell", "file", "folder", "download", "install", "git"];
        const ps = phoneKw.filter((k) => task.includes(k)).length;
        const cs = pcKw.filter((k) => task.includes(k)).length;
        if (ps > cs) return { type: "text", content: `📱 PHONE recommended. Use adb_* tools.` };
        if (cs > ps) return { type: "text", content: `🖥️ PC recommended. Use pc_* tools.` };
        return { type: "text", content: `🔄 AMBIGUOUS — ask the user or default to PC.` };
    },
};

export const crossDeviceTools: ToolDefinition[] = [deviceStatusTool, smartRouteTool];

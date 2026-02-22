/**
 * Clipboard & Window Manager Tools
 */

import { execSync } from "node:child_process";
import { logInfo } from "../logger.js";
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";

export const pcClipboardReadTool: ToolDefinition = {
    name: "pc_clipboard_read",
    description: "Read the current text from the system clipboard.",
    parameters: { type: "object" as const, properties: {}, required: [] },
    execute: async (): Promise<ToolResult> => {
        try {
            const c = process.platform === "win32"
                ? execSync(`powershell -NoProfile -Command "Get-Clipboard"`, { encoding: "utf-8", timeout: 5000, windowsHide: true }).trim()
                : process.platform === "darwin"
                    ? execSync("pbpaste", { encoding: "utf-8", timeout: 5000 }).trim()
                    : execSync("xclip -selection clipboard -o 2>/dev/null || xsel --clipboard --output", { encoding: "utf-8", timeout: 5000 }).trim();
            return { type: "text", content: c || "(clipboard is empty)" };
        } catch (err) { return { type: "text", content: `Clipboard read failed: ${err instanceof Error ? err.message : err}` }; }
    },
};

export const pcClipboardWriteTool: ToolDefinition = {
    name: "pc_clipboard_write",
    description: "Write text to the system clipboard.",
    parameters: { type: "object" as const, properties: { text: { type: "string", description: "Text to copy" } }, required: ["text"] },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const text = String(args.text ?? "");
        if (!text) return { type: "text", content: "Error: text is required." };
        try {
            if (process.platform === "win32") execSync(`powershell -NoProfile -Command "Set-Clipboard -Value '${text.replace(/'/g, "''")}';"`, { timeout: 5000, windowsHide: true });
            else if (process.platform === "darwin") execSync(`echo "${text.replace(/"/g, '\\"')}" | pbcopy`, { timeout: 5000 });
            else execSync(`echo "${text.replace(/"/g, '\\"')}" | xclip -selection clipboard`, { timeout: 5000 });
            logInfo(`📋 Clipboard set`);
            return { type: "text", content: `Copied to clipboard: "${text.slice(0, 100)}${text.length > 100 ? "..." : ""}"` };
        } catch (err) { return { type: "text", content: `Clipboard write failed: ${err instanceof Error ? err.message : err}` }; }
    },
};

export const pcListWindowsTool: ToolDefinition = {
    name: "pc_list_windows",
    description: "List all open application windows on the host PC.",
    parameters: { type: "object" as const, properties: {}, required: [] },
    execute: async (): Promise<ToolResult> => {
        try {
            const output = process.platform === "win32"
                ? execSync(`powershell -NoProfile -Command "Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object ProcessName, MainWindowTitle | Format-Table -AutoSize"`, { encoding: "utf-8", timeout: 10000, windowsHide: true })
                : process.platform === "darwin"
                    ? execSync(`osascript -e 'tell application "System Events" to get name of every process whose visible is true'`, { encoding: "utf-8", timeout: 10000 })
                    : execSync(`wmctrl -l 2>/dev/null || xdotool search --name '' getwindowname %@ 2>/dev/null`, { encoding: "utf-8", timeout: 10000 });
            return { type: "text", content: output.trim() || "(no windows found)" };
        } catch (err) { return { type: "text", content: `List windows failed: ${err instanceof Error ? err.message : err}` }; }
    },
};

export const pcFocusWindowTool: ToolDefinition = {
    name: "pc_focus_window",
    description: "Bring an application window to the foreground. Use pc_list_windows to find names.",
    parameters: { type: "object" as const, properties: { window_name: { type: "string", description: "Window title or app name (partial match)" } }, required: ["window_name"] },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const name = String(args.window_name ?? "").trim();
        if (!name) return { type: "text", content: "Error: window_name is required." };
        try {
            if (process.platform === "win32") execSync(`powershell -NoProfile -Command "$w = Get-Process | Where-Object {$_.MainWindowTitle -like '*${name}*'} | Select -First 1; if ($w) { Add-Type -TD 'using System; using System.Runtime.InteropServices; public class W { [DllImport(\\\"user32.dll\\\")] public static extern bool SetForegroundWindow(IntPtr h); }'; [W]::SetForegroundWindow($w.MainWindowHandle) }"`, { timeout: 10000, windowsHide: true });
            else if (process.platform === "darwin") execSync(`osascript -e 'tell application "${name}" to activate'`, { timeout: 5000 });
            else execSync(`wmctrl -a "${name}" 2>/dev/null || xdotool search --name "${name}" windowactivate`, { timeout: 5000 });
            await new Promise((r) => setTimeout(r, 500));
            logInfo(`🪟 Focused: ${name}`);
            return { type: "text", content: `Focused window: "${name}"` };
        } catch (err) { return { type: "text", content: `Focus failed: ${err instanceof Error ? err.message : err}` }; }
    },
};

export const clipboardTools: ToolDefinition[] = [pcClipboardReadTool, pcClipboardWriteTool];
export const windowTools: ToolDefinition[] = [pcListWindowsTool, pcFocusWindowTool];

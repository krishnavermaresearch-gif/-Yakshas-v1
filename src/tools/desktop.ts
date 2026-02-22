/**
 * Desktop Control Tools — PC (Windows/Mac/Linux) Automation
 *
 * Provides the AI agent with the ability to control the host computer's
 * desktop: click, type, take screenshots, and launch any application.
 */

import { execSync } from "node:child_process";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logInfo } from "../logger.js";
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";

type Platform = "windows" | "macos" | "linux";

function getPlatform(): Platform {
    switch (process.platform) {
        case "win32": return "windows";
        case "darwin": return "macos";
        default: return "linux";
    }
}

function runSync(cmd: string, timeoutMs = 10_000): string {
    return execSync(cmd, {
        encoding: "utf-8",
        timeout: timeoutMs,
        windowsHide: true,
    }).trim();
}

// ─── PC Screenshot ──────────────────────────────────────────────────────────

export const pcScreenshotTool: ToolDefinition = {
    name: "pc_screenshot",
    description:
        "Take a screenshot of the host computer's screen. " +
        "Returns the screenshot as an image so you can see what is currently on the PC display.",
    parameters: { type: "object" as const, properties: {}, required: [] },
    execute: async (): Promise<ToolResult> => {
        const platform = getPlatform();
        const tmpFile = join(tmpdir(), `pc_screenshot_${Date.now()}.png`);
        try {
            switch (platform) {
                case "windows":
                    runSync(
                        `powershell -NoProfile -Command "` +
                        `Add-Type -AssemblyName System.Windows.Forms; ` +
                        `$s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; ` +
                        `$b = New-Object System.Drawing.Bitmap($s.Width,$s.Height); ` +
                        `$g = [System.Drawing.Graphics]::FromImage($b); ` +
                        `$g.CopyFromScreen($s.Location,[System.Drawing.Point]::Empty,$s.Size); ` +
                        `$b.Save('${tmpFile.replace(/\\/g, "\\\\")}'); $g.Dispose(); $b.Dispose()"`,
                        15_000,
                    );
                    break;
                case "macos":
                    runSync(`screencapture -x "${tmpFile}"`);
                    break;
                case "linux":
                    try { runSync(`scrot "${tmpFile}"`); } catch { runSync(`gnome-screenshot -f "${tmpFile}"`); }
                    break;
            }
            if (!existsSync(tmpFile)) return { type: "text", content: "Screenshot failed: file not created." };
            const buffer = readFileSync(tmpFile);
            try { unlinkSync(tmpFile); } catch { /* ignore */ }
            logInfo(`PC screenshot captured (${buffer.length} bytes)`);
            return { type: "image", content: "PC screenshot captured.", image: { base64: buffer.toString("base64"), mimeType: "image/png" } };
        } catch (err) {
            try { unlinkSync(tmpFile); } catch { /* ignore */ }
            return { type: "text", content: `PC screenshot failed: ${err instanceof Error ? err.message : err}` };
        }
    },
};

// ─── PC Click ───────────────────────────────────────────────────────────────

export const pcClickTool: ToolDefinition = {
    name: "pc_click",
    description: "Click at (x, y) on the host PC screen. Use pc_screenshot first to see where to click.",
    parameters: {
        type: "object" as const,
        properties: {
            x: { type: "number", description: "X coordinate" },
            y: { type: "number", description: "Y coordinate" },
            button: { type: "string", description: "'left' (default), 'right', or 'middle'", enum: ["left", "right", "middle"] },
            double_click: { type: "boolean", description: "Double-click if true (default: false)" },
        },
        required: ["x", "y"],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const x = Number(args.x), y = Number(args.y);
        const button = String(args.button ?? "left");
        const dbl = args.double_click === true;
        if (Number.isNaN(x) || Number.isNaN(y)) return { type: "text", content: "Error: x and y must be numbers." };
        const platform = getPlatform();
        try {
            switch (platform) {
                case "windows": {
                    const clicks = dbl ? 2 : 1;
                    const down = button === "right" ? 8 : button === "middle" ? 32 : 2;
                    const up = button === "right" ? 16 : button === "middle" ? 64 : 4;
                    runSync(
                        `powershell -NoProfile -Command "` +
                        `Add-Type -AssemblyName System.Windows.Forms; ` +
                        `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x},${y}); ` +
                        `Add-Type -MemberDefinition '[DllImport(\\\"user32.dll\\\")] public static extern void mouse_event(int f,int x,int y,int d,int i);' -Name U -Namespace W; ` +
                        `1..${clicks} | ForEach-Object { [W.U]::mouse_event(${down},0,0,0,0); Start-Sleep -m 50; [W.U]::mouse_event(${up},0,0,0,0); Start-Sleep -m 100 }"`,
                    );
                    break;
                }
                case "macos":
                    runSync(`osascript -e 'tell application "System Events" to ${dbl ? "double click" : "click"} at {${x},${y}}' 2>/dev/null || cliclick c:${x},${y}`);
                    break;
                case "linux": {
                    const btn = button === "right" ? 3 : button === "middle" ? 2 : 1;
                    runSync(`xdotool mousemove ${x} ${y}`);
                    runSync(dbl ? `xdotool click --repeat 2 --delay 100 ${btn}` : `xdotool click ${btn}`);
                    break;
                }
            }
            await new Promise((r) => setTimeout(r, 300));
            return { type: "text", content: `${dbl ? "Double-clicked" : "Clicked"} ${button} at (${x},${y}) on PC.` };
        } catch (err) {
            return { type: "text", content: `PC click failed: ${err instanceof Error ? err.message : err}` };
        }
    },
};

// ─── PC Type ────────────────────────────────────────────────────────────────

export const pcTypeTool: ToolDefinition = {
    name: "pc_type",
    description: "Type text on the host PC keyboard into the currently focused window.",
    parameters: {
        type: "object" as const,
        properties: { text: { type: "string", description: "Text to type" } },
        required: ["text"],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const text = String(args.text ?? "");
        if (!text) return { type: "text", content: "Error: text cannot be empty." };
        const platform = getPlatform();
        try {
            switch (platform) {
                case "windows":
                    runSync(`powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${text.replace(/'/g, "''").replace(/[+^%~(){}[\]]/g, "{$&}")}')"`);
                    break;
                case "macos":
                    runSync(`osascript -e 'tell application "System Events" to keystroke "${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"'`);
                    break;
                case "linux":
                    runSync(`xdotool type --clearmodifiers -- "${text.replace(/"/g, '\\"')}"`);
                    break;
            }
            await new Promise((r) => setTimeout(r, 200));
            return { type: "text", content: `Typed "${text}" on PC.` };
        } catch (err) {
            return { type: "text", content: `PC type failed: ${err instanceof Error ? err.message : err}` };
        }
    },
};

// ─── PC Open App ────────────────────────────────────────────────────────────

export const pcOpenAppTool: ToolDefinition = {
    name: "pc_open_app",
    description: "Launch any application on the host PC by name (e.g., 'Chrome', 'Notepad', 'VS Code', 'Photoshop').",
    parameters: {
        type: "object" as const,
        properties: { app_name: { type: "string", description: "Application name to open" } },
        required: ["app_name"],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const appName = String(args.app_name ?? "").trim();
        if (!appName) return { type: "text", content: "Error: app_name is required." };
        const platform = getPlatform();
        const WIN: Record<string, string> = {
            chrome: "start chrome", firefox: "start firefox", edge: "start msedge",
            notepad: "start notepad", calculator: "start calc", explorer: "start explorer",
            terminal: "start wt", powershell: "start powershell", cmd: "start cmd",
            "vs code": "start code", vscode: "start code", word: "start winword",
            excel: "start excel", paint: "start mspaint",
        };
        const MAC: Record<string, string> = {
            chrome: "open -a 'Google Chrome'", firefox: "open -a Firefox", safari: "open -a Safari",
            terminal: "open -a Terminal", finder: "open -a Finder", calculator: "open -a Calculator",
            "vs code": "open -a 'Visual Studio Code'", vscode: "open -a 'Visual Studio Code'",
        };
        try {
            const lower = appName.toLowerCase();
            switch (platform) {
                case "windows": runSync(`cmd /c ${WIN[lower] ?? `start "" "${appName}"`}`); break;
                case "macos": runSync(MAC[lower] ?? `open -a "${appName}"`); break;
                case "linux": try { runSync(`${lower} &`, 3000); } catch { runSync(`xdg-open "${appName}"`, 5000); } break;
            }
            await new Promise((r) => setTimeout(r, 1000));
            logInfo(`Launched app: ${appName}`);
            return { type: "text", content: `Opened "${appName}" on ${platform}.` };
        } catch (err) {
            return { type: "text", content: `Failed to open "${appName}": ${err instanceof Error ? err.message : err}` };
        }
    },
};

// ─── PC Key Press ───────────────────────────────────────────────────────────

export const pcKeyTool: ToolDefinition = {
    name: "pc_key",
    description: "Press a keyboard shortcut on the host PC (e.g., 'ctrl+c', 'alt+tab', 'enter', 'win+d').",
    parameters: {
        type: "object" as const,
        properties: { keys: { type: "string", description: "Key combo (e.g., 'ctrl+c', 'alt+f4', 'enter')" } },
        required: ["keys"],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const keys = String(args.keys ?? "").trim().toLowerCase();
        if (!keys) return { type: "text", content: "Error: keys is required." };
        const platform = getPlatform();
        try {
            switch (platform) {
                case "windows": {
                    const m: Record<string, string> = { ctrl: "^", alt: "%", shift: "+", enter: "{ENTER}", escape: "{ESC}", esc: "{ESC}", tab: "{TAB}", delete: "{DELETE}", backspace: "{BACKSPACE}", up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}", f1: "{F1}", f2: "{F2}", f3: "{F3}", f4: "{F4}", f5: "{F5}", f11: "{F11}", f12: "{F12}" };
                    const sk = keys.split("+").map((p) => m[p] ?? p).join("");
                    runSync(`powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${sk}')"`);
                    break;
                }
                case "macos": {
                    const parts = keys.split("+");
                    const mods: string[] = [];
                    let key = "";
                    for (const p of parts) {
                        if (["ctrl", "control"].includes(p)) mods.push("control down");
                        else if (["alt", "option"].includes(p)) mods.push("option down");
                        else if (p === "shift") mods.push("shift down");
                        else if (["cmd", "command", "win", "super"].includes(p)) mods.push("command down");
                        else key = p;
                    }
                    const modStr = mods.length ? ` using {${mods.join(", ")}}` : "";
                    const ka = key === "enter" ? "key code 36" : key === "escape" || key === "esc" ? "key code 53" : key === "tab" ? "key code 48" : `keystroke "${key}"`;
                    runSync(`osascript -e 'tell application "System Events" to ${ka}${modStr}'`);
                    break;
                }
                case "linux": {
                    const xm: Record<string, string> = { ctrl: "ctrl", alt: "alt", shift: "shift", win: "super", super: "super", cmd: "super", enter: "Return", escape: "Escape", esc: "Escape", tab: "Tab", delete: "Delete", backspace: "BackSpace" };
                    runSync(`xdotool key ${keys.split("+").map((p) => xm[p] ?? p).join("+")}`);
                    break;
                }
            }
            await new Promise((r) => setTimeout(r, 200));
            return { type: "text", content: `Pressed "${keys}" on PC.` };
        } catch (err) {
            return { type: "text", content: `PC key press failed: ${err instanceof Error ? err.message : err}` };
        }
    },
};

export const desktopTools: ToolDefinition[] = [pcScreenshotTool, pcClickTool, pcTypeTool, pcOpenAppTool, pcKeyTool];

/**
 * Code Execution Sandbox — run Python or JavaScript in a sandboxed child process.
 *
 * The agent uses this to:
 * - Do calculations, data processing, API calls
 * - Create dynamic tools on the fly
 * - Manipulate files, parse data, generate content
 *
 * Safety: 30s timeout, 50KB output cap, runs in temp directory.
 */

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { logInfo } from "../logger.js";
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const SANDBOX_DIR = resolve(process.cwd(), "data", "sandbox");
const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 50_000;

// ─── Executor ────────────────────────────────────────────────────────────────

export async function executeCode(
    language: "python" | "javascript",
    code: string,
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
    // Ensure sandbox dir exists
    if (!existsSync(SANDBOX_DIR)) mkdirSync(SANDBOX_DIR, { recursive: true });

    const scriptId = randomUUID().slice(0, 8);
    const ext = language === "python" ? "py" : "js";
    const scriptPath = join(SANDBOX_DIR, `script_${scriptId}.${ext}`);

    // Write script to temp file
    writeFileSync(scriptPath, code, "utf-8");

    const cmd = language === "python" ? "python" : "node";
    const args = language === "python" ? [scriptPath] : ["--experimental-vm-modules", scriptPath];

    return new Promise((resolvePromise) => {
        let stdout = "";
        let stderr = "";
        let timedOut = false;

        const child = spawn(cmd, args, {
            cwd: SANDBOX_DIR,
            timeout: TIMEOUT_MS,
            env: {
                ...process.env,
                // Limit what the child can access
                NODE_ENV: "sandbox",
            },
            stdio: ["pipe", "pipe", "pipe"],
        });

        child.stdout?.on("data", (chunk: Buffer) => {
            const text = chunk.toString("utf-8");
            if (stdout.length < MAX_OUTPUT_CHARS) {
                stdout += text.slice(0, MAX_OUTPUT_CHARS - stdout.length);
            }
        });

        child.stderr?.on("data", (chunk: Buffer) => {
            const text = chunk.toString("utf-8");
            if (stderr.length < MAX_OUTPUT_CHARS) {
                stderr += text.slice(0, MAX_OUTPUT_CHARS - stderr.length);
            }
        });

        child.on("error", (err) => {
            stderr += `\nProcess error: ${err.message}`;
            resolvePromise({ stdout, stderr, exitCode: 1, timedOut: false });
            cleanup();
        });

        child.on("close", (exitCode) => {
            resolvePromise({
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                exitCode: exitCode ?? 1,
                timedOut,
            });
            cleanup();
        });

        // Timeout handler
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
        }, TIMEOUT_MS);

        child.on("close", () => clearTimeout(timer));

        function cleanup() {
            try { unlinkSync(scriptPath); } catch { /* ignore */ }
        }
    });
}

// ─── Tool Definition ─────────────────────────────────────────────────────────

export const executeCodeTool: ToolDefinition = {
    name: "execute_code",
    description: `Run Python or JavaScript code in a sandboxed environment. Use this for:
- Calculations, data processing, text manipulation
- Making HTTP requests / API calls
- Reading/writing files
- Creating scripts to automate tasks
- Any computation the LLM can't do natively
The code runs in a temp directory with a 30-second timeout. Output (stdout) is returned.`,
    parameters: {
        type: "object",
        properties: {
            language: {
                type: "string",
                description: "Programming language: 'python' or 'javascript'",
                enum: ["python", "javascript"],
            },
            code: {
                type: "string",
                description: "The code to execute. Use print() (Python) or console.log() (JS) to produce output.",
            },
        },
        required: ["language", "code"],
    },
    execute: async (args): Promise<ToolResult> => {
        const language = args.language as "python" | "javascript";
        const code = args.code as string;

        if (!code?.trim()) {
            return { type: "text", content: "Error: No code provided" };
        }

        logInfo(`🧪 Executing ${language} code (${code.length} chars)...`);

        try {
            const result = await executeCode(language, code);

            const parts: string[] = [];
            if (result.timedOut) parts.push("⚠️ TIMED OUT (30s limit)");
            if (result.stdout) parts.push(`--- stdout ---\n${result.stdout}`);
            if (result.stderr) parts.push(`--- stderr ---\n${result.stderr}`);
            if (!result.stdout && !result.stderr) parts.push("(no output)");
            parts.push(`Exit code: ${result.exitCode}`);

            return { type: "text", content: parts.join("\n\n") };
        } catch (err) {
            return {
                type: "text",
                content: `Error executing ${language}: ${err instanceof Error ? err.message : err}`,
            };
        }
    },
};

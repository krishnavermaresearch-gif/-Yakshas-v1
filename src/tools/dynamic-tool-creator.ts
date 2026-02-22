/**
 * Dynamic Tool Creator — the agent creates its own tools at runtime.
 *
 * When the agent needs a tool that doesn't exist, it writes the tool's
 * implementation in Python or JavaScript, and registers it into the live
 * ToolRegistry. The tool is persisted to disk so it survives restarts.
 *
 * Flow:
 * 1. Agent calls `create_tool` with name, description, params, and code
 * 2. We validate the code runs without errors (dry run)
 * 3. Register it into the live ToolRegistry
 * 4. Persist to data/dynamic-tools/ for reload on next startup
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { logInfo, logWarn } from "../logger.js";
import { executeCode } from "./code-executor.js";
import type { ToolDefinition, ToolResult, ToolRegistry } from "../agent/tool-registry.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const DYNAMIC_TOOLS_DIR = resolve(process.cwd(), "data", "dynamic-tools");

// ─── Types ───────────────────────────────────────────────────────────────────

interface DynamicToolSpec {
    name: string;
    description: string;
    parameters: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
    language: "python" | "javascript";
    /** The implementation code — receives args as JSON via stdin (Python) or process.argv (JS) */
    code: string;
    createdAt: number;
}

// ─── Core Logic ──────────────────────────────────────────────────────────────

/** Convert a DynamicToolSpec into a live ToolDefinition */
function specToTool(spec: DynamicToolSpec): ToolDefinition {
    return {
        name: spec.name,
        description: spec.description + "\n[Dynamic tool — created by the agent]",
        parameters: {
            type: "object",
            properties: spec.parameters,
            required: spec.required,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            // Inject the args as a JSON variable at the top of the code
            let wrappedCode: string;
            const argsJson = JSON.stringify(args);

            if (spec.language === "python") {
                wrappedCode = `import json\nargs = json.loads('${argsJson.replace(/'/g, "\\'")}')\n\n${spec.code}`;
            } else {
                wrappedCode = `const args = ${argsJson};\n\n${spec.code}`;
            }

            const result = await executeCode(spec.language, wrappedCode);

            if (result.timedOut) {
                return { type: "text", content: `⚠️ Dynamic tool "${spec.name}" timed out (30s limit)` };
            }

            if (result.exitCode !== 0 && result.stderr) {
                return { type: "text", content: `Error in "${spec.name}": ${result.stderr.slice(0, 2000)}` };
            }

            return { type: "text", content: result.stdout || "(no output)" };
        },
    };
}

/** Persist a tool spec to disk */
function persistTool(spec: DynamicToolSpec): void {
    if (!existsSync(DYNAMIC_TOOLS_DIR)) mkdirSync(DYNAMIC_TOOLS_DIR, { recursive: true });
    const filePath = join(DYNAMIC_TOOLS_DIR, `${spec.name}.json`);
    writeFileSync(filePath, JSON.stringify(spec, null, 2), "utf-8");
    logInfo(`💾 Dynamic tool "${spec.name}" persisted to ${filePath}`);
}

/** Load all persisted dynamic tools and register them */
export function loadDynamicTools(registry: ToolRegistry): number {
    if (!existsSync(DYNAMIC_TOOLS_DIR)) return 0;

    const files = readdirSync(DYNAMIC_TOOLS_DIR).filter(f => f.endsWith(".json"));
    let count = 0;

    for (const file of files) {
        try {
            const raw = readFileSync(join(DYNAMIC_TOOLS_DIR, file), "utf-8");
            const spec = JSON.parse(raw) as DynamicToolSpec;
            const tool = specToTool(spec);
            registry.register(tool);
            count++;
            logInfo(`🔧 Loaded dynamic tool: ${spec.name} (${spec.language})`);
        } catch (err) {
            logWarn(`Failed to load dynamic tool ${file}: ${err instanceof Error ? err.message : err}`);
        }
    }

    return count;
}

// ─── Tool Definition ─────────────────────────────────────────────────────────

/** Creates the create_tool ToolDefinition. Needs registry reference to register new tools into. */
export function createDynamicToolCreator(registry: ToolRegistry): ToolDefinition {
    return {
        name: "create_tool",
        description: `Create a new tool dynamically using Python or JavaScript code.
Use this when you need a tool that doesn't exist yet. The tool will be registered immediately and available for use.

Your code receives an 'args' variable (dict/object) with the tool's parameters.
Use print() (Python) or console.log() (JS) to produce the tool's output.

Example — creating a Bitcoin price checker tool:
  name: "check_bitcoin_price"
  description: "Get current Bitcoin price in USD"
  parameters_json: "{}"
  required_params: ""
  language: "python"
  code: "import urllib.request; import json; r = urllib.request.urlopen('https://api.coindesk.com/v1/bpi/currentprice.json'); data = json.loads(r.read()); print('Bitcoin: ' + data['bpi']['USD']['rate'])"`,
        parameters: {
            type: "object",
            properties: {
                name: {
                    type: "string",
                    description: "Unique tool name (snake_case, e.g. 'check_weather')",
                },
                description: {
                    type: "string",
                    description: "What the tool does — shown to the LLM when choosing tools",
                },
                parameters_json: {
                    type: "string",
                    description: `JSON string of parameter definitions, e.g. '{"city": {"type": "string", "description": "City name"}}'. Empty object '{}' if no params.`,
                },
                required_params: {
                    type: "string",
                    description: "Comma-separated list of required parameter names (e.g. 'city,country'). Empty string if none.",
                },
                language: {
                    type: "string",
                    description: "Implementation language: 'python' or 'javascript'",
                    enum: ["python", "javascript"],
                },
                code: {
                    type: "string",
                    description: "The implementation code. Receives 'args' variable with parameters. Use print()/console.log() for output.",
                },
            },
            required: ["name", "description", "parameters_json", "language", "code"],
        },
        execute: async (args): Promise<ToolResult> => {
            const name = (args.name as string)?.trim();
            const description = args.description as string;
            const parametersJson = args.parameters_json as string;
            const requiredParamsStr = (args.required_params as string) ?? "";
            const language = args.language as "python" | "javascript";
            const code = args.code as string;

            // Validation
            if (!name || !description || !code) {
                return { type: "text", content: "Error: name, description, and code are required" };
            }

            if (!/^[a-z][a-z0-9_]*$/.test(name)) {
                return { type: "text", content: "Error: Tool name must be snake_case (e.g. 'check_weather')" };
            }

            // Parse parameters
            let parameters: Record<string, { type: string; description: string; enum?: string[] }>;
            try {
                parameters = JSON.parse(parametersJson || "{}");
            } catch {
                return { type: "text", content: "Error: parameters_json is not valid JSON" };
            }

            const required = requiredParamsStr
                ? requiredParamsStr.split(",").map(s => s.trim()).filter(Boolean)
                : [];

            // Dry run — test the code with empty/default args
            logInfo(`🧪 Testing dynamic tool "${name}" (${language})...`);
            const testArgs: Record<string, unknown> = {};
            for (const [key, def] of Object.entries(parameters)) {
                testArgs[key] = def.type === "string" ? "test" : def.type === "number" ? 0 : "";
            }

            const argsJson = JSON.stringify(testArgs);
            let testCode: string;
            if (language === "python") {
                testCode = `import json\nargs = json.loads('${argsJson.replace(/'/g, "\\'")}')\n\n${code}`;
            } else {
                testCode = `const args = ${argsJson};\n\n${code}`;
            }

            const testResult = await executeCode(language, testCode);

            if (testResult.timedOut) {
                return { type: "text", content: `❌ Tool test timed out. Fix the code and try again.` };
            }

            // Build spec and register
            const spec: DynamicToolSpec = {
                name,
                description,
                parameters,
                required,
                language,
                code,
                createdAt: Date.now(),
            };

            const tool = specToTool(spec);
            registry.register(tool);
            persistTool(spec);

            const statusMsg = testResult.exitCode === 0
                ? `✅ Tool "${name}" created and registered!\nTest output: ${testResult.stdout?.slice(0, 500) || "(none)"}`
                : `⚠️ Tool "${name}" created with warnings:\nstderr: ${testResult.stderr?.slice(0, 500)}\nThe tool is registered but may have issues.`;

            return { type: "text", content: statusMsg };
        },
    };
}

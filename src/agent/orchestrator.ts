import { logInfo, logWarn } from "../logger.js";
import { getDeviceInfo, type DeviceInfo } from "../adb/device-info.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { createCoreToolRegistry, type ToolRegistry, type ToolResult } from "./tool-registry.js";
import { runAgent } from "./runner.js";
import { loadPlugins, type PhonePlugin } from "../plugins/loader.js";
import { getMemoryManager } from "../memory/memory-manager.js";
import { getExperienceStore } from "../learning/experience-store.js";
import { getRewardTracker } from "../learning/reward-tracker.js";
import { getSkillGenerator } from "../learning/skill-generator.js";
import { matchSkillTemplates, formatSkillTemplatesPrompt } from "../learning/skill-matcher.js";
import { getApiManager } from "../api/api-manager.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type OrchestratorOptions = {
    /** Called when a tool executes — use for progress updates (screenshots to Telegram) */
    onToolResult?: (toolName: string, result: ToolResult) => void;
    /** Called when the agent sends an intermediate message */
    onMessage?: (text: string) => void;
    /** Chat ID for memory scoping */
    chatId?: number;
    /** Base64 images to include in the user message for vision analysis */
    images?: string[];
};

export type OrchestratorResult = {
    success: boolean;
    message: string;
    totalToolCalls: number;
    lastScreenshot?: Buffer;
    reward?: number;
};

// ─── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Multi-agent orchestrator with reinforcement learning.
 *
 * Each task: retrieve memory + past experiences → build context-rich prompt →
 * run agent → compute reward → store experience → update user profile.
 * The agent improves with every interaction.
 */
export class Orchestrator {
    private deviceInfo: DeviceInfo | null = null;
    private plugins: PhonePlugin[] = [];
    private coreRegistry: ToolRegistry | null = null;
    private installedApps: string[] = [];

    async initialize(): Promise<void> {
        logInfo("Orchestrator initializing...");

        this.deviceInfo = await getDeviceInfo();
        this.plugins = await loadPlugins();
        logInfo(`Loaded ${this.plugins.length} plugins: ${this.plugins.map((p) => p.name).join(", ")}`);

        // Cache installed apps for prompt injection
        try {
            const adb = (await import("../adb/connection.js")).getAdb();
            this.installedApps = await adb.listPackages(true); // third-party only
            this.installedApps.sort();
            logInfo(`Found ${this.installedApps.length} installed apps`);
        } catch {
            logWarn("Could not fetch installed apps list");
        }

        this.coreRegistry = createCoreToolRegistry();
        for (const plugin of this.plugins) {
            for (const tool of plugin.tools) {
                if (!this.coreRegistry.has(tool.name)) {
                    this.coreRegistry.register(tool);
                }
            }
        }

        // Auto-generate tools from configured APIs
        try {
            const { generateApiTools } = await import("../api/auto-tool-generator.js");
            const apiToolCount = generateApiTools(this.coreRegistry);
            if (apiToolCount > 0) {
                logInfo(`Auto-generated ${apiToolCount} API tools`);
            }
        } catch {
            // API tools are best-effort
        }

        logInfo(`Orchestrator ready with ${this.coreRegistry.size} tools`);

        // ── Register security hooks ──────────────────────────────────────────
        try {
            const { getHookRegistry } = await import("./tool-hooks.js");
            const { createExecSafetyHook } = await import("../security/exec-safety.js");
            const { createRateLimitHook } = await import("./tool-hooks.js");

            const hooks = getHookRegistry();
            hooks.add(createExecSafetyHook());
            hooks.add(createRateLimitHook(60));
            logInfo(`🪝 Security hooks registered: ${hooks.list().join(", ")}`);
        } catch (err) {
            logWarn(`Security hooks failed to register: ${err instanceof Error ? err.message : err}`);
        }

        // ── Register Phase 3 autonomous tools ───────────────────────────────
        try {
            // Code execution sandbox
            const { executeCodeTool } = await import("../tools/code-executor.js");
            this.coreRegistry.register(executeCodeTool);

            // Dynamic tool creator (agent creates its own tools)
            const { createDynamicToolCreator, loadDynamicTools } = await import("../tools/dynamic-tool-creator.js");
            this.coreRegistry.register(createDynamicToolCreator(this.coreRegistry));
            const dynamicCount = loadDynamicTools(this.coreRegistry);
            if (dynamicCount > 0) logInfo(`🔧 Loaded ${dynamicCount} persisted dynamic tools`);

            // Browser & internet tools
            const { browserTools } = await import("../tools/browser-tools.js");
            this.coreRegistry.registerAll(browserTools);

            // File I/O tools
            const { fileTools } = await import("../tools/file-tools.js");
            this.coreRegistry.registerAll(fileTools);

            // Sub-agent spawner
            const { createSubAgentTool } = await import("./subagent.js");
            this.coreRegistry.register(createSubAgentTool(this.coreRegistry));

            logInfo(`🚀 Phase 3 autonomous tools registered. Total: ${this.coreRegistry.size} tools`);
        } catch (err) {
            logWarn(`Phase 3 tools failed to register: ${err instanceof Error ? err.message : err}`);
        }

        // ── Heartbeat Audit System (30-minute auto-check) ────────────────────
        try {
            const { registerHeartbeat, createHeartbeatTool } = await import("../autonomy/heartbeat.js");
            const { pushHeartbeatReport } = await import("../dashboard/server.js");
            this.coreRegistry.register(createHeartbeatTool(this.coreRegistry));
            registerHeartbeat(this.coreRegistry, (report) => {
                logInfo(`💓 Heartbeat report:\n${report}`);
                pushHeartbeatReport(report);
            });
            logInfo("💓 Heartbeat audit system active (every 30 min)");
        } catch (err) {
            logWarn(`Heartbeat failed to register: ${err instanceof Error ? err.message : err}`);
        }

        // ── Dashboard Web UI ─────────────────────────────────────────────────
        try {
            const { startDashboard } = await import("../dashboard/server.js");
            startDashboard(this.coreRegistry);
        } catch (err) {
            logWarn(`Dashboard failed to start: ${err instanceof Error ? err.message : err}`);
        }
    }

    getDeviceInfo(): DeviceInfo | null { return this.deviceInfo; }
    getPluginNames(): string[] { return this.plugins.map((p) => `${p.name}: ${p.description}`); }
    getToolNames(): string[] { return this.coreRegistry?.names() ?? []; }
    getRegistry(): ToolRegistry | null { return this.coreRegistry; }

    /**
     * Execute a user task with full RL pipeline:
     * 1. Store message in memory
     * 2. Retrieve relevant memories + past experiences
     * 3. Inject user profile + learned strategies
     * 4. Run agent
     * 5. Compute reward + store experience
     */
    async executeTask(
        userMessage: string,
        options: OrchestratorOptions = {},
    ): Promise<OrchestratorResult> {
        if (!this.deviceInfo || !this.coreRegistry) {
            await this.initialize();
        }

        logInfo(`Executing task: "${userMessage.slice(0, 100)}..."`);

        // ── Phase 1: Store user message ──
        const memory = getMemoryManager();
        await memory.addUserMessage(userMessage, options.chatId);

        // Refresh device info
        try { this.deviceInfo = await getDeviceInfo(); } catch { logWarn("Using cached device info"); }

        // ── Phase 2: Build context-rich prompt ──
        let fullPrompt = buildSystemPrompt(this.deviceInfo!);

        // Plugin instructions
        const pluginInstructions = this.plugins
            .map(
                (p) =>
                    `### ${p.name} Plugin (${p.appPackage})\n${p.systemPrompt}\n` +
                    `Tools: ${p.tools.map((t: { name: string }) => t.name).join(", ")}`,
            )
            .join("\n\n");

        if (pluginInstructions) {
            fullPrompt += `\n\n## Available Plugins\n${pluginInstructions}`;
        }

        // Installed apps — so agent knows what's on the phone
        if (this.installedApps.length > 0) {
            const appList = this.installedApps
                .map((p) => {
                    // Extract readable name from package
                    const parts = p.split(".");
                    const name = parts[parts.length - 1] ?? p;
                    return `- \`${p}\` (${name})`;
                })
                .join("\n");
            fullPrompt += `\n\n## Installed Apps (${this.installedApps.length} apps)\n**ALWAYS prefer launching an installed app over using a browser.** If the user mentions an app/service name, check this list first and use \`adb_app_launch\` with the package name.\n\n${appList}`;
        }

        // Memory context (recent conversation + similar past interactions)
        try {
            const memoryContext = await memory.getContext(userMessage);
            if (memoryContext) {
                fullPrompt += `\n\n## Memory — Past Interactions\n${memoryContext}`;
            }
        } catch (err) {
            logWarn(`Memory retrieval failed: ${err instanceof Error ? err.message : err}`);
        }

        // RL: Retrieve relevant past experiences (learned strategies)
        try {
            const expStore = getExperienceStore();
            const experiences = await expStore.getRelevantExperiences(userMessage, 3);
            const examplesPrompt = expStore.formatAsExamples(experiences);
            if (examplesPrompt) {
                fullPrompt += `\n\n${examplesPrompt}`;
            }
        } catch {
            // RL retrieval is best-effort
        }

        // User profile (personality + habits)
        try {
            const tracker = getRewardTracker();
            const profilePrompt = tracker.getProfilePrompt();
            if (profilePrompt) {
                fullPrompt += `\n\n${profilePrompt}`;
            }
        } catch {
            // Profile is best-effort
        }

        // Auto-learned app skills
        try {
            const skillPrompt = getSkillGenerator().getSkillPrompt();
            if (skillPrompt) {
                fullPrompt += `\n\n${skillPrompt}`;
            }
        } catch {
            // Skills are best-effort
        }

        // Pre-built skill templates — dynamically matched to this task
        try {
            const toolNames = this.coreRegistry?.names() ?? [];
            const matched = matchSkillTemplates(userMessage, toolNames);
            const templatePrompt = formatSkillTemplatesPrompt(matched);
            if (templatePrompt) {
                fullPrompt += `\n\n${templatePrompt}`;
            }
        } catch {
            // Skill templates are best-effort
        }

        // Available APIs
        try {
            const apiPrompt = getApiManager().getApisForPrompt();
            if (apiPrompt) {
                fullPrompt += `\n\n${apiPrompt}`;
            }
        } catch {
            // APIs are best-effort
        }

        // ── Phase 3: Run agent ──────────────────────────────────────
        // Priority: Plan-Execute-Report → Micro-agents → Iterative runner

        const { planExecuteReport } = await import("./plan-executor.js");
        const { getMicroAgentSpawner, MicroAgentSpawner } = await import("./micro-agent.js");

        let result: import("./runner.js").RunnerResult;

        // Try Plan-Execute-Report first (deterministic, fast)
        const planResult = await planExecuteReport(
            userMessage,
            this.coreRegistry!,
            (_step, _idx, toolResult) => options.onToolResult?.(_step.tool, toolResult),
        );

        if (planResult) {
            logInfo(`📋 Plan-Execute-Report succeeded: ${planResult.stepResults.length} steps, ${planResult.totalDurationMs}ms`);
            result = {
                success: planResult.success,
                message: planResult.message,
                toolCallCount: planResult.stepResults.length,
                iterationCount: 2, // plan + report = 2 LLM calls
                toolSteps: planResult.toolSteps,
                durationMs: planResult.totalDurationMs,
            };
        } else {
            // Fall back to micro-agents or iterative runner
            const spawner = getMicroAgentSpawner();
            const decomposition = spawner.decompose(userMessage);

            if (decomposition.shouldDecompose) {
                // Complex task → micro-agents
                logInfo(`Task decomposed: ${decomposition.reasoning}`);
                options.onMessage?.(`🔀 Splitting into ${decomposition.subtasks.length} subtasks...`);

                const microResults = await spawner.execute(
                    decomposition.subtasks,
                    fullPrompt,
                    this.coreRegistry!,
                    options.chatId,
                    (_taskId, status) => options.onMessage?.(`  ⚡ ${status}`),
                );

                const combinedMessage = MicroAgentSpawner.formatResults(microResults);
                const allSteps = microResults.flatMap((r) => r.toolSteps);
                const totalDuration = microResults.reduce((sum, r) => sum + r.durationMs, 0);
                const allSucceeded = microResults.every((r) => r.success);

                result = {
                    success: allSucceeded,
                    message: combinedMessage,
                    toolCallCount: allSteps.length,
                    iterationCount: microResults.length,
                    toolSteps: allSteps,
                    durationMs: totalDuration,
                };
            } else {
                // Simple task → single agent (iterative runner)
                result = await runAgent(userMessage, {
                    systemPrompt: fullPrompt,
                    registry: this.coreRegistry!,
                    maxIterations: 30,
                    onToolResult: options.onToolResult,
                    onMessage: options.onMessage,
                    images: options.images,
                });
            }
        }

        // ── Phase 4: Post-task RL processing ──
        let reward: number | undefined;
        try {
            // Store in memory
            await memory.addAgentResponse(result.message, options.chatId);
            await memory.addTaskResult(userMessage, result.message, options.chatId);
            memory.save();

            // Compute reward and store experience
            const tracker = getRewardTracker();
            const experience = await tracker.processOutcome({
                task: userMessage,
                success: result.success,
                toolCalls: result.toolSteps,
                totalDurationMs: result.durationMs,
                agentResponse: result.message,
            });
            reward = experience.reward;

            // Auto-learn app skills from this experience
            getSkillGenerator().learnFromExperience(experience);
        } catch {
            // Post-processing is best-effort
        }

        return {
            success: result.success,
            message: result.message,
            totalToolCalls: result.toolCallCount,
            lastScreenshot: result.lastScreenshot,
            reward,
        };
    }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _orchestrator: Orchestrator | null = null;

export function getOrchestrator(): Orchestrator {
    if (!_orchestrator) {
        _orchestrator = new Orchestrator();
    }
    return _orchestrator;
}


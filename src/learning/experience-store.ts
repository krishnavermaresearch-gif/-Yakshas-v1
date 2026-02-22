/**
 * Experience Store — stores agent action sequences with reward scores in ChromaDB.
 *
 * This is the core of the reinforcement learning system. Each "experience" is:
 * - A task description (what the user asked)
 * - A sequence of tool calls (what the agent did)
 * - A reward score (how well it worked)
 *
 * On new tasks, the agent retrieves similar past experiences and uses
 * successful ones as few-shot examples to guide its strategy.
 */

import { logDebug, logInfo, logWarn } from "../logger.js";
import { VectorStore, type MemoryMetadata } from "../memory/vector-store.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ToolStep = {
    tool: string;
    args: Record<string, unknown>;
    result: string;  // Truncated result
    durationMs: number;
};

export type Experience = {
    id: string;
    task: string;
    steps: ToolStep[];
    reward: number;           // -1.0 to 1.0
    success: boolean;
    totalToolCalls: number;
    totalDurationMs: number;
    timestamp: number;
    /** Human-readable summary of what worked/failed */
    insight: string;
};

export type RetrievedExperience = {
    experience: Experience;
    similarity: number;       // 0.0 to 1.0
};

// ─── Experience Store ────────────────────────────────────────────────────────

export class ExperienceStore {
    private store: VectorStore;
    private ollamaUrl: string;
    private embeddingModel: string;
    private initialized = false;

    constructor(chromaUrl?: string) {
        this.store = new VectorStore("phone_agent_experiences", chromaUrl);
        this.ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
        this.embeddingModel = process.env.OLLAMA_EMBEDDING_MODEL ?? "snowflake-arctic-embed:137m";
    }

    async init(): Promise<boolean> {
        if (this.initialized) return true;
        try {
            await this.store.initialize();
            this.initialized = true;
            return true;
        } catch (err) {
            logWarn(`Experience store init failed: ${err instanceof Error ? err.message : err}`);
            return false;
        }
    }

    /**
     * Store a completed experience with its reward.
     */
    async store_experience(experience: Experience): Promise<void> {
        if (!(await this.init())) return;

        try {
            const embedding = await this.embed(experience.task);
            if (!embedding) return;

            // Serialize steps for storage (compact format)
            const stepsText = experience.steps
                .map((s, i) => `${i + 1}. ${s.tool}(${JSON.stringify(s.args).slice(0, 100)}) → ${s.result.slice(0, 80)}`)
                .join("\n");

            const document = `Task: ${experience.task}\nReward: ${experience.reward.toFixed(2)}\nSuccess: ${experience.success}\nSteps:\n${stepsText}\nInsight: ${experience.insight}`;

            const metadata: MemoryMetadata = {
                type: "experience",
                timestamp: experience.timestamp,
                summary: experience.insight,
            };

            // Store with extra fields in metadata
            const extendedMeta = {
                ...metadata,
                reward: experience.reward,
                success_flag: experience.success ? 1 : 0,
                tool_count: experience.totalToolCalls,
                duration_ms: experience.totalDurationMs,
            };

            await this.store.add(experience.id, document, embedding, extendedMeta as unknown as MemoryMetadata);
            logInfo(`Experience stored: reward=${experience.reward.toFixed(2)}, tools=${experience.totalToolCalls}, "${experience.task.slice(0, 60)}"`);
        } catch (err) {
            logDebug(`Failed to store experience: ${err instanceof Error ? err.message : err}`);
        }
    }

    /**
     * Retrieve relevant past experiences for a new task.
     * Returns only positive experiences (reward > 0) sorted by relevance.
     */
    async getRelevantExperiences(task: string, topK: number = 3): Promise<RetrievedExperience[]> {
        if (!(await this.init())) return [];

        try {
            const embedding = await this.embed(task);
            if (!embedding) return [];

            const results = await this.store.search(embedding, topK * 2); // Fetch more, filter later

            return results
                .filter((r) => {
                    // Only return experiences with positive reward
                    const meta = r.metadata as Record<string, unknown>;
                    const reward = typeof meta.reward === "number" ? meta.reward : 0;
                    return reward > 0;
                })
                .slice(0, topK)
                .map((r) => ({
                    experience: this.parseExperience(r.id, r.text, r.metadata),
                    similarity: 1 - r.distance,
                }));
        } catch (err) {
            logDebug(`Failed to retrieve experiences: ${err instanceof Error ? err.message : err}`);
            return [];
        }
    }

    /**
     * Format retrieved experiences as few-shot examples for the system prompt.
     */
    formatAsExamples(experiences: RetrievedExperience[]): string {
        if (experiences.length === 0) return "";

        const examples = experiences.map((exp, i) => {
            const e = exp.experience;
            const stepsPreview = e.steps
                .slice(0, 8) // Limit steps shown
                .map((s, j) => `  ${j + 1}. ${s.tool}(${JSON.stringify(s.args).slice(0, 80)})`)
                .join("\n");

            return `### Example ${i + 1} (${(exp.similarity * 100).toFixed(0)}% similar, reward=${e.reward.toFixed(1)})
Task: "${e.task}"
Successful approach:
${stepsPreview}
Insight: ${e.insight}`;
        });

        return `## Learned Strategies (from past experience)
Use these proven approaches as guidance — they worked before for similar tasks.

${examples.join("\n\n")}`;
    }

    /**
     * Get count of stored experiences.
     */
    async count(): Promise<number> {
        if (!(await this.init())) return 0;
        return this.store.count();
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    private parseExperience(id: string, text: string, metadata: MemoryMetadata): Experience {
        // Parse the document text back into structured experience
        const lines = text.split("\n");
        const taskLine = lines.find((l) => l.startsWith("Task:"));
        const insightLine = lines.find((l) => l.startsWith("Insight:"));
        const meta = metadata as Record<string, unknown>;

        return {
            id,
            task: taskLine?.slice(6).trim() ?? "",
            steps: [], // Steps parsed from text if needed
            reward: typeof meta.reward === "number" ? meta.reward : 0,
            success: meta.success_flag === 1,
            totalToolCalls: typeof meta.tool_count === "number" ? meta.tool_count : 0,
            totalDurationMs: typeof meta.duration_ms === "number" ? meta.duration_ms : 0,
            timestamp: metadata.timestamp ?? Date.now(),
            insight: insightLine?.slice(9).trim() ?? "",
        };
    }

    private async embed(text: string): Promise<number[] | null> {
        try {
            const resp = await fetch(`${this.ollamaUrl}/api/embed`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: this.embeddingModel,
                    input: text.slice(0, 2000),
                }),
                signal: AbortSignal.timeout(15_000),
            });

            if (!resp.ok) return null;

            const data = (await resp.json()) as { embeddings?: number[][] };
            return data.embeddings?.[0] ?? null;
        } catch {
            return null;
        }
    }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _experienceStore: ExperienceStore | null = null;

export function getExperienceStore(): ExperienceStore {
    if (!_experienceStore) {
        _experienceStore = new ExperienceStore();
    }
    return _experienceStore;
}

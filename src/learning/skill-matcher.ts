/**
 * Skill Template Matcher — selects relevant pre-built skill templates
 * based on the current task, available tools, and context.
 *
 * Injected into the agent's system prompt so it gets task-appropriate
 * guidance without loading all 150 templates every time.
 */

import { ALL_SKILL_TEMPLATES, SKILL_CATEGORIES, type SkillTemplate, type SkillCategory } from "./skill-templates.js";
import { logDebug } from "../logger.js";

// ─── Keyword Index ───────────────────────────────────────────────────────────
// Maps common task keywords to skill categories for fast matching.

const CATEGORY_KEYWORDS: Record<SkillCategory, string[]> = {
    social_media: [
        "whatsapp", "instagram", "facebook", "twitter", "tiktok", "snapchat",
        "telegram", "youtube", "linkedin", "reddit", "discord", "pinterest",
        "post", "tweet", "story", "reel", "dm", "direct message", "chat",
        "follow", "unfollow", "like", "comment", "share", "subscribe",
        "feed", "timeline", "hashtag", "trending", "social", "message",
        "group chat", "channel", "notification", "react", "mention",
    ],
    business: [
        "email", "gmail", "calendar", "meeting", "schedule", "invoice",
        "payment", "budget", "expense", "report", "client", "customer",
        "vendor", "contract", "proposal", "presentation", "project",
        "deadline", "task", "delegate", "hire", "recruit", "onboard",
        "payroll", "inventory", "shipping", "order", "sales", "lead",
        "crm", "pipeline", "stakeholder", "compliance", "audit",
        "newsletter", "marketing", "campaign", "brand", "revenue",
        "profit", "forecast", "travel", "booking", "flight", "hotel",
        "office", "supply", "training", "performance review",
        "document", "legal", "contract", "partnership", "negotiate",
    ],
    engineering: [
        "debug", "log", "logcat", "error", "crash", "anr", "performance",
        "memory", "cpu", "battery", "storage", "disk", "network", "wifi",
        "bluetooth", "gps", "sensor", "process", "kill", "restart",
        "install", "uninstall", "package", "apk", "permission", "shell",
        "command", "script", "automate", "cron", "monitor", "alert",
        "database", "sqlite", "api", "curl", "proxy", "certificate",
        "backup", "restore", "screenshot", "record", "accessibility",
        "intent", "activity", "service", "broadcast", "content provider",
        "system", "property", "build", "version", "sdk", "kernel",
        "temperature", "thermal", "benchmark", "diagnose", "troubleshoot",
    ],
    personal_assistant: [
        "morning", "routine", "daily", "reminder", "alarm", "wake",
        "briefing", "summary", "weather", "news", "reply", "respond",
        "lookup", "search", "find", "info", "information", "schedule",
        "plan", "organize", "help", "assist", "night", "evening",
        "good morning", "good night",
    ],
    medical_consultant: [
        "medication", "medicine", "pill", "dose", "prescription",
        "doctor", "appointment", "health", "wellness", "checkup",
        "hydration", "exercise", "sleep", "break", "stretch",
    ],
    moral_values: [
        "privacy", "private", "secret", "confidential", "sensitive",
        "honest", "truth", "consent", "permission", "safe", "safety",
        "harmful", "abuse", "harassment", "bully", "scam", "fraud",
        "copyright", "fair", "discriminat", "bias", "child", "minor",
        "manipulat", "deceptive", "ethical", "moral", "responsible",
    ],
};

// ─── Matcher ─────────────────────────────────────────────────────────────────

/**
 * Score how relevant a skill template is to a given task.
 * Returns 0 if not relevant, higher numbers = more relevant.
 */
function scoreTemplate(template: SkillTemplate, taskLower: string): number {
    let score = 0;

    // Name match (strongest signal)
    if (taskLower.includes(template.name.toLowerCase())) {
        score += 10;
    }

    // Description word overlap
    const descWords = template.description.toLowerCase().split(/\s+/);
    for (const word of descWords) {
        if (word.length > 3 && taskLower.includes(word)) {
            score += 2;
        }
    }

    // Instruction keyword overlap (look for any instruction words in task)
    for (const inst of template.instructions) {
        const instWords = inst.toLowerCase().split(/\s+/);
        for (const word of instWords) {
            if (word.length > 4 && taskLower.includes(word)) {
                score += 1;
                break; // one match per instruction is enough
            }
        }
    }

    return score;
}

/**
 * Match skill templates to a task string.
 *
 * Strategy:
 *  1. Find relevant categories via keyword matching
 *  2. Score all templates in those categories
 *  3. Include top N by score
 *  4. Always include moral value templates (ethical guardrails)
 *
 * @param task       The user's task or message
 * @param toolNames  Available tool names (for context-aware matching)
 * @param maxResults Maximum templates to return (default: 8)
 */
export function matchSkillTemplates(
    task: string,
    toolNames: string[] = [],
    maxResults = 8,
): SkillTemplate[] {
    const taskLower = task.toLowerCase();
    const toolsLower = toolNames.map(t => t.toLowerCase());

    // Step 1: Find matching categories
    const categoryScores: Record<string, number> = {};
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        let catScore = 0;
        for (const kw of keywords) {
            if (taskLower.includes(kw)) {
                catScore += kw.length; // longer matches = more specific
            }
        }
        if (catScore > 0) {
            categoryScores[category] = catScore;
        }
    }

    // If event/cron tools available, boost engineering category
    if (toolsLower.some(t => t.includes("cron") || t.includes("event") || t.includes("agenda"))) {
        categoryScores["engineering"] = (categoryScores["engineering"] ?? 0) + 3;
    }

    // Step 2: Get candidate templates from matching categories
    const matchingCategories = Object.keys(categoryScores) as SkillCategory[];

    // If no category matched, use a broad search across all
    const candidates = matchingCategories.length > 0
        ? ALL_SKILL_TEMPLATES.filter(t => matchingCategories.includes(t.category))
        : ALL_SKILL_TEMPLATES;

    // Step 3: Score and rank
    const scored = candidates.map(t => ({
        template: t,
        score: scoreTemplate(t, taskLower),
    }));

    scored.sort((a, b) => b.score - a.score);

    // Take top results (excluding zero scores)
    const topSkills = scored
        .filter(s => s.score > 0)
        .slice(0, maxResults - 2) // reserve 2 slots for moral values
        .map(s => s.template);

    // Step 4: Always include the most relevant moral value templates
    const moralTemplates = ALL_SKILL_TEMPLATES.filter(t => t.category === "moral_values");
    const scoredMorals = moralTemplates.map(t => ({
        template: t,
        score: scoreTemplate(t, taskLower),
    }));
    scoredMorals.sort((a, b) => b.score - a.score);

    // Pick top 2 moral templates (or default core ones)
    const topMorals = scoredMorals.slice(0, 2).map(s => s.template);

    // If no moral templates scored, include Privacy + Honesty as defaults
    if (topMorals.length < 2) {
        const defaults = moralTemplates.filter(t =>
            t.id === "mv_01" || t.id === "mv_02",
        );
        for (const d of defaults) {
            if (!topMorals.some(m => m.id === d.id)) {
                topMorals.push(d);
            }
        }
    }

    // Combine, deduplicate by ID
    const seen = new Set<string>();
    const result: SkillTemplate[] = [];
    for (const t of [...topSkills, ...topMorals]) {
        if (!seen.has(t.id)) {
            seen.add(t.id);
            result.push(t);
        }
    }

    logDebug(`Matched ${result.length} skill templates for task: "${task.slice(0, 60)}..."`);
    return result;
}

// ─── Prompt Formatter ────────────────────────────────────────────────────────

/**
 * Format matched skill templates into a prompt section for the agent.
 */
export function formatSkillTemplatesPrompt(templates: SkillTemplate[]): string {
    if (templates.length === 0) return "";

    const grouped: Record<string, SkillTemplate[]> = {};
    for (const t of templates) {
        const catName = SKILL_CATEGORIES[t.category] ?? t.category;
        if (!grouped[catName]) grouped[catName] = [];
        grouped[catName].push(t);
    }

    let prompt = "## Skill Templates — Use These For This Task\n";
    prompt += "Follow these proven instructions when executing the task:\n\n";

    for (const [category, skills] of Object.entries(grouped)) {
        prompt += `### ${category}\n`;
        for (const skill of skills) {
            prompt += `**${skill.name}**: ${skill.description}\n`;
            for (const inst of skill.instructions.slice(0, 4)) { // limit per skill
                prompt += `- ${inst}\n`;
            }
            if (skill.sampleWorkflow) {
                prompt += `- Workflow: ${skill.sampleWorkflow.steps.join(" → ")}\n`;
            }
            prompt += "\n";
        }
    }

    return prompt;
}

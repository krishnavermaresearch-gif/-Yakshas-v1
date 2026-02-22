/**
 * Auto Skill Generator — when the agent successfully completes a task
 * for an app, it saves the learned workflow as a skill/plugin file.
 *
 * These auto-generated skills make the agent faster on similar future tasks
 * by providing app-specific instructions and proven tool sequences.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { logDebug, logInfo, logWarn } from "../logger.js";
import type { ToolStep, Experience } from "./experience-store.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AppSkill = {
    appName: string;
    packageName: string;
    /** Learned instructions for this app */
    instructions: string[];
    /** Proven workflows (task → steps) */
    workflows: AppWorkflow[];
    /** Number of successful interactions */
    successCount: number;
    lastUpdated: number;
};

export type AppWorkflow = {
    task: string;
    steps: string[];      // Human-readable step descriptions
    toolSequence: string[]; // Tool names in order
    reward: number;
    learnedAt: number;
};

// ─── Skill Generator ────────────────────────────────────────────────────────

export class SkillGenerator {
    private skills: Map<string, AppSkill> = new Map();
    private readonly skillsDir: string;

    constructor(skillsDir?: string) {
        this.skillsDir = skillsDir ?? resolve(process.cwd(), "data", "skills");
        this.loadAll();
    }

    /**
     * Learn from a completed experience.
     * If reward is high enough, save the workflow as a skill.
     */
    learnFromExperience(experience: Experience): void {
        if (experience.reward < 0.3) return; // Only learn from good outcomes

        // Detect which app was used
        const appInfo = this.detectApp(experience.steps);
        if (!appInfo) return;

        const skill = this.getOrCreateSkill(appInfo.name, appInfo.packageName);

        // Create workflow from the experience
        const workflow: AppWorkflow = {
            task: experience.task,
            steps: this.stepsToReadable(experience.steps),
            toolSequence: experience.steps.map((s) => s.tool),
            reward: experience.reward,
            learnedAt: Date.now(),
        };

        // Add workflow (avoid duplicates)
        const isDuplicate = skill.workflows.some(
            (w) => w.task.toLowerCase() === workflow.task.toLowerCase(),
        );

        if (!isDuplicate) {
            skill.workflows.push(workflow);
            // Keep only the best 10 workflows per app
            skill.workflows.sort((a, b) => b.reward - a.reward);
            if (skill.workflows.length > 10) {
                skill.workflows = skill.workflows.slice(0, 10);
            }
        }

        // Extract and learn app-specific instructions
        const newInstructions = this.extractInstructions(experience);
        for (const inst of newInstructions) {
            if (!skill.instructions.includes(inst)) {
                skill.instructions.push(inst);
            }
        }
        // Keep instructions manageable
        if (skill.instructions.length > 20) {
            skill.instructions = skill.instructions.slice(-20);
        }

        skill.successCount++;
        skill.lastUpdated = Date.now();

        this.saveSkill(skill);
        logInfo(`Skill updated: ${appInfo.name} (${skill.workflows.length} workflows, ${skill.instructions.length} instructions)`);
    }

    /**
     * Get skill instructions for the system prompt.
     */
    getSkillPrompt(appPackage?: string): string {
        const parts: string[] = [];

        for (const skill of this.skills.values()) {
            // If appPackage specified, only include that app's skills
            if (appPackage && skill.packageName !== appPackage) continue;

            if (skill.instructions.length === 0 && skill.workflows.length === 0) continue;

            let section = `### Learned: ${skill.appName} (${skill.packageName})\n`;
            section += `Mastery: ${skill.successCount} successful interactions\n`;

            if (skill.instructions.length > 0) {
                section += `\nKey learnings:\n${skill.instructions.map((i) => `- ${i}`).join("\n")}\n`;
            }

            if (skill.workflows.length > 0) {
                const topWorkflows = skill.workflows.slice(0, 3);
                section += `\nProven workflows:\n`;
                for (const wf of topWorkflows) {
                    section += `- "${wf.task}": ${wf.steps.slice(0, 5).join(" → ")}\n`;
                }
            }

            parts.push(section);
        }

        if (parts.length === 0) return "";
        return `## Auto-Learned App Skills\n${parts.join("\n")}`;
    }

    /** Get all known app names. */
    getKnownApps(): string[] {
        return Array.from(this.skills.values())
            .filter((s) => s.successCount > 0)
            .map((s) => `${s.appName} (${s.successCount} tasks)`);
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    private detectApp(steps: ToolStep[]): { name: string; packageName: string } | null {
        for (const step of steps) {
            if (step.tool === "adb_app_launch" && typeof step.args.package === "string") {
                const pkg = step.args.package;
                const name = this.packageToName(pkg);
                return { name, packageName: pkg };
            }
        }
        return null;
    }

    private packageToName(pkg: string): string {
        const knownApps: Record<string, string> = {
            "com.whatsapp": "WhatsApp",
            "com.instagram.android": "Instagram",
            "com.google.android.youtube": "YouTube",
            "com.google.android.gm": "Gmail",
            "com.google.android.apps.maps": "Google Maps",
            "com.android.chrome": "Chrome",
            "com.google.android.apps.photos": "Google Photos",
            "com.spotify.music": "Spotify",
            "com.twitter.android": "Twitter/X",
            "com.facebook.katana": "Facebook",
            "org.telegram.messenger": "Telegram",
            "com.snapchat.android": "Snapchat",
        };

        if (knownApps[pkg]) return knownApps[pkg];

        // Try to extract a readable name from package
        const parts = pkg.split(".");
        return parts[parts.length - 1]?.charAt(0).toUpperCase() + (parts[parts.length - 1]?.slice(1) ?? "");
    }

    private stepsToReadable(steps: ToolStep[]): string[] {
        return steps.slice(0, 10).map((step) => {
            switch (step.tool) {
                case "adb_tap": return `Tap at (${step.args.x}, ${step.args.y})`;
                case "adb_type": return `Type "${String(step.args.text).slice(0, 30)}"`;
                case "adb_key": return `Press ${step.args.key}`;
                case "adb_swipe": return `Swipe from (${step.args.x1},${step.args.y1}) to (${step.args.x2},${step.args.y2})`;
                case "adb_app_launch": return `Open ${step.args.package}`;
                case "adb_ui_tree": return "Read screen UI";
                case "adb_screenshot": return "Take screenshot";
                case "adb_shell": return `Run: ${String(step.args.command).slice(0, 40)}`;
                default: return `${step.tool}(${JSON.stringify(step.args).slice(0, 40)})`;
            }
        });
    }

    private extractInstructions(exp: Experience): string[] {
        const instructions: string[] = [];

        // Learn from successful tool patterns
        const toolSeq = exp.steps.map((s) => s.tool);

        // If screenshot was used after ui_tree, note that ui_tree alone wasn't enough
        if (toolSeq.includes("adb_screenshot") && toolSeq.includes("adb_ui_tree")) {
            instructions.push("Screenshots help when UI tree is unclear");
        }

        // If many taps were used, the app has complex navigation
        const tapCount = toolSeq.filter((t) => t === "adb_tap").length;
        if (tapCount > 5) {
            instructions.push(`This app requires multiple taps to navigate (${tapCount} taps needed)`);
        }

        // If swipes were used, content is scrollable
        if (toolSeq.includes("adb_swipe")) {
            instructions.push("Content may require scrolling to find");
        }

        return instructions;
    }

    private getOrCreateSkill(appName: string, packageName: string): AppSkill {
        if (this.skills.has(packageName)) return this.skills.get(packageName)!;

        const skill: AppSkill = {
            appName,
            packageName,
            instructions: [],
            workflows: [],
            successCount: 0,
            lastUpdated: Date.now(),
        };
        this.skills.set(packageName, skill);
        return skill;
    }

    // ── Persistence ──────────────────────────────────────────────────────────

    private saveSkill(skill: AppSkill): void {
        try {
            if (!existsSync(this.skillsDir)) mkdirSync(this.skillsDir, { recursive: true });

            const filePath = join(this.skillsDir, `${skill.packageName.replace(/\./g, "_")}.json`);
            writeFileSync(filePath, JSON.stringify(skill, null, 2), "utf-8");
        } catch (err) {
            logWarn(`Failed to save skill: ${err instanceof Error ? err.message : err}`);
        }
    }

    private loadAll(): void {
        if (!existsSync(this.skillsDir)) return;

        try {
            const fs = require("node:fs");
            const files = fs.readdirSync(this.skillsDir) as string[];
            for (const file of files) {
                if (!file.endsWith(".json")) continue;
                try {
                    const raw = readFileSync(join(this.skillsDir, file), "utf-8");
                    const skill = JSON.parse(raw) as AppSkill;
                    this.skills.set(skill.packageName, skill);
                } catch {
                    // Skip corrupt skill files
                }
            }

            if (this.skills.size > 0) {
                logInfo(`Loaded ${this.skills.size} app skills`);
            }
        } catch (err) {
            logDebug(`Failed to load skills: ${err instanceof Error ? err.message : err}`);
        }
    }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _skillGen: SkillGenerator | null = null;

export function getSkillGenerator(): SkillGenerator {
    if (!_skillGen) {
        _skillGen = new SkillGenerator();
    }
    return _skillGen;
}

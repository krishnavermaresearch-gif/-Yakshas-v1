/**
 * Soul Tools — agent tools for the Digital Soul system.
 *
 * Exposes the Digital Soul to the agent as callable tools:
 *  - soul_observe_start / soul_observe_stop — control passive observation
 *  - soul_status — view soul maturity + stats
 *  - soul_predict — ask "what would the user do?"
 *  - soul_style — get communication style for a contact
 *  - soul_build — rebuild the soul profile from latest data
 */

import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";
import { getPassiveObserver } from "./passive-observer.js";
import { getSoulProfileBuilder } from "./soul-profile.js";
import { getCommunicationAnalyzer } from "./communication-analyzer.js";

const ok = (text: string): ToolResult => ({ type: "text", content: text });

const soulObserveStart: ToolDefinition = {
    name: "soul_observe_start",
    description: "Start the passive observation system. This silently records which apps the user opens, when, and for how long. Required for building the Digital Soul.",
    parameters: {
        type: "object",
        properties: {
            interval_seconds: {
                type: "number",
                description: "How often to observe (default: 30 seconds)",
            },
            capture_screenshots: {
                type: "boolean",
                description: "Whether to capture screenshots (uses more storage)",
            },
        },
        required: [],
    },
    execute: async (): Promise<ToolResult> => {
        const observer = getPassiveObserver();
        if (observer.isRunning()) {
            return ok("Passive observer is already running.");
        }
        observer.start();
        return ok("👁️ Passive observer started. I'm now silently learning the user's phone habits. Use soul_build to generate a soul profile after collecting data.");
    },
};

const soulObserveStop: ToolDefinition = {
    name: "soul_observe_stop",
    description: "Stop the passive observation system and save collected data.",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (): Promise<ToolResult> => {
        const observer = getPassiveObserver();
        if (!observer.isRunning()) {
            return ok("Passive observer is not running.");
        }
        observer.stop();
        return ok("👁️ Passive observer stopped. Data saved.");
    },
};

const soulStatus: ToolDefinition = {
    name: "soul_status",
    description: "Get the current status of the Digital Soul — maturity level, data volume, key traits.",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (): Promise<ToolResult> => {
        const builder = getSoulProfileBuilder();
        const soul = builder.loadExistingSoul();

        if (!soul) {
            const observer = getPassiveObserver();
            return ok(JSON.stringify({
                status: "No soul exists yet",
                observerRunning: observer.isRunning(),
                observerStats: observer.getStats(),
                hint: "Start observation with soul_observe_start, collect data, then use soul_build",
            }, null, 2));
        }

        return ok(JSON.stringify({
            name: soul.name,
            maturity: soul.maturityLevel,
            observationDays: soul.observationDays,
            personality: soul.personalitySummary,
            communicationStyle: soul.communicationStyle,
            dailyRhythm: soul.dailyRhythm,
            traits: soul.traits.map(t => `${t.name}: ${Math.round(t.value * 100)}%`),
            updatedAt: new Date(soul.updatedAt).toISOString(),
        }, null, 2));
    },
};

const soulBuild: ToolDefinition = {
    name: "soul_build",
    description: "Build or rebuild the Digital Soul profile from all collected behavioral data.",
    parameters: {
        type: "object",
        properties: {
            name: {
                type: "string",
                description: "Name for the soul profile (e.g., the user's name)",
            },
        },
        required: ["name"],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const name = args.name as string;
        const builder = getSoulProfileBuilder();
        const soul = builder.build(name);

        return ok(JSON.stringify({
            name: soul.name,
            maturity: soul.maturityLevel,
            personality: soul.personalitySummary,
            traits: soul.traits.map(t => ({
                name: t.name,
                value: `${Math.round(t.value * 100)}%`,
                evidence: t.evidence,
            })),
            communicationStyle: soul.communicationStyle,
            dailyRhythm: soul.dailyRhythm,
            routines: soul.behavioralProfile?.routines.length ?? 0,
            triggerPatterns: soul.behavioralProfile?.triggerActions.length ?? 0,
        }, null, 2));
    },
};

const soulPredict: ToolDefinition = {
    name: "soul_predict",
    description: "Ask the Digital Soul a question about how the user would behave. Examples: 'What would they do first in the morning?', 'How would they respond to this message?'",
    parameters: {
        type: "object",
        properties: {
            question: {
                type: "string",
                description: "Question about the user's behavior or preferences",
            },
        },
        required: ["question"],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const question = args.question as string;
        const builder = getSoulProfileBuilder();
        const soul = builder.loadExistingSoul();

        if (!soul) {
            return ok("No Digital Soul exists yet. Use soul_build first.");
        }

        const prediction = builder.predict(soul, question);
        return ok(JSON.stringify(prediction, null, 2));
    },
};

const soulStyle: ToolDefinition = {
    name: "soul_style",
    description: "Get the user's communication style for a specific contact — response time, formality, emoji usage, message length.",
    parameters: {
        type: "object",
        properties: {
            contact: {
                type: "string",
                description: "Contact name to get communication style for",
            },
        },
        required: ["contact"],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const contact = args.contact as string;
        const analyzer = getCommunicationAnalyzer();
        const prediction = analyzer.predictResponseStyle(contact);

        return ok(JSON.stringify({ contact, ...prediction }, null, 2));
    },
};

export const soulTools: ToolDefinition[] = [
    soulObserveStart,
    soulObserveStop,
    soulStatus,
    soulBuild,
    soulPredict,
    soulStyle,
];

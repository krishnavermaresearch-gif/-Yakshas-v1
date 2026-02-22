/**
 * Google Forms API tools.
 * Read form structure and responses.
 */
import { simpleGet } from "./api-client.js";
import type { ToolDefinition } from "../agent/tool-registry.js";

const BASE = "https://forms.googleapis.com/v1";

export const formsTools: ToolDefinition[] = [
    {
        name: "forms_read",
        description: "Read a Google Form's structure (questions, options).",
        parameters: {
            type: "object",
            properties: {
                formId: { type: "string", description: "Form ID (from the form URL)" },
            },
            required: ["formId"],
        },
        execute: async (args) => {
            try {
                const form = await simpleGet(`${BASE}/forms/${args.formId}`);
                const lines = [`📝 **${form.info?.title ?? "Untitled Form"}**`];
                if (form.info?.description) lines.push(form.info.description);
                lines.push("");
                if (form.items?.length) {
                    for (const item of form.items) {
                        const q = item.questionItem?.question;
                        if (item.title) lines.push(`**Q:** ${item.title}${q?.required ? " *(required)*" : ""}`);
                        if (q?.choiceQuestion?.options) {
                            for (const opt of q.choiceQuestion.options) lines.push(`  - ${opt.value}`);
                        }
                    }
                }
                return { type: "text", content: lines.join("\n") };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
    {
        name: "forms_responses",
        description: "Get responses/answers submitted to a Google Form.",
        parameters: {
            type: "object",
            properties: {
                formId: { type: "string", description: "Form ID" },
                maxResults: { type: "string", description: "Max responses (default 20)" },
            },
            required: ["formId"],
        },
        execute: async (args) => {
            try {
                const data = await simpleGet(`${BASE}/forms/${args.formId}/responses`);
                if (!data.responses?.length) return { type: "text", content: "No responses yet." };
                const count = data.responses.length;
                const lines = [`📊 ${count} response(s):\n`];
                const max = Math.min(count, parseInt(String(args.maxResults ?? "20")));
                for (let i = 0; i < max; i++) {
                    const r = data.responses[i];
                    lines.push(`**Response ${i + 1}** (${new Date(r.lastSubmittedTime).toLocaleString()}):`);
                    if (r.answers) {
                        for (const [qId, ans] of Object.entries(r.answers as Record<string, any>)) {
                            const texts = ans.textAnswers?.answers?.map((a: any) => a.value).join(", ");
                            lines.push(`  ${qId}: ${texts ?? "N/A"}`);
                        }
                    }
                }
                return { type: "text", content: lines.join("\n") };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
    {
        name: "forms_response_count",
        description: "Get the total number of responses for a form.",
        parameters: {
            type: "object",
            properties: {
                formId: { type: "string", description: "Form ID" },
            },
            required: ["formId"],
        },
        execute: async (args) => {
            try {
                const data = await simpleGet(`${BASE}/forms/${args.formId}/responses`);
                const count = data.responses?.length ?? 0;
                return { type: "text", content: `📊 Total responses: ${count}` };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
];

/**
 * Google Slides API tools.
 * Read and create presentations.
 */
import { simpleGet, simplePost } from "./api-client.js";
import type { ToolDefinition } from "../agent/tool-registry.js";

const BASE = "https://slides.googleapis.com/v1/presentations";

export const slidesTools: ToolDefinition[] = [
    {
        name: "slides_read",
        description: "Read content of a Google Slides presentation.",
        parameters: {
            type: "object",
            properties: {
                presentationId: { type: "string", description: "Presentation ID (from URL)" },
            },
            required: ["presentationId"],
        },
        execute: async (args) => {
            try {
                const pres = await simpleGet(`${BASE}/${args.presentationId}`);
                const lines = [`📊 **${pres.title ?? "Untitled"}** (${pres.slides?.length ?? 0} slides)\n`];
                if (pres.slides) {
                    for (let i = 0; i < pres.slides.length; i++) {
                        const slide = pres.slides[i];
                        const texts: string[] = [];
                        if (slide.pageElements) {
                            for (const el of slide.pageElements) {
                                if (el.shape?.text?.textElements) {
                                    for (const te of el.shape.text.textElements) {
                                        if (te.textRun?.content?.trim()) texts.push(te.textRun.content.trim());
                                    }
                                }
                            }
                        }
                        lines.push(`**Slide ${i + 1}:** ${texts.join(" | ") || "(no text)"}`);
                    }
                }
                return { type: "text", content: lines.join("\n") };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
    {
        name: "slides_create",
        description: "Create a new Google Slides presentation.",
        parameters: {
            type: "object",
            properties: {
                title: { type: "string", description: "Presentation title" },
            },
            required: ["title"],
        },
        execute: async (args) => {
            try {
                const pres = await simplePost(BASE, { title: String(args.title) });
                return {
                    type: "text",
                    content: `✅ Presentation created: "${pres.title}"\nURL: https://docs.google.com/presentation/d/${pres.presentationId}/edit`,
                };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
    {
        name: "slides_add_slide",
        description: "Add a new blank slide to an existing presentation.",
        parameters: {
            type: "object",
            properties: {
                presentationId: { type: "string", description: "Presentation ID" },
                layout: { type: "string", description: "Layout: BLANK, TITLE, TITLE_AND_BODY", enum: ["BLANK", "TITLE", "TITLE_AND_BODY"] },
            },
            required: ["presentationId"],
        },
        execute: async (args) => {
            try {
                const layout = String(args.layout ?? "BLANK");
                await simplePost(`${BASE}/${args.presentationId}:batchUpdate`, {
                    requests: [{ createSlide: { slideLayoutReference: { predefinedLayout: layout } } }],
                });
                return { type: "text", content: `✅ New ${layout} slide added.` };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
];

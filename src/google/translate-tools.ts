/**
 * Google Cloud Translation API tools.
 * Translate text and detect languages.
 */
import { simplePost } from "./api-client.js";
import type { ToolDefinition } from "../agent/tool-registry.js";

const BASE = "https://translation.googleapis.com/language/translate/v2";

export const translateTools: ToolDefinition[] = [
    {
        name: "translate_text",
        description: "Translate text to a target language using Google Translate.",
        parameters: {
            type: "object",
            properties: {
                text: { type: "string", description: "Text to translate" },
                target: { type: "string", description: "Target language code (e.g. en, es, fr, hi, de, ja, ko, zh)" },
                source: { type: "string", description: "Source language code (auto-detected if not specified)" },
            },
            required: ["text", "target"],
        },
        execute: async (args) => {
            try {
                const body: any = { q: String(args.text), target: String(args.target), format: "text" };
                if (args.source) body.source = String(args.source);
                const data = await simplePost(BASE, body);
                const translations = data.data?.translations;
                if (!translations?.length) return { type: "text", content: "Translation failed." };
                const t = translations[0];
                return { type: "text", content: `🌐 Translation (${t.detectedSourceLanguage ?? args.source} → ${args.target}):\n\n${t.translatedText}` };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
    {
        name: "translate_detect",
        description: "Detect the language of a text.",
        parameters: {
            type: "object",
            properties: {
                text: { type: "string", description: "Text to detect language for" },
            },
            required: ["text"],
        },
        execute: async (args) => {
            try {
                const data = await simplePost(`${BASE}/detect`, { q: String(args.text) });
                const detections = data.data?.detections;
                if (!detections?.length) return { type: "text", content: "Could not detect language." };
                const d = detections[0][0];
                return { type: "text", content: `🌐 Detected language: ${d.language} (confidence: ${(d.confidence * 100).toFixed(1)}%)` };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
];

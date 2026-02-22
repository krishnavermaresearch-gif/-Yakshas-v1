/**
 * VLM Explorer — uses Vision-Language Model to visually find UI elements
 * when standard selectors fail.
 *
 * This is the "last resort" in the adaptive finder chain.
 * It takes a screenshot, asks the VLM "where is the Settings button?",
 * and returns bounding box coordinates.
 */

import { logInfo, logDebug } from "../logger.js";
import { getLLMProvider } from "../llm/provider-factory.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VLMFindResult {
    found: boolean;
    /** Estimated center coordinates */
    coordinates?: { x: number; y: number };
    /** Confidence 0-1 */
    confidence: number;
    /** What the VLM said */
    description: string;
}

// ─── Explorer ────────────────────────────────────────────────────────────────

export class VLMExplorer {
    /**
     * Use VLM to find a UI element in a screenshot.
     *
     * @param screenshotBase64 - Base64 encoded screenshot PNG
     * @param elementDescription - What to look for (e.g., "Settings icon", "Send button")
     * @param screenWidth - Screen width in pixels
     * @param screenHeight - Screen height in pixels
     */
    async findElement(
        screenshotBase64: string,
        elementDescription: string,
        screenWidth: number = 1080,
        screenHeight: number = 2400,
    ): Promise<VLMFindResult> {
        const llm = getLLMProvider();

        try {
            logDebug(`VLM Explorer: looking for "${elementDescription}"`);

            const response = await llm.chat([
                {
                    role: "system",
                    content:
                        "You are a UI element locator. The user will show you a phone screenshot and ask you to find a specific element. " +
                        "Respond in JSON format: {\"found\": true/false, \"x\": <number 0-100 percentage from left>, " +
                        "\"y\": <number 0-100 percentage from top>, \"confidence\": <0-1>, \"description\": \"what you see\"}. " +
                        "x and y should be percentage positions (0-100) of the element's CENTER. " +
                        "If you cannot find the element, set found=false.",
                },
                {
                    role: "user",
                    content: `Find this UI element in the screenshot: "${elementDescription}"`,
                    images: [screenshotBase64],
                },
            ]);

            const text = response.message.content ?? "";

            // Parse JSON from response
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                return { found: false, confidence: 0, description: "Failed to parse VLM response" };
            }

            const data = JSON.parse(jsonMatch[0]) as {
                found: boolean;
                x?: number;
                y?: number;
                confidence?: number;
                description?: string;
            };

            if (data.found && data.x !== undefined && data.y !== undefined) {
                const coordinates = {
                    x: Math.round((data.x / 100) * screenWidth),
                    y: Math.round((data.y / 100) * screenHeight),
                };

                logInfo(`VLM Explorer: found "${elementDescription}" at (${coordinates.x}, ${coordinates.y}) ` +
                    `confidence=${(data.confidence ?? 0.5).toFixed(2)}`);

                return {
                    found: true,
                    coordinates,
                    confidence: data.confidence ?? 0.5,
                    description: data.description ?? "",
                };
            }

            return { found: false, confidence: 0, description: data.description ?? "Element not found" };
        } catch (err) {
            logDebug(`VLM Explorer failed: ${err instanceof Error ? err.message : err}`);
            return { found: false, confidence: 0, description: `VLM error: ${err instanceof Error ? err.message : err}` };
        }
    }

    /**
     * Describe what's on screen — useful for understanding unknown app states.
     */
    async describeScreen(screenshotBase64: string): Promise<string> {
        const llm = getLLMProvider();

        try {
            const response = await llm.chat([
                {
                    role: "system",
                    content: "You are a phone screen analyzer. Describe what you see on the screen, including the app name, visible buttons, text fields, and overall layout. Be concise (max 100 words).",
                },
                {
                    role: "user",
                    content: "Describe this phone screen:",
                    images: [screenshotBase64],
                },
            ]);

            return response.message.content ?? "(no description)";
        } catch (err) {
            return `(VLM error: ${err instanceof Error ? err.message : err})`;
        }
    }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _explorer: VLMExplorer | null = null;

export function getVLMExplorer(): VLMExplorer {
    if (!_explorer) _explorer = new VLMExplorer();
    return _explorer;
}

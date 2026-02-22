import sharp from "sharp";
import { getAdb } from "../adb/connection.js";
import { logInfo } from "../logger.js";
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";

/**
 * Screenshot tool — captures the phone screen as PNG.
 * Optionally downscales for smaller token usage with vision models.
 */
export const screenshotTool: ToolDefinition = {
    name: "adb_screenshot",
    description:
        "Capture the current phone screen as an image. Returns a PNG screenshot. " +
        "Use this to see what is currently displayed on the phone screen.",
    parameters: {
        type: "object" as const,
        properties: {
            max_width: {
                type: "number",
                description:
                    "Maximum width in pixels to resize the screenshot to (default: 720). " +
                    "Lower values save bandwidth/tokens.",
            },
        },
        required: [],
    },
    execute: screenshotExecute,
};

async function screenshotExecute(
    args: Record<string, unknown>,
): Promise<ToolResult> {
    const adb = getAdb();
    const maxWidth = typeof args.max_width === "number" ? args.max_width : 720;

    try {
        const rawPng = await adb.screencap();

        // Downscale for efficient transfer and token usage
        const resized = await sharp(rawPng)
            .resize({ width: maxWidth, withoutEnlargement: true })
            .png({ quality: 80, compressionLevel: 6 })
            .toBuffer();

        const base64 = resized.toString("base64");
        const sizeKB = Math.round(resized.length / 1024);
        logInfo(`Screenshot captured: ${sizeKB}KB (resized to max ${maxWidth}px wide)`);

        return {
            type: "image",
            content: `Screenshot captured successfully (${sizeKB}KB).`,
            image: {
                base64,
                mimeType: "image/png",
            },
            buffer: resized,
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            type: "text",
            content: `Screenshot failed: ${message}`,
        };
    }
}

/**
 * Take a screenshot and return as a Buffer (internal use).
 */
export async function captureScreenshotBuffer(maxWidth: number = 720): Promise<Buffer> {
    const adb = getAdb();
    const rawPng = await adb.screencap();
    return sharp(rawPng)
        .resize({ width: maxWidth, withoutEnlargement: true })
        .png({ quality: 80, compressionLevel: 6 })
        .toBuffer();
}

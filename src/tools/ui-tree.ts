import { getAdb } from "../adb/connection.js";
import { logDebug, logInfo, logWarn } from "../logger.js";
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type UiElement = {
    index: number;
    className: string;
    text: string;
    contentDesc: string;
    resourceId: string;
    bounds: { x1: number; y1: number; x2: number; y2: number };
    center: { x: number; y: number };
    clickable: boolean;
    focusable: boolean;
    scrollable: boolean;
    enabled: boolean;
    checked: boolean;
    selected: boolean;
    package: string;
};

// ─── Tool Definition ─────────────────────────────────────────────────────────

export const uiTreeTool: ToolDefinition = {
    name: "adb_ui_tree",
    description:
        "Get the current UI element tree of the phone screen. Returns a structured list " +
        "of all visible UI elements with their text, position (bounds), and properties. " +
        "Use this to understand what is on screen and find elements to tap. " +
        "Each element has an [index] you can reference, and bounds for tap coordinates.",
    parameters: {
        type: "object" as const,
        properties: {
            max_elements: {
                type: "number",
                description: "Maximum number of elements to return (default: 100)",
            },
        },
        required: [],
    },
    execute: uiTreeExecute,
};

// ─── Execution ───────────────────────────────────────────────────────────────

async function uiTreeExecute(
    args: Record<string, unknown>,
): Promise<ToolResult> {
    const maxElements = typeof args.max_elements === "number" ? args.max_elements : 100;

    try {
        const elements = await dumpUiTree();
        const limited = elements.slice(0, maxElements);
        const formatted = formatUiTree(limited);

        logInfo(`UI tree: ${elements.length} elements found, returning ${limited.length}`);

        return {
            type: "text",
            content:
                `UI Tree (${limited.length} of ${elements.length} elements):\n\n${formatted}\n\n` +
                `Tip: Use adb_tap with the center coordinates to interact with an element. ` +
                `Bounds format: [x1,y1][x2,y2], center is the midpoint.`,
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            type: "text",
            content: `UI tree dump failed: ${message}. Try taking a screenshot instead.`,
        };
    }
}

// ─── XML Parsing ─────────────────────────────────────────────────────────────

/**
 * Dump and parse the UI accessibility tree via uiautomator.
 * This is the primary way the AI "sees" the phone screen structure.
 */
export async function dumpUiTree(): Promise<UiElement[]> {
    const adb = getAdb();

    let xml = "";

    // Method 1: dump to file (most reliable, especially over wireless ADB)
    try {
        await adb.shell("uiautomator dump /sdcard/window_dump.xml", {
            timeoutMs: 15_000,
        });
        // Read the dump file — use maxBuffer for large UI trees
        const result = await adb.shell("cat /sdcard/window_dump.xml", {
            maxBuffer: 20 * 1024 * 1024,
        });
        xml = result.stdout;
        // Cleanup
        adb.shell("rm -f /sdcard/window_dump.xml").catch(() => { });
    } catch (err1) {
        logDebug("File-based dump failed, trying /dev/tty");

        // Method 2: dump to stdout (faster but unreliable on some devices)
        try {
            const result = await adb.shell("uiautomator dump /dev/tty", {
                timeoutMs: 15_000,
                maxBuffer: 20 * 1024 * 1024,
            });
            xml = result.stdout;
        } catch (err2) {
            logWarn("Both UI dump methods failed");
            return [];
        }
    }

    // Clean up any extraneous output — the XML starts with <?xml or <hierarchy
    const xmlStart = xml.indexOf("<?xml");
    const hierarchyStart = xml.indexOf("<hierarchy");
    const startIdx = xmlStart >= 0 ? xmlStart : hierarchyStart;

    if (startIdx > 0) {
        xml = xml.slice(startIdx);
    }

    if (!xml || !xml.includes("<node")) {
        logWarn("UI dump returned no nodes");
        return [];
    }

    return parseUiXml(xml);
}

/**
 * Parse uiautomator XML into structured elements.
 * Uses regex parsing (no XML library needed — uiautomator output is simple enough).
 */
function parseUiXml(xml: string): UiElement[] {
    const elements: UiElement[] = [];
    const nodeRegex = /<node\s+([^>]+)\/?>/g;
    let match: RegExpExecArray | null;
    let index = 0;

    while ((match = nodeRegex.exec(xml)) !== null) {
        const attrs = match[1]!;
        const el = parseNodeAttributes(attrs, index);
        if (el) {
            elements.push(el);
            index++;
        }
    }

    return elements;
}

function parseNodeAttributes(attrs: string, index: number): UiElement | null {
    const get = (name: string): string => {
        const regex = new RegExp(`${name}="([^"]*)"`, "i");
        const m = attrs.match(regex);
        return m?.[1] ?? "";
    };

    const boundsStr = get("bounds");
    const boundsMatch = boundsStr.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!boundsMatch) return null;

    const x1 = Number(boundsMatch[1]);
    const y1 = Number(boundsMatch[2]);
    const x2 = Number(boundsMatch[3]);
    const y2 = Number(boundsMatch[4]);

    // Skip invisible elements (zero-size bounds)
    if (x1 >= x2 || y1 >= y2) return null;

    const text = get("text");
    const contentDesc = get("content-desc");
    const resourceId = get("resource-id");
    const className = get("class");

    // Skip elements with no useful information
    const hasContent = text || contentDesc || resourceId ||
        get("clickable") === "true" || get("focusable") === "true";
    if (!hasContent) return null;

    return {
        index,
        className: className.split(".").pop() ?? className,
        text,
        contentDesc,
        resourceId: resourceId.split("/").pop() ?? resourceId,
        bounds: { x1, y1, x2, y2 },
        center: {
            x: Math.round((x1 + x2) / 2),
            y: Math.round((y1 + y2) / 2),
        },
        clickable: get("clickable") === "true",
        focusable: get("focusable") === "true",
        scrollable: get("scrollable") === "true",
        enabled: get("enabled") !== "false",
        checked: get("checked") === "true",
        selected: get("selected") === "true",
        package: get("package"),
    };
}

// ─── Formatting ──────────────────────────────────────────────────────────────

/**
 * Format UI elements into a readable text list for the AI.
 * Mimics the ARIA snapshot format used in OpenClaw's browser tool.
 */
function formatUiTree(elements: UiElement[]): string {
    return elements
        .map((el) => {
            const parts: string[] = [];

            // [index] ClassName
            parts.push(`[${el.index}] ${el.className}`);

            // "text" or (content-desc)
            if (el.text) parts.push(`"${el.text}"`);
            if (el.contentDesc) parts.push(`(${el.contentDesc})`);
            if (el.resourceId) parts.push(`id=${el.resourceId}`);

            // Bounds and center
            parts.push(
                `bounds=[${el.bounds.x1},${el.bounds.y1}][${el.bounds.x2},${el.bounds.y2}]`,
            );
            parts.push(`center=(${el.center.x},${el.center.y})`);

            // Flags
            const flags: string[] = [];
            if (el.clickable) flags.push("clickable");
            if (el.focusable) flags.push("focusable");
            if (el.scrollable) flags.push("scrollable");
            if (el.checked) flags.push("checked");
            if (el.selected) flags.push("selected");
            if (!el.enabled) flags.push("disabled");
            if (flags.length > 0) parts.push(flags.join(","));

            return parts.join(" ");
        })
        .join("\n");
}

export { formatUiTree };

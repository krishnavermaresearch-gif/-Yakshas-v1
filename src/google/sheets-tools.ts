/**
 * Google Sheets Tools — read, write, and create spreadsheets.
 */

import { googleGet, googlePost, googlePatch, requireGoogleAuth } from "./api-client.js";
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

// ─── Types ───────────────────────────────────────────────────────────────────

type SheetValues = { values?: string[][] };

function formatTable(values: string[][]): string {
    if (!values.length) return "(empty)";
    const widths = values[0].map((_, col) =>
        Math.max(...values.map(row => (row[col] ?? "").length))
    );
    return values.map(row =>
        row.map((cell, i) => (cell ?? "").padEnd(widths[i] ?? 0)).join(" | ")
    ).join("\n");
}

// ─── Tools ───────────────────────────────────────────────────────────────────

export const sheetsTools: ToolDefinition[] = [
    {
        name: "sheets_read",
        description: "Read data from a Google Sheet. Returns cell values as a table.",
        parameters: {
            type: "object" as const,
            properties: {
                spreadsheet_id: { type: "string", description: "The spreadsheet ID (from drive_search)" },
                range: { type: "string", description: "Cell range, e.g. 'Sheet1!A1:D10' or 'A:D' (default: first 50 rows)" },
            },
            required: ["spreadsheet_id"],
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            const authErr = requireGoogleAuth();
            if (authErr) return { type: "text", content: authErr };

            const range = (args.range as string) ?? "A1:Z50";
            const res = await googleGet<SheetValues>(
                `${SHEETS_BASE}/${args.spreadsheet_id}/values/${encodeURIComponent(range)}`
            );
            if (!res.ok) return { type: "text", content: `Sheets error: ${res.error}` };
            if (!res.data.values?.length) return { type: "text", content: "Sheet is empty." };

            const table = formatTable(res.data.values);
            return { type: "text", content: `📊 Sheet data (${res.data.values.length} rows):\n\n${table}` };
        },
    },
    {
        name: "sheets_write",
        description: "Write data to a Google Sheet. Overwrites existing data in the specified range.",
        parameters: {
            type: "object" as const,
            properties: {
                spreadsheet_id: { type: "string", description: "The spreadsheet ID" },
                range: { type: "string", description: "Target range, e.g. 'Sheet1!A1'" },
                values: { type: "string", description: "Data as JSON array of arrays, e.g. '[[\"Name\",\"Age\"],[\"Alice\",\"30\"]]'" },
            },
            required: ["spreadsheet_id", "range", "values"],
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            const authErr = requireGoogleAuth();
            if (authErr) return { type: "text", content: authErr };

            let parsedValues: string[][];
            try {
                parsedValues = JSON.parse(args.values as string);
            } catch {
                return { type: "text", content: "Invalid values format. Must be JSON array of arrays." };
            }

            const range = args.range as string;
            const res = await googlePatch(
                `${SHEETS_BASE}/${args.spreadsheet_id}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
                { range, values: parsedValues, majorDimension: "ROWS" }
            );
            if (!res.ok) return { type: "text", content: `Write error: ${res.error}` };
            return { type: "text", content: `✅ Wrote ${parsedValues.length} rows to ${range}` };
        },
    },
    {
        name: "sheets_create",
        description: "Create a new Google Spreadsheet.",
        parameters: {
            type: "object" as const,
            properties: {
                title: { type: "string", description: "Spreadsheet title" },
                headers: { type: "string", description: "Optional: comma-separated column headers" },
            },
            required: ["title"],
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            const authErr = requireGoogleAuth();
            if (authErr) return { type: "text", content: authErr };

            const res = await googlePost<{ spreadsheetId: string; spreadsheetUrl: string }>(
                SHEETS_BASE,
                { properties: { title: args.title } }
            );
            if (!res.ok) return { type: "text", content: `Create failed: ${res.error}` };

            if (args.headers) {
                const headerRow = (args.headers as string).split(",").map(h => h.trim());
                await googlePatch(
                    `${SHEETS_BASE}/${res.data.spreadsheetId}/values/A1?valueInputOption=RAW`,
                    { values: [headerRow] }
                );
            }

            return {
                type: "text",
                content: `✅ Spreadsheet created: "${args.title}"\nID: ${res.data.spreadsheetId}\n${res.data.spreadsheetUrl}`,
            };
        },
    },
];

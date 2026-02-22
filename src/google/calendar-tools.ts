/**
 * Google Calendar Tools — list, create, and delete calendar events.
 */

import { googleGet, googlePost, googleDelete, requireGoogleAuth } from "./api-client.js";
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";

const BASE = "https://www.googleapis.com/calendar/v3";

// ─── Types ───────────────────────────────────────────────────────────────────

type CalEvent = {
    id: string;
    summary: string;
    start: { dateTime?: string; date?: string };
    end: { dateTime?: string; date?: string };
    location?: string;
    description?: string;
    attendees?: { email: string; responseStatus?: string }[];
    htmlLink?: string;
};

type CalList = { items?: CalEvent[] };

function formatEvent(e: CalEvent): string {
    const start = e.start.dateTime ? new Date(e.start.dateTime).toLocaleString() : e.start.date ?? "unknown";
    const end = e.end.dateTime ? new Date(e.end.dateTime).toLocaleString() : e.end.date ?? "";
    let s = `📅 ${e.summary}\n   ${start}`;
    if (end) s += ` → ${end}`;
    if (e.location) s += `\n   📍 ${e.location}`;
    if (e.attendees?.length) s += `\n   👥 ${e.attendees.map(a => a.email).join(", ")}`;
    s += `\n   ID: ${e.id}`;
    return s;
}

// ─── Tools ───────────────────────────────────────────────────────────────────

export const calendarTools: ToolDefinition[] = [
    {
        name: "calendar_events",
        description: "List upcoming calendar events. Shows title, time, location, and attendees.",
        parameters: {
            type: "object" as const,
            properties: {
                max_results: { type: "number", description: "Number of events (default 10)" },
                days_ahead: { type: "number", description: "How many days ahead to look (default 7)" },
            },
            required: [],
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            const authErr = requireGoogleAuth();
            if (authErr) return { type: "text", content: authErr };

            const maxResults = typeof args.max_results === "number" ? args.max_results : 10;
            const daysAhead = typeof args.days_ahead === "number" ? args.days_ahead : 7;
            const now = new Date();
            const future = new Date(now.getTime() + daysAhead * 86400000);

            const res = await googleGet<CalList>(`${BASE}/calendars/primary/events`, {
                timeMin: now.toISOString(),
                timeMax: future.toISOString(),
                maxResults: String(Math.min(maxResults, 25)),
                singleEvents: "true",
                orderBy: "startTime",
            });

            if (!res.ok) return { type: "text", content: `Calendar error: ${res.error}` };
            if (!res.data.items?.length) return { type: "text", content: "No upcoming events." };
            return { type: "text", content: res.data.items.map(formatEvent).join("\n\n") };
        },
    },
    {
        name: "calendar_create",
        description: "Create a new calendar event.",
        parameters: {
            type: "object" as const,
            properties: {
                title: { type: "string", description: "Event title" },
                start_time: { type: "string", description: "Start time in ISO 8601 format (e.g. 2024-03-15T10:00:00)" },
                end_time: { type: "string", description: "End time in ISO 8601 (defaults to 1 hour after start)" },
                location: { type: "string", description: "Optional location" },
                description: { type: "string", description: "Optional description" },
                attendees: { type: "string", description: "Comma-separated email addresses" },
            },
            required: ["title", "start_time"],
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            const authErr = requireGoogleAuth();
            if (authErr) return { type: "text", content: authErr };

            const startDt = new Date(args.start_time as string);
            const endDt = args.end_time ? new Date(args.end_time as string) : new Date(startDt.getTime() + 3600000);

            const event: Record<string, unknown> = {
                summary: args.title,
                start: { dateTime: startDt.toISOString() },
                end: { dateTime: endDt.toISOString() },
            };
            if (args.location) event.location = args.location;
            if (args.description) event.description = args.description;
            if (args.attendees) {
                event.attendees = (args.attendees as string).split(",").map(e => ({ email: e.trim() }));
            }

            const res = await googlePost<CalEvent>(`${BASE}/calendars/primary/events`, event);
            if (!res.ok) return { type: "text", content: `Create failed: ${res.error}` };
            return { type: "text", content: `✅ Event created: ${res.data.summary}\n${res.data.htmlLink ?? ""}` };
        },
    },
    {
        name: "calendar_delete",
        description: "Delete a calendar event by its ID. Use calendar_events to find IDs.",
        parameters: {
            type: "object" as const,
            properties: {
                event_id: { type: "string", description: "The event ID to delete" },
            },
            required: ["event_id"],
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            const authErr = requireGoogleAuth();
            if (authErr) return { type: "text", content: authErr };

            const res = await googleDelete(`${BASE}/calendars/primary/events/${args.event_id}`);
            if (!res.ok) return { type: "text", content: `Delete failed: ${res.error}` };
            return { type: "text", content: `✅ Event deleted.` };
        },
    },
];

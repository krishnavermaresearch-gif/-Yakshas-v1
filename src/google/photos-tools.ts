/**
 * Google Photos API tools.
 * Browse and search photo library.
 */
import { simpleGet, simplePost } from "./api-client.js";
import type { ToolDefinition } from "../agent/tool-registry.js";

const BASE = "https://photoslibrary.googleapis.com/v1";

export const photosTools: ToolDefinition[] = [
    {
        name: "photos_list",
        description: "List recent photos from Google Photos library.",
        parameters: {
            type: "object",
            properties: {
                maxResults: { type: "string", description: "Max photos to return (default 20)" },
            },
            required: [],
        },
        execute: async (args) => {
            try {
                const max = String(args.maxResults ?? "20");
                const data = await simpleGet(`${BASE}/mediaItems?pageSize=${max}`);
                if (!data.mediaItems?.length) return { type: "text", content: "No photos found." };
                const rows = data.mediaItems.map((p: any, i: number) =>
                    `${i + 1}. ${p.filename} (${p.mimeType}) — ${new Date(p.mediaMetadata?.creationTime).toLocaleDateString()} [id:${p.id}]`
                );
                return { type: "text", content: `📸 Recent photos:\n${rows.join("\n")}` };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
    {
        name: "photos_search",
        description: "Search Google Photos by date range or media type.",
        parameters: {
            type: "object",
            properties: {
                startDate: { type: "string", description: "Start date (YYYY-MM-DD)" },
                endDate: { type: "string", description: "End date (YYYY-MM-DD)" },
                mediaType: { type: "string", description: "PHOTO or VIDEO", enum: ["PHOTO", "VIDEO"] },
                maxResults: { type: "string", description: "Max results (default 20)" },
            },
            required: [],
        },
        execute: async (args) => {
            try {
                const filters: any = {};
                if (args.startDate || args.endDate) {
                    filters.dateFilter = { ranges: [{}] };
                    if (args.startDate) {
                        const d = new Date(String(args.startDate));
                        filters.dateFilter.ranges[0].startDate = { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
                    }
                    if (args.endDate) {
                        const d = new Date(String(args.endDate));
                        filters.dateFilter.ranges[0].endDate = { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
                    }
                }
                if (args.mediaType) filters.mediaTypeFilter = { mediaTypes: [String(args.mediaType)] };
                const body: any = { pageSize: parseInt(String(args.maxResults ?? "20")), filters };
                const data = await simplePost(`${BASE}/mediaItems:search`, body);
                if (!data.mediaItems?.length) return { type: "text", content: "No photos found matching criteria." };
                const rows = data.mediaItems.map((p: any, i: number) =>
                    `${i + 1}. ${p.filename} — ${new Date(p.mediaMetadata?.creationTime).toLocaleDateString()} [id:${p.id}]`
                );
                return { type: "text", content: `📸 Found photos:\n${rows.join("\n")}` };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
    {
        name: "photos_albums",
        description: "List Google Photos albums.",
        parameters: {
            type: "object",
            properties: {
                maxResults: { type: "string", description: "Max albums to return (default 20)" },
            },
            required: [],
        },
        execute: async (args) => {
            try {
                const max = String(args.maxResults ?? "20");
                const data = await simpleGet(`${BASE}/albums?pageSize=${max}`);
                if (!data.albums?.length) return { type: "text", content: "No albums found." };
                const rows = data.albums.map((a: any, i: number) =>
                    `${i + 1}. ${a.title} (${a.mediaItemsCount ?? 0} items) [id:${a.id}]`
                );
                return { type: "text", content: `📸 Albums:\n${rows.join("\n")}` };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
    {
        name: "photos_album_contents",
        description: "List photos in a specific album.",
        parameters: {
            type: "object",
            properties: {
                albumId: { type: "string", description: "Album ID" },
                maxResults: { type: "string", description: "Max results (default 20)" },
            },
            required: ["albumId"],
        },
        execute: async (args) => {
            try {
                const body = { albumId: String(args.albumId), pageSize: parseInt(String(args.maxResults ?? "20")) };
                const data = await simplePost(`${BASE}/mediaItems:search`, body);
                if (!data.mediaItems?.length) return { type: "text", content: "Album is empty." };
                const rows = data.mediaItems.map((p: any, i: number) =>
                    `${i + 1}. ${p.filename} — ${new Date(p.mediaMetadata?.creationTime).toLocaleDateString()}`
                );
                return { type: "text", content: `📸 Album contents:\n${rows.join("\n")}` };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
];

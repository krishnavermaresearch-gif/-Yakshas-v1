/**
 * YouTube Tools — search videos, list playlists, get channel info.
 */

import { googleGet, requireGoogleAuth } from "./api-client.js";
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";

const BASE = "https://www.googleapis.com/youtube/v3";

// ─── Types ───────────────────────────────────────────────────────────────────

type YTSnippet = { title: string; description: string; channelTitle: string; publishedAt: string };
type YTSearchItem = { id: { kind: string; videoId?: string; channelId?: string; playlistId?: string }; snippet: YTSnippet };
type YTSearchResult = { items?: YTSearchItem[] };
type YTPlaylistItem = { id: string; snippet: YTSnippet; contentDetails?: { itemCount?: number } };
type YTPlaylistList = { items?: YTPlaylistItem[] };
type YTChannelItem = { id: string; snippet: YTSnippet; statistics?: { subscriberCount?: string; videoCount?: string; viewCount?: string } };
type YTChannelList = { items?: YTChannelItem[] };

// ─── Tools ───────────────────────────────────────────────────────────────────

export const youtubeTools: ToolDefinition[] = [
    {
        name: "youtube_search",
        description: "Search YouTube for videos, channels, or playlists.",
        parameters: {
            type: "object" as const,
            properties: {
                query: { type: "string", description: "Search query" },
                max_results: { type: "number", description: "Number of results (default 10)" },
                content_type: { type: "string", description: "Filter: 'video', 'channel', or 'playlist' (default: video)" },
            },
            required: ["query"],
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            const authErr = requireGoogleAuth();
            if (authErr) return { type: "text", content: authErr };

            const max = Math.min(typeof args.max_results === "number" ? args.max_results : 10, 20);
            const res = await googleGet<YTSearchResult>(`${BASE}/search`, {
                part: "snippet",
                q: args.query as string,
                maxResults: String(max),
                type: (args.content_type as string) ?? "video",
            });
            if (!res.ok) return { type: "text", content: `YouTube error: ${res.error}` };
            if (!res.data.items?.length) return { type: "text", content: "No results found." };

            const results = res.data.items.map(item => {
                const s = item.snippet;
                const link = item.id.videoId
                    ? `https://youtu.be/${item.id.videoId}`
                    : item.id.channelId
                        ? `https://youtube.com/channel/${item.id.channelId}`
                        : `https://youtube.com/playlist?list=${item.id.playlistId}`;
                return `🎬 ${s.title}\n   📺 ${s.channelTitle} | ${new Date(s.publishedAt).toLocaleDateString()}\n   ${s.description.slice(0, 100)}\n   🔗 ${link}`;
            });

            return { type: "text", content: results.join("\n\n") };
        },
    },
    {
        name: "youtube_playlists",
        description: "List the user's YouTube playlists.",
        parameters: {
            type: "object" as const,
            properties: {
                max_results: { type: "number", description: "Number of playlists (default 10)" },
            },
            required: [],
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            const authErr = requireGoogleAuth();
            if (authErr) return { type: "text", content: authErr };

            const max = Math.min(typeof args.max_results === "number" ? args.max_results : 10, 25);
            const res = await googleGet<YTPlaylistList>(`${BASE}/playlists`, {
                part: "snippet,contentDetails",
                mine: "true",
                maxResults: String(max),
            });
            if (!res.ok) return { type: "text", content: `YouTube error: ${res.error}` };
            if (!res.data.items?.length) return { type: "text", content: "No playlists found." };

            const playlists = res.data.items.map(pl => {
                const count = pl.contentDetails?.itemCount ?? 0;
                return `📋 ${pl.snippet.title} (${count} videos)\n   ${pl.snippet.description.slice(0, 80)}\n   ID: ${pl.id}`;
            });

            return { type: "text", content: playlists.join("\n\n") };
        },
    },
    {
        name: "youtube_channel",
        description: "Get information about a YouTube channel by ID or the user's own channel.",
        parameters: {
            type: "object" as const,
            properties: {
                channel_id: { type: "string", description: "Channel ID (leave empty for user's own channel)" },
            },
            required: [],
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            const authErr = requireGoogleAuth();
            if (authErr) return { type: "text", content: authErr };

            const params: Record<string, string> = { part: "snippet,statistics" };
            if (args.channel_id) {
                params.id = args.channel_id as string;
            } else {
                params.mine = "true";
            }

            const res = await googleGet<YTChannelList>(`${BASE}/channels`, params);
            if (!res.ok) return { type: "text", content: `YouTube error: ${res.error}` };
            if (!res.data.items?.length) return { type: "text", content: "Channel not found." };

            const ch = res.data.items[0];
            const stats = ch.statistics;
            return {
                type: "text",
                content: [
                    `📺 ${ch.snippet.title}`,
                    `   ${ch.snippet.description.slice(0, 150)}`,
                    stats ? `   👥 ${parseInt(stats.subscriberCount ?? "0").toLocaleString()} subscribers` : "",
                    stats ? `   🎬 ${stats.videoCount} videos | 👁️ ${parseInt(stats.viewCount ?? "0").toLocaleString()} views` : "",
                ].filter(Boolean).join("\n"),
            };
        },
    },
];

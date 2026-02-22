/**
 * Google Books API tools.
 * Search books and manage library.
 */
import { simpleGet } from "./api-client.js";
import type { ToolDefinition } from "../agent/tool-registry.js";

const BASE = "https://www.googleapis.com/books/v1";

export const booksTools: ToolDefinition[] = [
    {
        name: "books_search",
        description: "Search for books on Google Books.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "Search query (title, author, ISBN, etc.)" },
                maxResults: { type: "string", description: "Max results (default 10)" },
            },
            required: ["query"],
        },
        execute: async (args) => {
            try {
                const max = String(args.maxResults ?? "10");
                const data = await simpleGet(`${BASE}/volumes?q=${encodeURIComponent(String(args.query))}&maxResults=${max}`);
                if (!data.items?.length) return { type: "text", content: "No books found." };
                const rows = data.items.map((b: any, i: number) => {
                    const v = b.volumeInfo;
                    return `${i + 1}. **${v.title}** by ${v.authors?.join(", ") ?? "Unknown"} (${v.publishedDate ?? "N/A"}) — ${v.pageCount ?? "?"} pages [id:${b.id}]`;
                });
                return { type: "text", content: `📚 Books found:\n${rows.join("\n")}` };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
    {
        name: "books_details",
        description: "Get detailed information about a specific book.",
        parameters: {
            type: "object",
            properties: {
                bookId: { type: "string", description: "Book volume ID" },
            },
            required: ["bookId"],
        },
        execute: async (args) => {
            try {
                const b = await simpleGet(`${BASE}/volumes/${args.bookId}`);
                const v = b.volumeInfo;
                const lines = [
                    `📚 **${v.title}**${v.subtitle ? ` — ${v.subtitle}` : ""}`,
                    `Authors: ${v.authors?.join(", ") ?? "Unknown"}`,
                    `Published: ${v.publishedDate ?? "N/A"} by ${v.publisher ?? "Unknown"}`,
                    `Pages: ${v.pageCount ?? "N/A"} | Language: ${v.language ?? "N/A"}`,
                    `Categories: ${v.categories?.join(", ") ?? "N/A"}`,
                    `Rating: ${v.averageRating ?? "N/A"}/5 (${v.ratingsCount ?? 0} ratings)`,
                    `Description: ${v.description?.slice(0, 500) ?? "No description"}`,
                    v.previewLink ? `Preview: ${v.previewLink}` : "",
                ].filter(Boolean);
                return { type: "text", content: lines.join("\n") };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
    {
        name: "books_my_library",
        description: "List books in your Google Books library/bookshelves.",
        parameters: {
            type: "object",
            properties: {
                shelf: { type: "string", description: "Bookshelf ID (default: all shelves)" },
            },
            required: [],
        },
        execute: async (args) => {
            try {
                if (args.shelf) {
                    const data = await simpleGet(`${BASE}/mylibrary/bookshelves/${args.shelf}/volumes`);
                    if (!data.items?.length) return { type: "text", content: "No books in this shelf." };
                    const rows = data.items.map((b: any, i: number) =>
                        `${i + 1}. ${b.volumeInfo.title} by ${b.volumeInfo.authors?.join(", ") ?? "Unknown"}`
                    );
                    return { type: "text", content: `📚 Bookshelf:\n${rows.join("\n")}` };
                }
                const data = await simpleGet(`${BASE}/mylibrary/bookshelves`);
                if (!data.items?.length) return { type: "text", content: "No bookshelves found." };
                const rows = data.items.map((s: any) =>
                    `- ${s.title} (${s.volumeCount ?? 0} books) [id:${s.id}]`
                );
                return { type: "text", content: `📚 Your bookshelves:\n${rows.join("\n")}` };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
];

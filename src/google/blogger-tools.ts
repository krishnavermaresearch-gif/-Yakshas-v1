/**
 * Google Blogger API tools.
 * Manage blog posts.
 */
import { simpleGet, simplePost, simpleDelete } from "./api-client.js";
import type { ToolDefinition } from "../agent/tool-registry.js";

const BASE = "https://www.googleapis.com/blogger/v3";

export const bloggerTools: ToolDefinition[] = [
    {
        name: "blogger_blogs",
        description: "List your Blogger blogs.",
        parameters: {
            type: "object",
            properties: {},
            required: [],
        },
        execute: async () => {
            try {
                const data = await simpleGet(`${BASE}/users/self/blogs`);
                if (!data.items?.length) return { type: "text", content: "No blogs found." };
                const rows = data.items.map((b: any, i: number) =>
                    `${i + 1}. **${b.name}** — ${b.url} [id:${b.id}]`
                );
                return { type: "text", content: `✍️ Your blogs:\n${rows.join("\n")}` };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
    {
        name: "blogger_posts",
        description: "List recent posts from a blog.",
        parameters: {
            type: "object",
            properties: {
                blogId: { type: "string", description: "Blog ID" },
                maxResults: { type: "string", description: "Max posts (default 10)" },
            },
            required: ["blogId"],
        },
        execute: async (args) => {
            try {
                const max = String(args.maxResults ?? "10");
                const data = await simpleGet(`${BASE}/blogs/${args.blogId}/posts?maxResults=${max}`);
                if (!data.items?.length) return { type: "text", content: "No posts found." };
                const rows = data.items.map((p: any, i: number) =>
                    `${i + 1}. **${p.title}** (${new Date(p.published).toLocaleDateString()}) — ${p.url} [id:${p.id}]`
                );
                return { type: "text", content: `✍️ Blog posts:\n${rows.join("\n")}` };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
    {
        name: "blogger_create",
        description: "Create a new blog post.",
        parameters: {
            type: "object",
            properties: {
                blogId: { type: "string", description: "Blog ID" },
                title: { type: "string", description: "Post title" },
                content: { type: "string", description: "HTML content of the post" },
            },
            required: ["blogId", "title", "content"],
        },
        execute: async (args) => {
            try {
                const post = await simplePost(`${BASE}/blogs/${args.blogId}/posts`, {
                    title: String(args.title),
                    content: String(args.content),
                });
                return { type: "text", content: `✅ Post published: "${post.title}"\nURL: ${post.url}` };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
    {
        name: "blogger_delete",
        description: "Delete a blog post.",
        parameters: {
            type: "object",
            properties: {
                blogId: { type: "string", description: "Blog ID" },
                postId: { type: "string", description: "Post ID to delete" },
            },
            required: ["blogId", "postId"],
        },
        execute: async (args) => {
            try {
                await simpleDelete(`${BASE}/blogs/${args.blogId}/posts/${args.postId}`);
                return { type: "text", content: "🗑️ Post deleted." };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
];

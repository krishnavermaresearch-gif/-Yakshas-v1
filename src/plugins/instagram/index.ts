import { getAdb } from "../../adb/connection.js";
// Logger available for future use
import type { PhonePlugin } from "../plugin-types.js";
import type { ToolDefinition, ToolResult } from "../../agent/tool-registry.js";

// ─── Instagram Plugin ────────────────────────────────────────────────────────

const INSTAGRAM_PACKAGE = "com.instagram.android";

const openInstagram: ToolDefinition = {
    name: "instagram_open",
    description:
        "Open Instagram app. Launches the app and waits for it to load.",
    parameters: {
        type: "object" as const,
        properties: {},
        required: [],
    },
    execute: async (): Promise<ToolResult> => {
        try {
            const adb = getAdb();
            await adb.launchApp(INSTAGRAM_PACKAGE);
            await adb.sleep(3000);
            return { type: "text", content: "Instagram opened. Use adb_ui_tree to see the current screen." };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { type: "text", content: `Failed to open Instagram: ${msg}` };
        }
    },
};

const searchInstagram: ToolDefinition = {
    name: "instagram_search",
    description:
        "Search for a user or content on Instagram. Opens the search/explore tab " +
        "and types the search query.",
    parameters: {
        type: "object" as const,
        properties: {
            query: {
                type: "string",
                description: "Search query — username or name to find",
            },
        },
        required: ["query"],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const query = String(args.query ?? "").trim();
        if (!query) {
            return { type: "text", content: "Error: search query is required." };
        }

        try {
            const adb = getAdb();

            // Open Instagram search via deep link
            await adb.shell(
                `am start -a android.intent.action.VIEW -d "https://www.instagram.com/explore/search/" ${INSTAGRAM_PACKAGE}`,
            );
            await adb.sleep(3000);

            return {
                type: "text",
                content:
                    `Instagram search opened. Now:\n` +
                    "1. Use adb_ui_tree to find the search input field\n" +
                    "2. Tap on it\n" +
                    `3. Type "${query}" using adb_type\n` +
                    "4. Use adb_ui_tree to see search results\n" +
                    "5. Tap on the desired user from results",
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { type: "text", content: `Instagram search failed: ${msg}` };
        }
    },
};

const followInstagram: ToolDefinition = {
    name: "instagram_follow",
    description:
        "Follow a user on Instagram. Must be on the user's profile page first. " +
        "Use instagram_search to find the user, then navigate to their profile before calling this.",
    parameters: {
        type: "object" as const,
        properties: {
            username: {
                type: "string",
                description: "Instagram username to follow (for logging purposes)",
            },
        },
        required: ["username"],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const username = String(args.username ?? "").trim();
        try {
            return {
                type: "text",
                content:
                    `To follow @${username}:\n` +
                    "1. Make sure you're on their profile page\n" +
                    '2. Use adb_ui_tree to find the "Follow" button\n' +
                    "3. Tap on the Follow button\n" +
                    '4. Verify the button changed to "Following" using adb_ui_tree',
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { type: "text", content: `Instagram follow failed: ${msg}` };
        }
    },
};

const viewInstagramProfile: ToolDefinition = {
    name: "instagram_view_profile",
    description:
        "Navigate to a specific Instagram user's profile by username. " +
        "Uses a deep link to go directly to their profile.",
    parameters: {
        type: "object" as const,
        properties: {
            username: {
                type: "string",
                description: "Instagram username (without @)",
            },
        },
        required: ["username"],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const username = String(args.username ?? "").trim().replace(/^@/, "");
        if (!username) {
            return { type: "text", content: "Error: username is required." };
        }

        try {
            const adb = getAdb();
            await adb.shell(
                `am start -a android.intent.action.VIEW -d "https://www.instagram.com/${username}/" ${INSTAGRAM_PACKAGE}`,
            );
            await adb.sleep(3000);

            return {
                type: "text",
                content:
                    `Navigated to @${username}'s profile. ` +
                    "Use adb_ui_tree to see their profile info (followers, bio, Follow button).",
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { type: "text", content: `Failed to open profile: ${msg}` };
        }
    },
};

export const instagramPlugin: PhonePlugin = {
    name: "instagram",
    description: "Search users, view profiles, follow/unfollow on Instagram",
    appPackage: INSTAGRAM_PACKAGE,
    tools: [openInstagram, searchInstagram, followInstagram, viewInstagramProfile],
    systemPrompt: `## Instagram Automation
- Package: com.instagram.android
- The home feed is the first screen when opening Instagram
- The bottom navigation has: Home, Search/Explore, Reels, Shopping, Profile
- To search: tap the magnifying glass icon (Search tab), then tap the search bar at top
- Profiles show: username, bio, follower/following counts, and a Follow/Following button
- The "Follow" button is usually blue; "Following" is usually gray/outlined
- Use deep links to go directly to profiles: instagram_view_profile tool
- Instagram may show login prompts, stories, or reels — use BACK key to dismiss`,
};

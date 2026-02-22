import { getAdb } from "../../adb/connection.js";
// Logger available for future use
import type { PhonePlugin } from "../plugin-types.js";
import type { ToolDefinition, ToolResult } from "../../agent/tool-registry.js";

// ─── Gmail Plugin ────────────────────────────────────────────────────────────

const GMAIL_PACKAGE = "com.google.android.gm";

const openGmail: ToolDefinition = {
    name: "gmail_open",
    description: "Open Gmail app.",
    parameters: {
        type: "object" as const,
        properties: {},
        required: [],
    },
    execute: async (): Promise<ToolResult> => {
        try {
            const adb = getAdb();
            await adb.launchApp(GMAIL_PACKAGE);
            await adb.sleep(3000);
            return { type: "text", content: "Gmail opened. Use adb_ui_tree to see the inbox." };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { type: "text", content: `Failed to open Gmail: ${msg}` };
        }
    },
};

const composeGmail: ToolDefinition = {
    name: "gmail_compose",
    description:
        "Compose a new email in Gmail. Opens the compose screen using an Android Intent " +
        "with the specified recipient, subject, and body pre-filled.",
    parameters: {
        type: "object" as const,
        properties: {
            to: {
                type: "string",
                description: "Recipient email address",
            },
            subject: {
                type: "string",
                description: "Email subject line",
            },
            body: {
                type: "string",
                description: "Email body text",
            },
        },
        required: ["to", "subject", "body"],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const to = String(args.to ?? "").trim();
        const subject = String(args.subject ?? "").trim();
        const body = String(args.body ?? "").trim();

        if (!to) {
            return { type: "text", content: "Error: recipient email (to) is required." };
        }

        try {
            const adb = getAdb();

            // Use Android Intent to compose email
            // This pre-fills the compose screen with all fields
            const escapedSubject = subject.replace(/'/g, "'\\''");
            const escapedBody = body.replace(/'/g, "'\\''");

            await adb.shell(
                `am start -a android.intent.action.SENDTO ` +
                `-d "mailto:${to}" ` +
                `--es android.intent.extra.SUBJECT '${escapedSubject}' ` +
                `--es android.intent.extra.TEXT '${escapedBody}' ` +
                `${GMAIL_PACKAGE}`,
            );
            await adb.sleep(3000);

            return {
                type: "text",
                content:
                    `Gmail compose opened with:\n` +
                    `To: ${to}\n` +
                    `Subject: ${subject}\n` +
                    `Body: ${body.slice(0, 100)}...\n\n` +
                    "Use adb_ui_tree to verify the fields are filled correctly, " +
                    "then find and tap the Send button (usually a paper plane icon at the top).",
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { type: "text", content: `Gmail compose failed: ${msg}` };
        }
    },
};

const readGmailInbox: ToolDefinition = {
    name: "gmail_read_inbox",
    description:
        "Read the Gmail inbox. Opens Gmail and lists visible emails " +
        "using the UI tree (sender, subject, preview).",
    parameters: {
        type: "object" as const,
        properties: {},
        required: [],
    },
    execute: async (): Promise<ToolResult> => {
        try {
            const adb = getAdb();
            await adb.launchApp(GMAIL_PACKAGE);
            await adb.sleep(3000);

            return {
                type: "text",
                content:
                    "Gmail inbox is open. " +
                    "Use adb_ui_tree to read the email list. " +
                    "Each email item shows: sender name, subject, preview text, and time. " +
                    "Tap an email to read its full content. " +
                    "Scroll down with adb_swipe to see older emails.",
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { type: "text", content: `Failed to read Gmail: ${msg}` };
        }
    },
};

export const gmailPlugin: PhonePlugin = {
    name: "gmail",
    description: "Compose/send emails, read inbox in Gmail",
    appPackage: GMAIL_PACKAGE,
    tools: [openGmail, composeGmail, readGmailInbox],
    systemPrompt: `## Gmail Automation
- Package: com.google.android.gm
- The inbox shows emails with sender, subject, preview, and time
- To compose: use gmail_compose which pre-fills all fields via Android Intent
- The compose screen has: To, Subject, Body fields, and Send button (paper plane icon)
- To read full email: tap on an email in the inbox list
- The FAB (floating action button) at bottom-right is the compose button
- Gmail may show promotional prompts or categories — focus on Primary inbox tab`,
};

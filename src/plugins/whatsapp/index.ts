import { getAdb } from "../../adb/connection.js";
// Logger available for future use
import type { PhonePlugin } from "../plugin-types.js";
import type { ToolDefinition, ToolResult } from "../../agent/tool-registry.js";

// ─── WhatsApp Plugin ─────────────────────────────────────────────────────────

const WHATSAPP_PACKAGE = "com.whatsapp";

const openWhatsApp: ToolDefinition = {
    name: "whatsapp_open",
    description:
        "Open WhatsApp. Launches the app and waits for it to load.",
    parameters: {
        type: "object" as const,
        properties: {},
        required: [],
    },
    execute: async (): Promise<ToolResult> => {
        try {
            const adb = getAdb();
            await adb.launchApp(WHATSAPP_PACKAGE);
            await adb.sleep(3000);
            return { type: "text", content: "WhatsApp opened. Use adb_ui_tree to see the chats." };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { type: "text", content: `Failed to open WhatsApp: ${msg}` };
        }
    },
};

const sendWhatsAppMessage: ToolDefinition = {
    name: "whatsapp_send",
    description:
        "Send a WhatsApp message to a contact. Opens a chat with the specified " +
        "contact/number and sends the message. The contact must already be in your " +
        "WhatsApp contacts. For new numbers, use the phone number format.",
    parameters: {
        type: "object" as const,
        properties: {
            contact: {
                type: "string",
                description:
                    "Contact name as it appears in WhatsApp, or phone number with country code (e.g., +91xxxxxxxxxx)",
            },
            message: {
                type: "string",
                description: "Message text to send",
            },
        },
        required: ["contact", "message"],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const contact = String(args.contact ?? "").trim();
        const message = String(args.message ?? "").trim();

        if (!contact || !message) {
            return { type: "text", content: "Error: both contact and message are required." };
        }

        try {
            const adb = getAdb();

            // Use Android Intent to open chat directly
            const isNumber = /^\+?\d[\d\s-]{6,}$/.test(contact);
            if (isNumber) {
                // Open chat via number using wa.me link
                const cleanNumber = contact.replace(/[\s-+]/g, "");
                await adb.shell(
                    `am start -a android.intent.action.VIEW -d "https://wa.me/${cleanNumber}" ${WHATSAPP_PACKAGE}`,
                );
            } else {
                // For named contacts, open WhatsApp and search
                await adb.launchApp(WHATSAPP_PACKAGE);
                await adb.sleep(2000);
                // The agent will need to use UI tree + search to find the contact
                return {
                    type: "text",
                    content:
                        `WhatsApp opened. To message "${contact}", use the search/new chat feature:\n` +
                        "1. Use adb_ui_tree to find the search icon\n" +
                        "2. Tap it and type the contact name\n" +
                        "3. Tap the contact in results\n" +
                        `4. Type and send: "${message}"`,
                };
            }

            await adb.sleep(3000);

            // Type the message
            await adb.type(message);
            await adb.sleep(500);

            // Find and tap send button
            return {
                type: "text",
                content:
                    `Opened chat with ${contact} and typed message. ` +
                    "Use adb_ui_tree to find the send button and tap it.",
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { type: "text", content: `WhatsApp send failed: ${msg}` };
        }
    },
};

const readWhatsAppChats: ToolDefinition = {
    name: "whatsapp_read_chats",
    description:
        "Read the list of recent WhatsApp chats visible on the main screen. " +
        "Opens WhatsApp and uses the UI tree to extract chat names and last messages.",
    parameters: {
        type: "object" as const,
        properties: {},
        required: [],
    },
    execute: async (): Promise<ToolResult> => {
        try {
            const adb = getAdb();
            await adb.launchApp(WHATSAPP_PACKAGE);
            await adb.sleep(3000);

            return {
                type: "text",
                content:
                    "WhatsApp is open on the chats screen. " +
                    "Use adb_ui_tree to read the chat list. " +
                    "Each chat element contains the contact name and last message text. " +
                    "Scroll down with adb_swipe to see more chats.",
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { type: "text", content: `Failed to read WhatsApp chats: ${msg}` };
        }
    },
};

export const whatsappPlugin: PhonePlugin = {
    name: "whatsapp",
    description: "Send/read WhatsApp messages, view chats",
    appPackage: WHATSAPP_PACKAGE,
    tools: [openWhatsApp, sendWhatsAppMessage, readWhatsAppChats],
    systemPrompt: `## WhatsApp Automation
- Package: com.whatsapp
- The main screen shows the chat list with contact names and last messages
- Use the search icon (magnifying glass) at the top to find contacts
- In a chat, messages appear in order, the text input is at the bottom
- The send button is usually a green circle icon on the right of the text input
- To read all messages from a contact: open their chat, use adb_ui_tree to read visible messages, scroll up for older ones
- WhatsApp may show notifications or pop-ups — dismiss them with BACK key`,
};

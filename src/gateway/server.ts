/**
 * Multi-Channel Gateway Server — 10+ Platform Webhook Receiver
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { logInfo, logWarn, logError } from "../logger.js";
import { guardIncomingMessage, type TrustedSender } from "../security/prompt-guard.js";

export interface ChannelMessage {
    messageId: string;
    channel: TrustedSender["type"] | "teams" | "signal" | "matrix" | "gchat" | "custom";
    senderId: string;
    senderName: string;
    text: string;
    media?: Array<{ url: string; mimeType: string }>;
    timestamp: Date;
}

export type ChannelReplyFn = (text: string, media?: Buffer) => Promise<void>;
export type MessageHandler = (message: ChannelMessage, reply: ChannelReplyFn) => Promise<void>;

function parseBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        req.on("error", reject);
    });
}

function parseWhatsApp(body: Record<string, string>): ChannelMessage | null {
    if (!body.Body?.trim()) return null;
    return { messageId: body.MessageSid ?? `wa-${Date.now()}`, channel: "whatsapp", senderId: body.From ?? "unknown", senderName: body.ProfileName ?? body.From ?? "WhatsApp User", text: body.Body.trim(), media: body.MediaUrl0 ? [{ url: body.MediaUrl0, mimeType: body.MediaContentType0 ?? "image/jpeg" }] : undefined, timestamp: new Date() };
}

function parseSlack(body: Record<string, unknown>): ChannelMessage | null {
    if (body.type === "url_verification") return null;
    const event = body.event as Record<string, unknown> | undefined;
    if (!event || event.type !== "message" || event.bot_id) return null;
    return { messageId: String(event.ts ?? Date.now()), channel: "slack", senderId: String(event.user ?? "unknown"), senderName: String(event.user ?? "Slack User"), text: String(event.text ?? ""), timestamp: new Date() };
}

function parseDiscord(body: Record<string, unknown>): ChannelMessage | null {
    if (body.type === 1) return null;
    const content = String(body.content ?? "");
    if (!content) return null;
    const author = body.author as Record<string, unknown> | undefined;
    return { messageId: String(body.id ?? Date.now()), channel: "discord", senderId: String(author?.id ?? "unknown"), senderName: String(author?.username ?? "Discord User"), text: content, timestamp: new Date() };
}

function parseBlueBubbles(body: Record<string, unknown>): ChannelMessage | null {
    const msg = body.message as Record<string, unknown> | undefined;
    if (!msg) return null;
    return { messageId: String(msg.guid ?? Date.now()), channel: "imessage", senderId: String(msg.handle ?? "unknown"), senderName: String(msg.handle ?? "iMessage User"), text: String(msg.text ?? ""), timestamp: new Date() };
}

function parseGeneric(body: Record<string, unknown>): ChannelMessage | null {
    const text = String(body.text ?? body.message ?? body.content ?? "");
    if (!text) return null;
    return { messageId: String(body.id ?? Date.now()), channel: "custom", senderId: String(body.senderId ?? body.from ?? "unknown"), senderName: String(body.senderName ?? body.from ?? "Webhook User"), text, timestamp: new Date() };
}

export class GatewayServer {
    private server: ReturnType<typeof createServer> | null = null;
    private port: number;
    private handler: MessageHandler | null = null;

    constructor(port?: number) { this.port = port ?? Number(process.env.GATEWAY_PORT ?? 3000); }
    onMessage(handler: MessageHandler): void { this.handler = handler; }

    async start(): Promise<void> {
        this.server = createServer(async (req, res) => {
            if (req.method === "GET" && req.url === "/health") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ status: "ok" })); return; }
            if (req.method !== "POST" || !req.url?.startsWith("/webhook/")) { res.writeHead(404); res.end("Not found"); return; }
            try {
                const rawBody = await parseBody(req);
                const channel = req.url.replace("/webhook/", "").split("?")[0];
                await this.routeWebhook(channel, rawBody, req, res);
            } catch (err) { logError(`Gateway error: ${err instanceof Error ? err.message : err}`); res.writeHead(500); res.end("Error"); }
        });
        return new Promise((resolve) => {
            this.server!.listen(this.port, () => {
                logInfo(`🌐 Gateway on port ${this.port} — POST /webhook/{whatsapp,slack,discord,imessage,teams,signal,matrix,gchat,custom}`);
                resolve();
            });
        });
    }

    private async routeWebhook(channel: string, rawBody: string, _req: IncomingMessage, res: ServerResponse): Promise<void> {
        let parsed: ChannelMessage | null = null;
        try {
            const ct = _req.headers["content-type"] ?? "";
            const body: Record<string, unknown> = ct.includes("x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(rawBody).entries()) : JSON.parse(rawBody);

            if (channel === "slack" && (body as any).type === "url_verification") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ challenge: (body as any).challenge })); return; }
            if (channel === "discord" && (body as any).type === 1) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ type: 1 })); return; }

            switch (channel) {
                case "whatsapp": parsed = parseWhatsApp(body as Record<string, string>); break;
                case "slack": parsed = parseSlack(body); break;
                case "discord": parsed = parseDiscord(body); break;
                case "imessage": case "bluebubbles": parsed = parseBlueBubbles(body); break;
                default: parsed = parseGeneric(body); if (parsed) parsed.channel = channel as ChannelMessage["channel"]; break;
            }
        } catch (err) { logError(`Parse ${channel} failed: ${err}`); res.writeHead(400); res.end("Bad request"); return; }

        if (!parsed) { res.writeHead(200); res.end("OK"); return; }

        const guard = guardIncomingMessage(parsed.text, parsed.channel as TrustedSender["type"], parsed.senderId);
        if (!guard.safe) { logWarn(`🛡️ Blocked ${channel}:${parsed.senderId}: ${guard.reason}`); res.writeHead(200); res.end("OK"); return; }

        logInfo(`📩 ${channel} from ${parsed.senderName}: "${parsed.text.slice(0, 80)}..."`);
        if (this.handler) {
            const replyFn: ChannelReplyFn = async (text) => { logInfo(`📤 Reply → ${channel}:${parsed!.senderId}: "${text.slice(0, 80)}..."`); };
            this.handler(parsed, replyFn).catch((err) => logError(`Handler error: ${err}`));
        }
        res.writeHead(200); res.end("OK");
    }

    async stop(): Promise<void> { return new Promise((r) => { this.server ? this.server.close(() => r()) : r(); }); }
}

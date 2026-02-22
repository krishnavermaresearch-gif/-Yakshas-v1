/**
 * Communication Analyzer — learns how the user communicates.
 *
 * Analyzes messaging patterns to build a "communication fingerprint":
 *  - Message length distribution per contact
 *  - Response time patterns (fast for wife, slow for colleagues)
 *  - Emoji usage frequency and favorites
 *  - Formality level detection (casual vs formal)
 *  - Time-of-day communication preferences
 *  - Tone patterns (positive, neutral, terse)
 *
 * This is the "voice" of the Digital Soul.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { logInfo } from "../logger.js";
import { getSoulDB } from "./soul-db.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MessageRecord {
    timestamp: number;
    /** Contact name or identifier */
    contact: string;
    /** "sent" or "received" */
    direction: "sent" | "received";
    /** Message content */
    text: string;
    /** App it was sent from (WhatsApp, Telegram, etc.) */
    app: string;
    /** Response time in ms (if this was a reply) */
    responseTimeMs?: number;
}

export interface ContactStyle {
    contact: string;
    /** Total messages sent to this contact */
    messagesSent: number;
    /** Total messages received from this contact */
    messagesReceived: number;
    /** Average message length (chars) sent to this contact */
    avgMessageLength: number;
    /** Median response time to this contact (ms) */
    medianResponseTimeMs: number;
    /** Fastest response (ms) */
    fastestResponseMs: number;
    /** Slowest response (ms) */
    slowestResponseMs: number;
    /** How often emojis are used (0-1) */
    emojiFrequency: number;
    /** Most used emojis for this contact */
    topEmojis: string[];
    /** Formality score: 0 = very casual, 1 = very formal */
    formalityScore: number;
    /** Average words per message */
    avgWordsPerMessage: number;
    /** Preferred communication hours */
    peakHours: number[];
    /** Relationship tier: "inner_circle" | "regular" | "acquaintance" */
    relationshipTier: "inner_circle" | "regular" | "acquaintance";
}

export interface CommunicationFingerprint {
    /** Overall average message length */
    avgMessageLength: number;
    /** Overall emoji usage rate */
    emojiUsageRate: number;
    /** Top 10 most-used emojis */
    topEmojis: string[];
    /** Overall formality score (0-1) */
    overallFormality: number;
    /** Average response time across all contacts */
    avgResponseTimeMs: number;
    /** Per-contact communication styles */
    contactStyles: ContactStyle[];
    /** Common phrases and expressions */
    catchphrases: string[];
    /** Message length distribution: short (<20), medium (20-100), long (>100) */
    lengthDistribution: { short: number; medium: number; long: number };
    /** Communication volume by hour of day */
    hourlyVolume: number[];
    /** Total messages analyzed */
    totalMessages: number;
    /** Analysis timestamp */
    generatedAt: number;
}

// ─── Analyzer ────────────────────────────────────────────────────────────────

export class CommunicationAnalyzer {
    private readonly dataDir: string;
    private messages: MessageRecord[] = [];

    constructor(dataDir?: string) {
        this.dataDir = dataDir ?? resolve(process.cwd(), "data", "communication");
        if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
        this.loadMessages();
    }

    /** Record a new message (called when the agent observes messaging activity) */
    recordMessage(msg: MessageRecord): void {
        this.messages.push(msg);
        this.writeToSqlite(msg);
        if (this.messages.length % 50 === 0) this.saveMessages();
    }

    /** Record multiple messages at once (batch import) */
    recordBatch(msgs: MessageRecord[]): void {
        this.messages.push(...msgs);
        for (const m of msgs) this.writeToSqlite(m);
        this.saveMessages();
    }

    /** Write a single message to SQLite */
    private writeToSqlite(msg: MessageRecord): void {
        try {
            const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
            const emojis = msg.text.match(emojiRegex) ?? [];
            const words = msg.text.split(/\s+/).filter(w => w.length > 0);
            const formality = this.quickFormality(msg.text);

            getSoulDB().insertMessage({
                timestamp: msg.timestamp,
                contact: msg.contact,
                direction: msg.direction,
                text: msg.text,
                app: msg.app,
                response_time_ms: msg.responseTimeMs ?? null,
                emoji_count: emojis.length,
                word_count: words.length,
                char_count: msg.text.length,
                formality,
            });
        } catch { /* SQLite write is best-effort */ }
    }

    /** Quick formality score for a single message */
    private quickFormality(text: string): number {
        const lower = text.toLowerCase();
        let formal = 0, casual = 0;
        if (/\b(please|thank you|regards|sincerely|dear|kindly)\b/.test(lower)) formal++;
        if (/\b(lol|haha|lmao|bruh|dude|bro|yeah|yep|nah|gonna|wanna|gotta)\b/.test(lower)) casual++;
        if (formal + casual === 0) return 0.5;
        return Math.round((formal / (formal + casual)) * 100) / 100;
    }

    /** Build a complete communication fingerprint */
    buildFingerprint(): CommunicationFingerprint {
        const sentMessages = this.messages.filter(m => m.direction === "sent");
        if (sentMessages.length === 0) {
            return this.emptyFingerprint();
        }

        // Overall stats
        const totalLength = sentMessages.reduce((s, m) => s + m.text.length, 0);
        const avgLength = totalLength / sentMessages.length;

        // Emoji analysis
        const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
        const allEmojis: string[] = [];
        let messagesWithEmoji = 0;
        for (const msg of sentMessages) {
            const emojis = msg.text.match(emojiRegex) ?? [];
            if (emojis.length > 0) messagesWithEmoji++;
            allEmojis.push(...emojis);
        }

        const emojiCounts = new Map<string, number>();
        for (const e of allEmojis) {
            emojiCounts.set(e, (emojiCounts.get(e) ?? 0) + 1);
        }
        const topEmojis = Array.from(emojiCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([emoji]) => emoji);

        // Formality analysis
        const formalityScore = this.calculateFormality(sentMessages);

        // Response times
        const responseTimes = this.messages
            .filter(m => m.direction === "sent" && m.responseTimeMs !== undefined)
            .map(m => m.responseTimeMs!);
        const avgResponseTime = responseTimes.length > 0
            ? responseTimes.reduce((s, t) => s + t, 0) / responseTimes.length
            : 0;

        // Per-contact analysis
        const contactStyles = this.buildContactStyles();

        // Length distribution
        const short = sentMessages.filter(m => m.text.length < 20).length;
        const long = sentMessages.filter(m => m.text.length > 100).length;
        const medium = sentMessages.length - short - long;

        // Hourly volume
        const hourlyVolume = new Array(24).fill(0) as number[];
        for (const msg of sentMessages) {
            const hour = new Date(msg.timestamp).getHours();
            hourlyVolume[hour]++;
        }

        // Catchphrases (common 2-3 word phrases)
        const catchphrases = this.findCatchphrases(sentMessages);

        return {
            avgMessageLength: Math.round(avgLength),
            emojiUsageRate: Math.round((messagesWithEmoji / sentMessages.length) * 100) / 100,
            topEmojis,
            overallFormality: formalityScore,
            avgResponseTimeMs: Math.round(avgResponseTime),
            contactStyles,
            catchphrases,
            lengthDistribution: {
                short: Math.round((short / sentMessages.length) * 100),
                medium: Math.round((medium / sentMessages.length) * 100),
                long: Math.round((long / sentMessages.length) * 100),
            },
            hourlyVolume,
            totalMessages: this.messages.length,
            generatedAt: Date.now(),
        };
    }

    /** Get the communication style for a specific contact */
    getContactStyle(contact: string): ContactStyle | undefined {
        return this.buildContactStyles().find(c => c.contact === contact);
    }

    /** Predict how the user would respond to a message from a contact */
    predictResponseStyle(contact: string): {
        expectedLength: string;
        expectedTone: string;
        expectedResponseTime: string;
        emojiLikely: boolean;
        samplePhrases: string[];
    } {
        const style = this.getContactStyle(contact);
        if (!style) {
            return {
                expectedLength: "unknown",
                expectedTone: "unknown",
                expectedResponseTime: "unknown",
                emojiLikely: false,
                samplePhrases: [],
            };
        }

        return {
            expectedLength: style.avgWordsPerMessage < 5 ? "short (1-5 words)"
                : style.avgWordsPerMessage < 15 ? "medium (5-15 words)"
                    : "long (15+ words)",
            expectedTone: style.formalityScore > 0.6 ? "formal"
                : style.formalityScore > 0.3 ? "casual"
                    : "very casual / slang",
            expectedResponseTime: style.medianResponseTimeMs < 60000 ? "within a minute"
                : style.medianResponseTimeMs < 300000 ? "within 5 minutes"
                    : style.medianResponseTimeMs < 1800000 ? "within 30 minutes"
                        : "hours later",
            emojiLikely: style.emojiFrequency > 0.3,
            samplePhrases: this.getContactPhrases(contact, 5),
        };
    }

    // ── Analysis Helpers ─────────────────────────────────────────────

    private buildContactStyles(): ContactStyle[] {
        const contacts = new Map<string, MessageRecord[]>();
        for (const msg of this.messages) {
            const list = contacts.get(msg.contact) ?? [];
            list.push(msg);
            contacts.set(msg.contact, list);
        }

        const styles: ContactStyle[] = [];

        for (const [contact, msgs] of contacts) {
            const sent = msgs.filter(m => m.direction === "sent");
            const received = msgs.filter(m => m.direction === "received");

            if (sent.length === 0) continue;

            const avgLen = sent.reduce((s, m) => s + m.text.length, 0) / sent.length;
            const avgWords = sent.reduce((s, m) => s + m.text.split(/\s+/).length, 0) / sent.length;

            // Response times
            const rTimes = sent
                .filter(m => m.responseTimeMs !== undefined)
                .map(m => m.responseTimeMs!)
                .sort((a, b) => a - b);
            const medianRT = rTimes.length > 0 ? rTimes[Math.floor(rTimes.length / 2)]! : 0;

            // Emoji analysis
            const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
            let emojiMsgCount = 0;
            const emojiMap = new Map<string, number>();
            for (const m of sent) {
                const emojis = m.text.match(emojiRegex) ?? [];
                if (emojis.length > 0) emojiMsgCount++;
                for (const e of emojis) emojiMap.set(e, (emojiMap.get(e) ?? 0) + 1);
            }

            // Peak hours
            const hourCounts = new Array(24).fill(0) as number[];
            for (const m of sent) hourCounts[new Date(m.timestamp).getHours()]++;
            const peakHours = hourCounts
                .map((c, h) => ({ h, c }))
                .sort((a, b) => b.c - a.c)
                .slice(0, 3)
                .map(x => x.h);

            // Relationship tier based on message frequency + response speed
            const totalMsgs = sent.length + received.length;
            const hasResponseData = rTimes.length > 0;
            const tier = totalMsgs > 100 ? "inner_circle"
                : (hasResponseData && medianRT < 120000 && totalMsgs > 5) ? "inner_circle"
                    : totalMsgs > 20 ? "regular"
                        : "acquaintance";

            styles.push({
                contact,
                messagesSent: sent.length,
                messagesReceived: received.length,
                avgMessageLength: Math.round(avgLen),
                medianResponseTimeMs: Math.round(medianRT),
                fastestResponseMs: rTimes.length > 0 ? rTimes[0]! : 0,
                slowestResponseMs: rTimes.length > 0 ? rTimes[rTimes.length - 1]! : 0,
                emojiFrequency: Math.round((emojiMsgCount / sent.length) * 100) / 100,
                topEmojis: Array.from(emojiMap.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([e]) => e),
                formalityScore: this.calculateFormality(sent),
                avgWordsPerMessage: Math.round(avgWords * 10) / 10,
                peakHours,
                relationshipTier: tier,
            });
        }

        return styles.sort((a, b) => (b.messagesSent + b.messagesReceived) - (a.messagesSent + a.messagesReceived));
    }

    private calculateFormality(messages: MessageRecord[]): number {
        if (messages.length === 0) return 0.5;

        let formalSignals = 0;
        let casualSignals = 0;

        for (const msg of messages) {
            const text = msg.text.toLowerCase();
            // Formal indicators
            if (/\b(please|thank you|regards|sincerely|dear|kindly)\b/.test(text)) formalSignals++;
            if (/[.!?]$/.test(text.trim())) formalSignals += 0.5;
            if (text[0] === text[0]?.toUpperCase() && /[a-z]/.test(text[0] ?? "")) formalSignals += 0.3;

            // Casual indicators
            if (/\b(lol|haha|lmao|bruh|dude|bro|yeah|yep|nah|gonna|wanna|gotta)\b/.test(text)) casualSignals++;
            if (/(.)\1{2,}/.test(text)) casualSignals += 0.5; // repeated chars like "nooooo"
            if (text === text.toLowerCase() && text.length > 3) casualSignals += 0.3;
            if (/[!?]{2,}/.test(text)) casualSignals += 0.5;
        }

        const total = formalSignals + casualSignals;
        if (total === 0) return 0.5;
        return Math.round((formalSignals / total) * 100) / 100;
    }

    private findCatchphrases(messages: MessageRecord[]): string[] {
        const phraseCounts = new Map<string, number>();
        for (const msg of messages) {
            const words = msg.text.toLowerCase().split(/\s+/);
            // 2-word and 3-word phrases
            for (let i = 0; i < words.length - 1; i++) {
                const bi = `${words[i]} ${words[i + 1]}`;
                if (bi.length > 4) phraseCounts.set(bi, (phraseCounts.get(bi) ?? 0) + 1);
                if (i < words.length - 2) {
                    const tri = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
                    if (tri.length > 6) phraseCounts.set(tri, (phraseCounts.get(tri) ?? 0) + 1);
                }
            }
        }

        return Array.from(phraseCounts.entries())
            .filter(([, count]) => count >= 3) // used at least 3 times
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([phrase]) => phrase);
    }

    private getContactPhrases(contact: string, limit: number): string[] {
        const sent = this.messages
            .filter(m => m.contact === contact && m.direction === "sent")
            .map(m => m.text);
        if (sent.length === 0) return [];
        // Return recent unique messages as examples
        return [...new Set(sent)].slice(-limit);
    }

    // ── Persistence ──────────────────────────────────────────────────

    private loadMessages(): void {
        const file = resolve(this.dataDir, "messages.json");
        if (existsSync(file)) {
            try {
                this.messages = JSON.parse(readFileSync(file, "utf-8")) as MessageRecord[];
            } catch { this.messages = []; }
        }
    }

    private saveMessages(): void {
        const file = resolve(this.dataDir, "messages.json");
        writeFileSync(file, JSON.stringify(this.messages), "utf-8");
    }

    /** Save fingerprint to disk */
    saveFingerprint(): CommunicationFingerprint {
        const fp = this.buildFingerprint();
        const file = resolve(this.dataDir, "fingerprint.json");
        writeFileSync(file, JSON.stringify(fp, null, 2), "utf-8");
        logInfo(`💬 Communication fingerprint saved: ${fp.totalMessages} messages, ${fp.contactStyles.length} contacts`);
        return fp;
    }

    /** Get total messages recorded */
    getMessageCount(): number { return this.messages.length; }

    private emptyFingerprint(): CommunicationFingerprint {
        return {
            avgMessageLength: 0, emojiUsageRate: 0, topEmojis: [],
            overallFormality: 0.5, avgResponseTimeMs: 0, contactStyles: [],
            catchphrases: [], lengthDistribution: { short: 0, medium: 0, long: 0 },
            hourlyVolume: new Array(24).fill(0), totalMessages: 0, generatedAt: Date.now(),
        };
    }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _analyzer: CommunicationAnalyzer | null = null;

export function getCommunicationAnalyzer(): CommunicationAnalyzer {
    if (!_analyzer) _analyzer = new CommunicationAnalyzer();
    return _analyzer;
}

export function resetCommunicationAnalyzer(): void {
    _analyzer = null;
}

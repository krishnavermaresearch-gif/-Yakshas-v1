/**
 * Prompt Injection Guard — Security Filter for Inbound Messages
 */

import { logWarn } from "../logger.js";

const INJECTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/i, label: "instruction-override" },
    { pattern: /forget\s+(all\s+)?(your|previous)\s+(instructions?|rules?|context)/i, label: "forget-instructions" },
    { pattern: /disregard\s+(all\s+)?(previous|your)\s+(instructions?|directives?)/i, label: "disregard-instructions" },
    { pattern: /override\s+(your|the|all)\s+(instructions?|safety|rules?)/i, label: "override-safety" },
    { pattern: /you\s+are\s+(now|actually)\s+(a|an|in)\s+(dev|developer|admin|unrestricted|jailbreak)/i, label: "role-hijack" },
    { pattern: /pretend\s+(you\s+are|to\s+be)\s+(a|an)\s+(unrestricted|unfiltered|evil|hacker)/i, label: "role-pretend" },
    { pattern: /act\s+as\s+(if|though)\s+(you\s+have\s+no|there\s+are\s+no)\s+(restrictions?|rules?)/i, label: "act-unrestricted" },
    { pattern: /enter\s+(dev|developer|debug|admin|god|sudo)\s+mode/i, label: "mode-switch" },
    { pattern: /switch\s+to\s+(unrestricted|unfiltered|uncensored)\s+mode/i, label: "mode-uncensor" },
    { pattern: /DAN\s+(mode|prompt|jailbreak)/i, label: "DAN-jailbreak" },
    { pattern: /what\s+(is|are)\s+your\s+(system|initial|original)\s+(prompt|instructions?)/i, label: "prompt-extraction" },
    { pattern: /show\s+me\s+your\s+(system|hidden|secret)\s+(prompt|instructions?)/i, label: "show-prompt" },
    { pattern: /repeat\s+(your|the)\s+(system|initial|full)\s+(prompt|instructions?)/i, label: "repeat-prompt" },
    { pattern: /base64\s*(decode|encoded)/i, label: "base64-obfuscation" },
    { pattern: /\beval\s*\(/i, label: "eval-injection" },
    { pattern: /\bexec\s*\(/i, label: "exec-injection" },
    { pattern: /this\s+is\s+(a|an)\s+(test|emergency|authorized)\s+(scenario|situation|override)/i, label: "social-engineering" },
    { pattern: /the\s+(admin|developer|owner)\s+(said|told|wants|authorized)\s+(you\s+to|me\s+to)/i, label: "authority-spoof" },
    { pattern: /I\s+am\s+(the|your|an?)\s+(admin|developer|creator|owner|root)/i, label: "identity-spoof" },
    { pattern: /\[SYSTEM\]/i, label: "fake-system-tag" },
    { pattern: /\[INST\]/i, label: "fake-inst-tag" },
    { pattern: /<<SYS>>/i, label: "fake-sys-tag" },
    { pattern: /<\|im_start\|>system/i, label: "fake-im-start" },
];

function hasStructuralAnomalies(message: string): string | null {
    if (message.length > 5000) return "Message exceeds 5000 characters (possible prompt stuffing)";
    if (/[\u200B\u200C\u200D\u200E\u200F\u2060\u2061\u2062\u2063\u2064\uFEFF]/.test(message)) return "Contains invisible Unicode characters";
    if ((message.match(/\n/g) || []).length > 50) return "Excessive line breaks (possible context overflow)";
    return null;
}

export interface TrustedSender {
    type: "telegram" | "whatsapp" | "slack" | "discord" | "email" | "imessage";
    id: string;
}

export function isTrustedSender(senderType: TrustedSender["type"], senderId: string): boolean {
    const raw = process.env.TRUSTED_SENDERS?.trim();
    if (!raw) return true; // Open mode if no allowlist
    try {
        return raw.split(",").some((entry) => {
            const [type, id] = entry.trim().split(":");
            return type === senderType && id === senderId;
        });
    } catch { return false; }
}

export interface GuardResult { safe: boolean; blocked: boolean; reason?: string; matchedLabel?: string; }

export function analyzeMessage(message: string): GuardResult {
    for (const { pattern, label } of INJECTION_PATTERNS) {
        if (pattern.test(message)) {
            logWarn(`🛡️ INJECTION DETECTED [${label}]: "${message.slice(0, 100)}..."`);
            return { safe: false, blocked: true, reason: `Prompt injection: ${label}`, matchedLabel: label };
        }
    }
    const issue = hasStructuralAnomalies(message);
    if (issue) { logWarn(`🛡️ ANOMALY: ${issue}`); return { safe: false, blocked: true, reason: issue }; }
    return { safe: true, blocked: false };
}

export function guardIncomingMessage(message: string, senderType: TrustedSender["type"], senderId: string): GuardResult {
    if (!isTrustedSender(senderType, senderId)) {
        logWarn(`🛡️ UNTRUSTED: ${senderType}:${senderId}`);
        return { safe: false, blocked: true, reason: `Untrusted sender: ${senderType}:${senderId}` };
    }
    return analyzeMessage(message);
}

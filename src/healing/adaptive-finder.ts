/**
 * Adaptive Finder — three-tier fallback chain for finding UI elements.
 *
 * Strategy:
 *  1. Standard selector (resource-id, text, content-desc) — fast, fragile
 *  2. UI Map alternatives (stored fallback selectors) — fast, resilient
 *  3. VLM visual search (screenshot → LLM vision) — slow, most robust
 *
 * When a higher-tier method fails, it falls through to the next.
 * Successful finds update the UI map for future use.
 */

import { logInfo, logDebug, logWarn } from "../logger.js";
import { getUIMapStore, type UISelector } from "./ui-map-store.js";
import { getVLMExplorer } from "./vlm-explorer.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FindResult {
    found: boolean;
    /** Method that found it */
    method: "standard" | "ui_map" | "vlm" | "none";
    /** Coordinates to tap */
    coordinates?: { x: number; y: number };
    /** Selector that worked */
    selector?: UISelector;
    /** Confidence score */
    confidence: number;
    /** How the element was identified */
    description: string;
}

export interface StandardFinder {
    /** Try to find element using standard selectors. Returns coordinates if found. */
    findByResourceId(resourceId: string): Promise<{ x: number; y: number } | null>;
    findByText(text: string): Promise<{ x: number; y: number } | null>;
    findByContentDesc(desc: string): Promise<{ x: number; y: number } | null>;
    /** Get current screenshot as base64 */
    getScreenshot(): Promise<string | null>;
    /** Get screen dimensions */
    getScreenSize(): { width: number; height: number };
}

// ─── Adaptive Finder ─────────────────────────────────────────────────────────

export class AdaptiveFinder {
    private standardFinder: StandardFinder | null = null;

    /** Set the standard finder implementation (ADB-based) */
    setStandardFinder(finder: StandardFinder): void {
        this.standardFinder = finder;
    }

    /**
     * Find a UI element using the three-tier fallback chain.
     *
     * @param appPackage - Android package name (e.g., "com.instagram.android")
     * @param elementKey - Human-readable element name (e.g., "Post button")
     * @param primarySelector - The selector to try first
     */
    async findElement(
        appPackage: string,
        elementKey: string,
        primarySelector: { type: "resource_id" | "text" | "content_desc"; value: string },
    ): Promise<FindResult> {
        const uiMap = getUIMapStore();

        // ─── Tier 1: Standard selector ───────────────────────────────────
        logDebug(`Tier 1: trying ${primarySelector.type}="${primarySelector.value}"`);
        const tier1Result = await this.tryStandardSelector(primarySelector);

        if (tier1Result) {
            // Success! Record in UI map
            uiMap.recordSuccess(appPackage, elementKey, {
                type: primarySelector.type,
                value: primarySelector.value,
                confidence: 1.0,
                lastUsed: Date.now(),
            }, tier1Result);

            return {
                found: true,
                method: "standard",
                coordinates: tier1Result,
                confidence: 1.0,
                description: `Found via ${primarySelector.type}`,
            };
        }

        // Record the failure
        uiMap.recordFailure(appPackage, elementKey, primarySelector.type, primarySelector.value);
        logDebug(`Tier 1 failed for "${elementKey}"`);

        // ─── Tier 2: UI Map alternatives ─────────────────────────────────
        const alternativeSelectors = uiMap.getSelectors(appPackage, elementKey);
        for (const alt of alternativeSelectors) {
            if (alt.type === "visual" || alt.type === "coordinates") continue; // handled in tier 3
            if (alt.type === primarySelector.type && alt.value === primarySelector.value) continue; // already tried

            logDebug(`Tier 2: trying ${alt.type}="${alt.value}" (confidence=${alt.confidence.toFixed(2)})`);
            const tier2Result = await this.tryStandardSelector({ type: alt.type, value: alt.value });

            if (tier2Result) {
                uiMap.recordSuccess(appPackage, elementKey, alt, tier2Result);
                return {
                    found: true,
                    method: "ui_map",
                    coordinates: tier2Result,
                    selector: alt,
                    confidence: alt.confidence,
                    description: `Found via UI map (${alt.type})`,
                };
            }
        }

        logDebug(`Tier 2 failed for "${elementKey}"`);

        // ─── Tier 3: VLM visual search ───────────────────────────────────
        const screenshot = await this.standardFinder?.getScreenshot();
        if (screenshot) {
            logInfo(`Tier 3: using VLM to visually locate "${elementKey}"`);
            const vlm = getVLMExplorer();
            const screenSize = this.standardFinder?.getScreenSize() ?? { width: 1080, height: 2400 };
            const vlmResult = await vlm.findElement(
                screenshot,
                elementKey,
                screenSize.width,
                screenSize.height,
            );

            if (vlmResult.found && vlmResult.coordinates) {
                // Store the VLM result in UI map for future use
                uiMap.recordSuccess(appPackage, elementKey, {
                    type: "visual",
                    value: elementKey,
                    confidence: vlmResult.confidence,
                    lastUsed: Date.now(),
                }, vlmResult.coordinates);
                uiMap.setVisualDescription(appPackage, elementKey, vlmResult.description);

                return {
                    found: true,
                    method: "vlm",
                    coordinates: vlmResult.coordinates,
                    confidence: vlmResult.confidence,
                    description: `Found via VLM: ${vlmResult.description}`,
                };
            }
        }

        logWarn(`All tiers failed to find "${elementKey}" in ${appPackage}`);
        return {
            found: false,
            method: "none",
            confidence: 0,
            description: `Element "${elementKey}" not found by any method`,
        };
    }

    // ── Private ──────────────────────────────────────────────────────────

    private async tryStandardSelector(
        selector: { type: string; value: string },
    ): Promise<{ x: number; y: number } | null> {
        if (!this.standardFinder) return null;

        switch (selector.type) {
            case "resource_id":
                return this.standardFinder.findByResourceId(selector.value);
            case "text":
                return this.standardFinder.findByText(selector.value);
            case "content_desc":
                return this.standardFinder.findByContentDesc(selector.value);
            default:
                return null;
        }
    }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _finder: AdaptiveFinder | null = null;

export function getAdaptiveFinder(): AdaptiveFinder {
    if (!_finder) _finder = new AdaptiveFinder();
    return _finder;
}

export function resetAdaptiveFinder(): void {
    _finder = null;
}

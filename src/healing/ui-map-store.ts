/**
 * UI Map Store — local database of app UI element mappings.
 *
 * When the agent learns where a button/element is in an app, it stores:
 *  - App package + version
 *  - Element descriptor (text, resource-id, content-desc)
 *  - XPath / selector
 *  - Visual anchor description (for VLM fallback)
 *  - Coordinates (last known)
 *
 * When a UI element can't be found, this store provides alternative selectors.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { logInfo, logDebug } from "../logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UIElementMapping {
    /** Unique composite key: app_package:element_key */
    id: string;
    appPackage: string;
    appVersion?: string;
    /** Primary identifier (e.g., "Settings button") */
    elementKey: string;
    /** Known selectors in priority order */
    selectors: UISelector[];
    /** Visual description for VLM fallback */
    visualDescription?: string;
    /** Last known coordinates */
    lastCoordinates?: { x: number; y: number };
    /** How many times this mapping was used successfully */
    successCount: number;
    /** How many times this mapping failed */
    failCount: number;
    /** Last updated */
    lastUpdated: number;
}

export interface UISelector {
    type: "resource_id" | "text" | "content_desc" | "xpath" | "coordinates" | "visual";
    value: string;
    /** Confidence: how reliable is this selector (0-1) */
    confidence: number;
    lastUsed: number;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export class UIMapStore {
    private mappings = new Map<string, UIElementMapping>();
    private readonly dataFile: string;

    constructor(dataDir?: string) {
        const dir = dataDir ?? resolve(process.cwd(), "data");
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        this.dataFile = resolve(dir, "ui-maps.json");
        this.load();
    }

    /** Find known selectors for an element in an app */
    findElement(appPackage: string, elementKey: string): UIElementMapping | undefined {
        const id = this.makeId(appPackage, elementKey);
        return this.mappings.get(id);
    }

    /** Get all alternative selectors for an element, sorted by confidence */
    getSelectors(appPackage: string, elementKey: string): UISelector[] {
        const mapping = this.findElement(appPackage, elementKey);
        if (!mapping) return [];
        return [...mapping.selectors].sort((a, b) => b.confidence - a.confidence);
    }

    /** Record a successful element interaction */
    recordSuccess(appPackage: string, elementKey: string, selector: UISelector, coordinates?: { x: number; y: number }): void {
        const id = this.makeId(appPackage, elementKey);
        let mapping = this.mappings.get(id);

        if (!mapping) {
            mapping = {
                id,
                appPackage,
                elementKey,
                selectors: [],
                successCount: 0,
                failCount: 0,
                lastUpdated: Date.now(),
            };
            this.mappings.set(id, mapping);
        }

        // Update or add selector
        const existing = mapping.selectors.find(s => s.type === selector.type && s.value === selector.value);
        if (existing) {
            existing.confidence = Math.min(1, existing.confidence + 0.1);
            existing.lastUsed = Date.now();
        } else {
            mapping.selectors.push({ ...selector, lastUsed: Date.now() });
        }

        mapping.successCount++;
        mapping.lastUpdated = Date.now();
        if (coordinates) mapping.lastCoordinates = coordinates;

        this.save();
        logDebug(`UI map: recorded success for ${elementKey} in ${appPackage}`);
    }

    /** Record a failed element interaction — decreases confidence */
    recordFailure(appPackage: string, elementKey: string, selectorType: string, selectorValue: string): void {
        const id = this.makeId(appPackage, elementKey);
        const mapping = this.mappings.get(id);
        if (!mapping) return;

        const selector = mapping.selectors.find(s => s.type === selectorType && s.value === selectorValue);
        if (selector) {
            selector.confidence = Math.max(0, selector.confidence - 0.3);
        }

        mapping.failCount++;
        mapping.lastUpdated = Date.now();
        this.save();
        logDebug(`UI map: recorded failure for ${elementKey} in ${appPackage}`);
    }

    /** Add a visual description for VLM fallback */
    setVisualDescription(appPackage: string, elementKey: string, description: string): void {
        const id = this.makeId(appPackage, elementKey);
        let mapping = this.mappings.get(id);
        if (!mapping) {
            mapping = {
                id, appPackage, elementKey, selectors: [],
                successCount: 0, failCount: 0, lastUpdated: Date.now(),
            };
            this.mappings.set(id, mapping);
        }
        mapping.visualDescription = description;
        mapping.lastUpdated = Date.now();
        this.save();
    }

    /** Get all mappings for an app */
    getAppMappings(appPackage: string): UIElementMapping[] {
        return Array.from(this.mappings.values()).filter(m => m.appPackage === appPackage);
    }

    /** Get total mapping stats */
    getStats(): { totalMappings: number; totalApps: number; avgConfidence: number } {
        const apps = new Set<string>();
        let totalConfidence = 0;
        let selectorCount = 0;

        for (const m of this.mappings.values()) {
            apps.add(m.appPackage);
            for (const s of m.selectors) {
                totalConfidence += s.confidence;
                selectorCount++;
            }
        }

        return {
            totalMappings: this.mappings.size,
            totalApps: apps.size,
            avgConfidence: selectorCount > 0 ? totalConfidence / selectorCount : 0,
        };
    }

    // ── Private ──────────────────────────────────────────────────────────

    private makeId(appPackage: string, elementKey: string): string {
        return `${appPackage}:${elementKey.toLowerCase().replace(/\s+/g, "_")}`;
    }

    private load(): void {
        try {
            if (existsSync(this.dataFile)) {
                const data = JSON.parse(readFileSync(this.dataFile, "utf-8")) as UIElementMapping[];
                this.mappings = new Map(data.map(m => [m.id, m]));
                if (this.mappings.size > 0) {
                    logInfo(`Loaded ${this.mappings.size} UI mappings`);
                }
            }
        } catch { /* ignore */ }
    }

    private save(): void {
        writeFileSync(this.dataFile, JSON.stringify(Array.from(this.mappings.values()), null, 2), "utf-8");
    }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _store: UIMapStore | null = null;

export function getUIMapStore(): UIMapStore {
    if (!_store) _store = new UIMapStore();
    return _store;
}

export function resetUIMapStore(): void {
    _store = null;
}

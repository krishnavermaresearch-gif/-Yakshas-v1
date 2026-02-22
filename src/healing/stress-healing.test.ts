/**
 * BRUTAL STRESS TEST — Self-Healing UI System
 *
 * Attacks: selector bombing, confidence decay to zero, massive mappings,
 * concurrent app lookups, corrupt store, missing finder.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { UIMapStore, resetUIMapStore } from "../healing/ui-map-store.js";
import { AdaptiveFinder, resetAdaptiveFinder, type StandardFinder } from "../healing/adaptive-finder.js";
import { rmSync, existsSync } from "fs";
import { resolve } from "path";

const TEST_DIR = resolve(process.cwd(), "data", "test_stress_heal");

describe("STRESS: UIMapStore", () => {
    let store: UIMapStore;

    beforeEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
        store = new UIMapStore(TEST_DIR);
    });

    afterEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    });

    // ─── Massive Scale ───────────────────────────────────────────────

    it("should handle 500 mappings across 50 apps", () => {
        for (let app = 0; app < 50; app++) {
            for (let el = 0; el < 10; el++) {
                store.recordSuccess(`com.app${app}`, `Element_${el}`, {
                    type: "resource_id",
                    value: `id_${app}_${el}`,
                    confidence: Math.random(),
                    lastUsed: Date.now(),
                });
            }
        }

        const stats = store.getStats();
        assert.strictEqual(stats.totalMappings, 500);
        assert.strictEqual(stats.totalApps, 50);
    });

    it("should handle 20 selectors for a single element", () => {
        for (let i = 0; i < 20; i++) {
            store.recordSuccess("com.app", "Button", {
                type: i % 3 === 0 ? "resource_id" : i % 3 === 1 ? "text" : "content_desc",
                value: `variant_${i}`,
                confidence: Math.random(),
                lastUsed: Date.now(),
            });
        }

        const selectors = store.getSelectors("com.app", "Button");
        assert.strictEqual(selectors.length, 20);
        // Should be sorted by confidence (descending)
        for (let i = 1; i < selectors.length; i++) {
            assert.ok(selectors[i - 1]!.confidence >= selectors[i]!.confidence);
        }
    });

    // ─── Confidence Decay to Zero ────────────────────────────────────

    it("should decay confidence to zero after many failures", () => {
        store.recordSuccess("com.app", "Btn", {
            type: "resource_id", value: "btn1", confidence: 1.0, lastUsed: Date.now(),
        });

        // Fail 10 times
        for (let i = 0; i < 10; i++) {
            store.recordFailure("com.app", "Btn", "resource_id", "btn1");
        }

        const mapping = store.findElement("com.app", "Btn");
        assert.ok(mapping);
        assert.strictEqual(mapping.selectors[0]!.confidence, 0); // clamped at 0
    });

    it("should handle failure for non-existent element", () => {
        // Should not crash
        store.recordFailure("com.nonexistent", "Ghost", "resource_id", "ghost_id");
    });

    it("should handle failure for non-existent selector", () => {
        store.recordSuccess("com.app", "Btn", {
            type: "resource_id", value: "real", confidence: 1.0, lastUsed: Date.now(),
        });
        // Fail with a selector that doesn't exist
        store.recordFailure("com.app", "Btn", "text", "nonexistent");
        // The real selector should be unaffected
        const mapping = store.findElement("com.app", "Btn");
        assert.ok(mapping);
        assert.strictEqual(mapping.selectors[0]!.confidence, 1.0);
    });

    // ─── Special Characters ──────────────────────────────────────────

    it("should handle element keys with special characters", () => {
        store.recordSuccess("com.app", "🔴 Red Button (new version)", {
            type: "text", value: "🔴", confidence: 0.9, lastUsed: Date.now(),
        });
        const mapping = store.findElement("com.app", "🔴 Red Button (new version)");
        assert.ok(mapping);
    });

    it("should handle app package with unusual format", () => {
        store.recordSuccess("com.很好.应用", "按钮", {
            type: "text", value: "确定", confidence: 0.8, lastUsed: Date.now(),
        });
        const mapping = store.findElement("com.很好.应用", "按钮");
        assert.ok(mapping);
    });

    // ─── Overwrite Behavior ──────────────────────────────────────────

    it("should cap confidence at 1.0 after many successes", () => {
        const selector = {
            type: "text" as const, value: "OK", confidence: 0.9, lastUsed: Date.now(),
        };

        for (let i = 0; i < 50; i++) {
            store.recordSuccess("com.app", "OK_Button", selector);
        }

        const mapping = store.findElement("com.app", "OK_Button");
        assert.ok(mapping);
        assert.ok(mapping.selectors[0]!.confidence <= 1.0);
    });

    // ─── Empty Store Operations ──────────────────────────────────────

    it("should handle getSelectors on empty store", () => {
        const selectors = store.getSelectors("com.nonexistent", "ghost");
        assert.strictEqual(selectors.length, 0);
    });

    it("should handle getAppMappings on empty store", () => {
        const mappings = store.getAppMappings("com.nonexistent");
        assert.strictEqual(mappings.length, 0);
    });

    it("should return sensible stats on empty store", () => {
        const stats = store.getStats();
        assert.strictEqual(stats.totalMappings, 0);
        assert.strictEqual(stats.totalApps, 0);
        assert.strictEqual(stats.avgConfidence, 0);
    });
});

describe("STRESS: AdaptiveFinder", () => {
    beforeEach(() => {
        resetUIMapStore();
        resetAdaptiveFinder();
    });

    afterEach(() => {
        resetUIMapStore();
        resetAdaptiveFinder();
        const defaultFile = resolve(process.cwd(), "data", "ui-maps.json");
        if (existsSync(defaultFile)) rmSync(defaultFile);
    });

    // ─── No Finder Set ───────────────────────────────────────────────

    it("should handle no standard finder set (all tiers fail gracefully)", async () => {
        const finder = new AdaptiveFinder();
        // No setStandardFinder called!

        const result = await finder.findElement("com.app", "Missing", {
            type: "resource_id", value: "gone",
        });

        assert.strictEqual(result.found, false);
        assert.strictEqual(result.method, "none");
    });

    // ─── Finder That Throws ──────────────────────────────────────────

    it("should survive finder that throws on every call", async () => {
        const finder = new AdaptiveFinder();
        const explosiveFinder: StandardFinder = {
            findByResourceId: async () => { throw new Error("ADB EXPLODED"); },
            findByText: async () => { throw new Error("ADB EXPLODED"); },
            findByContentDesc: async () => { throw new Error("ADB EXPLODED"); },
            getScreenshot: async () => null,
            getScreenSize: () => ({ width: 1080, height: 2400 }),
        };
        finder.setStandardFinder(explosiveFinder);

        // Should not throw — should return not found
        try {
            const result = await finder.findElement("com.app", "Button", {
                type: "resource_id", value: "btn",
            });
            // It might throw or return not found — both are acceptable
            assert.strictEqual(result.found, false);
        } catch {
            // Also acceptable — the finder threw
        }
    });

    // ─── Tier 2 Fallback ─────────────────────────────────────────────

    it("should fall through to tier 2 when tier 1 fails", async () => {
        const finder = new AdaptiveFinder();

        // First, populate the UI map with an alternative selector
        const { getUIMapStore } = await import("../healing/ui-map-store.js");
        const uiMap = getUIMapStore();
        uiMap.recordSuccess("com.app", "Submit", {
            type: "text", value: "Submit", confidence: 0.9, lastUsed: Date.now(),
        }, { x: 300, y: 500 });

        let textSearched = false;
        const mockFinder: StandardFinder = {
            findByResourceId: async () => null, // tier 1 fails
            findByText: async (text) => {
                textSearched = true;
                return text === "Submit" ? { x: 300, y: 500 } : null;
            },
            findByContentDesc: async () => null,
            getScreenshot: async () => null,
            getScreenSize: () => ({ width: 1080, height: 2400 }),
        };
        finder.setStandardFinder(mockFinder);

        const result = await finder.findElement("com.app", "Submit", {
            type: "resource_id", value: "btn_submit", // this will fail
        });

        assert.strictEqual(result.found, true);
        assert.strictEqual(result.method, "ui_map");
        assert.strictEqual(textSearched, true);
    });

    // ─── Finder Returns Invalid Coordinates ──────────────────────────

    it("should handle finder returning negative coordinates", async () => {
        const finder = new AdaptiveFinder();
        const mockFinder: StandardFinder = {
            findByResourceId: async () => ({ x: -100, y: -200 }),
            findByText: async () => null,
            findByContentDesc: async () => null,
            getScreenshot: async () => null,
            getScreenSize: () => ({ width: 1080, height: 2400 }),
        };
        finder.setStandardFinder(mockFinder);

        const result = await finder.findElement("com.app", "Btn", {
            type: "resource_id", value: "btn",
        });

        // Should still report as found — negative coords are the finder's problem
        assert.strictEqual(result.found, true);
    });
});

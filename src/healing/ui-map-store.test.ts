/**
 * Tests for UI Map Store + Adaptive Finder (Self-Healing UI)
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { UIMapStore, resetUIMapStore } from "../healing/ui-map-store.js";
import { AdaptiveFinder, resetAdaptiveFinder, type StandardFinder } from "../healing/adaptive-finder.js";
import { rmSync, existsSync } from "fs";
import { resolve } from "path";

const TEST_DIR = resolve(process.cwd(), "data", "test_healing");

describe("UIMapStore", () => {
    let store: UIMapStore;

    beforeEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
        store = new UIMapStore(TEST_DIR);
    });

    afterEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    });

    it("should record a successful element interaction", () => {
        store.recordSuccess("com.instagram.android", "Post button", {
            type: "resource_id",
            value: "com.instagram.android:id/creation_tab",
            confidence: 1.0,
            lastUsed: Date.now(),
        }, { x: 540, y: 2200 });

        const mapping = store.findElement("com.instagram.android", "Post button");
        assert.ok(mapping);
        assert.strictEqual(mapping.appPackage, "com.instagram.android");
        assert.strictEqual(mapping.selectors.length, 1);
        assert.strictEqual(mapping.successCount, 1);
        assert.deepStrictEqual(mapping.lastCoordinates, { x: 540, y: 2200 });
    });

    it("should increase confidence on repeated successes", () => {
        const selector = {
            type: "text" as const,
            value: "Settings",
            confidence: 0.5,
            lastUsed: Date.now(),
        };

        store.recordSuccess("com.app", "Settings", selector);
        store.recordSuccess("com.app", "Settings", selector);
        store.recordSuccess("com.app", "Settings", selector);

        const mapping = store.findElement("com.app", "Settings");
        assert.ok(mapping);
        assert.ok(mapping.selectors[0]!.confidence >= 0.7);
    });

    it("should decrease confidence on failures", () => {
        store.recordSuccess("com.app", "Button", {
            type: "resource_id",
            value: "btn_main",
            confidence: 1.0,
            lastUsed: Date.now(),
        });

        store.recordFailure("com.app", "Button", "resource_id", "btn_main");

        const mapping = store.findElement("com.app", "Button");
        assert.ok(mapping);
        assert.ok(mapping.selectors[0]!.confidence < 1.0);
        assert.strictEqual(mapping.failCount, 1);
    });

    it("should return selectors sorted by confidence", () => {
        store.recordSuccess("com.app", "Button", {
            type: "resource_id", value: "btn1", confidence: 0.5, lastUsed: Date.now(),
        });
        store.recordSuccess("com.app", "Button", {
            type: "text", value: "Click me", confidence: 0.9, lastUsed: Date.now(),
        });
        store.recordSuccess("com.app", "Button", {
            type: "content_desc", value: "action", confidence: 0.3, lastUsed: Date.now(),
        });

        const selectors = store.getSelectors("com.app", "Button");
        assert.strictEqual(selectors.length, 3);
        assert.ok(selectors[0]!.confidence >= selectors[1]!.confidence);
        assert.ok(selectors[1]!.confidence >= selectors[2]!.confidence);
    });

    it("should set and retrieve visual descriptions", () => {
        store.setVisualDescription("com.app", "Login", "Blue button with white text 'Log In' at bottom of screen");
        const mapping = store.findElement("com.app", "Login");
        assert.ok(mapping);
        assert.strictEqual(mapping.visualDescription, "Blue button with white text 'Log In' at bottom of screen");
    });

    it("should compute stats correctly", () => {
        store.recordSuccess("com.app1", "Btn", {
            type: "text", value: "A", confidence: 0.8, lastUsed: Date.now(),
        });
        store.recordSuccess("com.app2", "Btn", {
            type: "text", value: "B", confidence: 0.6, lastUsed: Date.now(),
        });

        const stats = store.getStats();
        assert.strictEqual(stats.totalMappings, 2);
        assert.strictEqual(stats.totalApps, 2);
        assert.ok(stats.avgConfidence > 0.5, `avgConfidence ${stats.avgConfidence} should be > 0.5`);
        assert.ok(stats.avgConfidence < 0.9, `avgConfidence ${stats.avgConfidence} should be < 0.9`);
    });

    it("should persist and reload mappings", () => {
        store.recordSuccess("com.app", "Element", {
            type: "resource_id", value: "el1", confidence: 1.0, lastUsed: Date.now(),
        });

        const store2 = new UIMapStore(TEST_DIR);
        const mapping = store2.findElement("com.app", "Element");
        assert.ok(mapping);
        assert.strictEqual(mapping.selectors.length, 1);
    });
});

describe("AdaptiveFinder", () => {
    beforeEach(() => {
        resetUIMapStore();
        resetAdaptiveFinder();
    });

    afterEach(() => {
        resetUIMapStore();
        resetAdaptiveFinder();
        // Clean up any ui-maps.json created in default data/ dir by the global singleton
        const defaultFile = resolve(process.cwd(), "data", "ui-maps.json");
        if (existsSync(defaultFile)) rmSync(defaultFile);
    });

    it("should find element via standard selector (tier 1)", async () => {
        const finder = new AdaptiveFinder();
        const mockStandard: StandardFinder = {
            findByResourceId: async (id) => id === "btn_main" ? { x: 100, y: 200 } : null,
            findByText: async () => null,
            findByContentDesc: async () => null,
            getScreenshot: async () => null,
            getScreenSize: () => ({ width: 1080, height: 2400 }),
        };
        finder.setStandardFinder(mockStandard);

        const result = await finder.findElement("com.app", "Main button", {
            type: "resource_id",
            value: "btn_main",
        });

        assert.strictEqual(result.found, true);
        assert.strictEqual(result.method, "standard");
        assert.deepStrictEqual(result.coordinates, { x: 100, y: 200 });
        assert.strictEqual(result.confidence, 1.0);
    });

    it("should return not found when all tiers fail", async () => {
        const finder = new AdaptiveFinder();
        const mockStandard: StandardFinder = {
            findByResourceId: async () => null,
            findByText: async () => null,
            findByContentDesc: async () => null,
            getScreenshot: async () => null, // No screenshot → VLM can't run
            getScreenSize: () => ({ width: 1080, height: 2400 }),
        };
        finder.setStandardFinder(mockStandard);

        const result = await finder.findElement("com.app", "Missing button", {
            type: "resource_id",
            value: "nonexistent",
        });

        assert.strictEqual(result.found, false);
        assert.strictEqual(result.method, "none");
    });
});

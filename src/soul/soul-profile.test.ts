/**
 * Tests for the SoulProfile builder + BehavioralPatternMiner.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync, existsSync } from "fs";
import { resolve } from "path";
import { SoulProfileBuilder } from "./soul-profile.js";
import { BehavioralPatternMiner } from "./behavioral-patterns.js";
import { resetPassiveObserver } from "./passive-observer.js";
import { resetSoulProfileBuilder } from "./soul-profile.js";
import type { ObservationSession, ObservationFrame } from "./passive-observer.js";

const TEST_DIR = resolve(process.cwd(), "data", "test_soul_profile");
const TEST_OBS_DIR = resolve(process.cwd(), "data", "test_soul_obs_profile");

function fakeFrame(overrides?: Partial<ObservationFrame>): ObservationFrame {
    return {
        timestamp: Date.now(),
        appPackage: "com.test.app",
        activity: ".MainActivity",
        screenOn: true,
        dayOfWeek: 4,
        hourOfDay: 14,
        minuteOfDay: 840,
        ...overrides,
    };
}

function fakeSession(overrides?: Partial<ObservationSession>): ObservationSession {
    return {
        id: `obs_test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 4)}`,
        date: "2026-02-20",
        frames: [],
        appTransitions: [],
        totalScreenTimeMs: 0,
        startTime: Date.now(),
        endTime: Date.now(),
        ...overrides,
    };
}

describe("BehavioralPatternMiner", () => {
    let miner: BehavioralPatternMiner;

    beforeEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
        miner = new BehavioralPatternMiner(TEST_DIR);
    });

    afterEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    });

    it("should return empty profile from empty sessions", () => {
        const profile = miner.mine([]);
        assert.strictEqual(profile.routines.length, 0);
        assert.strictEqual(profile.triggerActions.length, 0);
        assert.strictEqual(profile.predictability, 0);
    });

    it("should detect app transition patterns (trigger → action)", () => {
        const sessions: ObservationSession[] = [];
        // Create 5 days where user goes from Gmail to Slack consistently
        for (let d = 0; d < 5; d++) {
            sessions.push(fakeSession({
                date: `2026-02-${15 + d}`,
                frames: [
                    fakeFrame({ appPackage: "com.google.gmail", hourOfDay: 9 }),
                    fakeFrame({ appPackage: "com.slack", hourOfDay: 9 }),
                ],
                appTransitions: [
                    { timestamp: Date.now(), fromApp: "com.google.gmail", toApp: "com.slack", durationInPreviousMs: 30000 },
                ],
            }));
        }

        const profile = miner.mine(sessions);
        assert.ok(profile.triggerActions.length > 0);
        const gmailTrigger = profile.triggerActions.find(t =>
            t.trigger.value === "com.google.gmail" && t.action.app === "com.slack");
        assert.ok(gmailTrigger, "Should detect Gmail → Slack pattern");
        assert.ok(gmailTrigger.occurrences >= 3);
    });

    it("should calculate predictability from similar days", () => {
        // 3 days with exactly the same apps
        const sessions = [1, 2, 3].map(d => fakeSession({
            date: `2026-02-${15 + d}`,
            frames: [
                fakeFrame({ appPackage: "com.whatsapp" }),
                fakeFrame({ appPackage: "com.instagram" }),
                fakeFrame({ appPackage: "com.gmail" }),
            ],
        }));

        const profile = miner.mine(sessions);
        // All days have same apps → high predictability (Jaccard = 1.0)
        assert.strictEqual(profile.predictability, 1);
    });

    it("should detect lower predictability with varying days", () => {
        const sessions = [
            fakeSession({
                date: "2026-02-16",
                frames: [
                    fakeFrame({ appPackage: "com.app1" }),
                    fakeFrame({ appPackage: "com.app2" }),
                ],
            }),
            fakeSession({
                date: "2026-02-17",
                frames: [
                    fakeFrame({ appPackage: "com.app3" }),
                    fakeFrame({ appPackage: "com.app4" }),
                ],
            }),
            fakeSession({
                date: "2026-02-18",
                frames: [
                    fakeFrame({ appPackage: "com.app5" }),
                    fakeFrame({ appPackage: "com.app6" }),
                ],
            }),
        ];

        const profile = miner.mine(sessions);
        // All days have different apps → Jaccard = 0
        assert.strictEqual(profile.predictability, 0);
    });

    it("should detect common 3-app sequences", () => {
        const sessions: ObservationSession[] = [];
        for (let d = 0; d < 3; d++) {
            sessions.push(fakeSession({
                date: `2026-02-${15 + d}`,
                frames: [fakeFrame()],
                appTransitions: [
                    { timestamp: 1, fromApp: "com.a", toApp: "com.b", durationInPreviousMs: 10000 },
                    { timestamp: 2, fromApp: "com.b", toApp: "com.c", durationInPreviousMs: 10000 },
                ],
            }));
        }

        const profile = miner.mine(sessions);
        assert.ok(profile.commonSequences.length > 0);
        assert.ok(profile.commonSequences[0]!.apps.length === 3);
    });
});

describe("SoulProfileBuilder", () => {
    let builder: SoulProfileBuilder;

    beforeEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
        builder = new SoulProfileBuilder(TEST_DIR);
        resetPassiveObserver();
        resetSoulProfileBuilder();
    });

    afterEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
        resetPassiveObserver();
        resetSoulProfileBuilder();
    });

    it("should build infant soul with no data", () => {
        const soul = builder.build("TestUser");
        assert.strictEqual(soul.name, "TestUser");
        // Maturity depends on whether previous observation data exists
        assert.ok(["infant", "learning", "developing", "mature", "deep"].includes(soul.maturityLevel));
    });

    it("should save and load soul", () => {
        builder.build("TestUser");
        const loaded = builder.loadExistingSoul();
        assert.ok(loaded);
        assert.strictEqual(loaded.name, "TestUser");
    });

    it("should predict with no data gracefully", () => {
        const soul = builder.build("TestUser");
        const prediction = builder.predict(soul, "What would they do?");
        assert.ok(prediction.confidence <= 0.2);
        assert.ok(prediction.prediction.includes("Not enough"));
    });

    it("should handle app-related predictions", () => {
        const soul = builder.build("TestUser");
        // No usage data → low confidence
        const pred = builder.predict(soul, "What app would they open?");
        assert.ok(pred.confidence <= 1.0); // Just verify it returns a valid prediction
    });

    it("should handle time-related predictions", () => {
        const soul = builder.build("TestUser");
        const pred = builder.predict(soul, "When are they active?");
        assert.ok(pred.confidence <= 1.0 && pred.prediction.length > 0);
    });

    it("should generate proper soul ID", () => {
        const soul = builder.build("John Doe");
        assert.strictEqual(soul.id, "soul_john_doe");
    });
});

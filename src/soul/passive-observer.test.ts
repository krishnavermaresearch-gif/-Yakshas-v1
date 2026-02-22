/**
 * Tests for the PassiveObserver and AppUsageTracker.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { PassiveObserver, type ObservationSession, type ObservationFrame } from "./passive-observer.js";
import { AppUsageTracker } from "./app-usage-tracker.js";

const TEST_DIR = resolve(process.cwd(), "data", "test_soul_obs");

// Helper to build a fake observation session
function fakeSession(overrides?: Partial<ObservationSession>): ObservationSession {
    return {
        id: `obs_test_${Date.now().toString(36)}`,
        date: "2026-02-20",
        frames: [],
        appTransitions: [],
        totalScreenTimeMs: 0,
        startTime: Date.now(),
        endTime: Date.now(),
        ...overrides,
    };
}

function fakeFrame(overrides?: Partial<ObservationFrame>): ObservationFrame {
    return {
        timestamp: Date.now(),
        appPackage: "com.test.app",
        activity: ".MainActivity",
        screenOn: true,
        dayOfWeek: 4, // Thursday
        hourOfDay: 14,
        minuteOfDay: 840,
        ...overrides,
    };
}

describe("PassiveObserver", () => {
    let observer: PassiveObserver;

    beforeEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
        observer = new PassiveObserver({
            dataDir: TEST_DIR,
            intervalMs: 60000,
            captureScreenshots: false,
            maxFramesPerSession: 100,
        });
    });

    afterEach(() => {
        if (observer.isRunning()) observer.stop();
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    });

    it("should create data directory on construction", () => {
        assert.ok(existsSync(TEST_DIR));
    });

    it("should start and stop without errors", () => {
        observer.start();
        assert.strictEqual(observer.isRunning(), true);
        observer.stop();
        assert.strictEqual(observer.isRunning(), false);
    });

    it("should not double-start", () => {
        observer.start();
        observer.start(); // should be no-op
        assert.strictEqual(observer.isRunning(), true);
        observer.stop();
    });

    it("should return empty stats when no data", () => {
        const stats = observer.getStats();
        assert.strictEqual(stats.totalSessions, 0);
        assert.strictEqual(stats.totalFrames, 0);
        assert.strictEqual(stats.totalAppsObserved, 0);
        assert.strictEqual(stats.isRunning, false);
    });

    it("should handle observe() without ADB gracefully", () => {
        observer.start();
        const frame = observer.observe();
        // Won't crash even without ADB — returns unknown app or null
        if (frame) {
            assert.strictEqual(typeof frame.appPackage, "string");
            assert.strictEqual(typeof frame.screenOn, "boolean");
        }
        observer.stop();
    });

    it("should get current session while running", () => {
        observer.start();
        const session = observer.getCurrentSession();
        assert.ok(session);
        assert.strictEqual(typeof session.id, "string");
        observer.stop();
    });
});

describe("AppUsageTracker", () => {
    let tracker: AppUsageTracker;

    beforeEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
        tracker = new AppUsageTracker(TEST_DIR);
    });

    afterEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    });

    it("should build empty profile from empty sessions", () => {
        const profile = tracker.buildProfile([]);
        assert.strictEqual(profile.totalScreenTimeHours, 0);
        assert.strictEqual(profile.topApps.length, 0);
        assert.strictEqual(profile.dailyRhythm.length, 24);
    });

    it("should build profile from single session", () => {
        const session = fakeSession({
            totalScreenTimeMs: 3600000, // 1 hour
            frames: [
                fakeFrame({ appPackage: "com.whatsapp", hourOfDay: 9 }),
                fakeFrame({ appPackage: "com.whatsapp", hourOfDay: 9 }),
                fakeFrame({ appPackage: "com.instagram", hourOfDay: 10 }),
            ],
            appTransitions: [
                { timestamp: Date.now(), fromApp: "com.whatsapp", toApp: "com.instagram", durationInPreviousMs: 60000 },
            ],
        });

        const profile = tracker.buildProfile([session]);
        assert.strictEqual(profile.totalScreenTimeHours, 1);
        assert.ok(profile.topApps.length >= 1);
        // WhatsApp should have transition to Instagram
        const wa = profile.topApps.find(a => a.appPackage === "com.whatsapp");
        assert.ok(wa);
        assert.strictEqual(wa.transitionsTo["com.instagram"], 1);
    });

    it("should detect wake/sleep hours", () => {
        const frames: ObservationFrame[] = [];
        // Screen on at 7 AM
        for (let h = 7; h <= 23; h++) {
            frames.push(fakeFrame({ hourOfDay: h, screenOn: h >= 7 && h <= 22 }));
        }
        const session = fakeSession({ frames, totalScreenTimeMs: 16 * 3600000 });
        const profile = tracker.buildProfile([session]);
        assert.ok(profile.wakeHour <= 8);
        assert.ok(profile.sleepHour >= 21);
    });

    it("should differentiate weekday vs weekend", () => {
        const weekdaySession = fakeSession({
            date: "2026-02-16", // Monday
            totalScreenTimeMs: 3600000,
            frames: [fakeFrame()],
        });
        const weekendSession = fakeSession({
            date: "2026-02-21", // Saturday
            totalScreenTimeMs: 7200000,
            frames: [fakeFrame()],
        });
        const profile = tracker.buildProfile([weekdaySession, weekendSession]);
        assert.strictEqual(profile.weekdayAvgHours, 1);
        assert.strictEqual(profile.weekendAvgHours, 2);
    });

    it("should rank apps by total time", () => {
        const session = fakeSession({
            appTransitions: [
                { timestamp: 1, fromApp: "com.app1", toApp: "com.app2", durationInPreviousMs: 100000 },
                { timestamp: 2, fromApp: "com.app2", toApp: "com.app3", durationInPreviousMs: 50000 },
            ],
            frames: [
                fakeFrame({ appPackage: "com.app1" }),
                fakeFrame({ appPackage: "com.app2" }),
                fakeFrame({ appPackage: "com.app3" }),
            ],
        });
        const profile = tracker.buildProfile([session]);
        assert.ok(profile.topApps.length >= 2);
        // app1 had 100s, app2 had 50s
        assert.strictEqual(profile.topApps[0]!.appPackage, "com.app1");
    });

    it("should ignore unknown app frames", () => {
        const session = fakeSession({
            frames: [
                fakeFrame({ appPackage: "unknown" }),
                fakeFrame({ appPackage: "com.real.app" }),
            ],
        });
        const profile = tracker.buildProfile([session]);
        assert.ok(profile.topApps.every(a => a.appPackage !== "unknown"));
    });
});

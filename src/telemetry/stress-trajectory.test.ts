/**
 * BRUTAL STRESS TEST — Trajectory Recorder
 *
 * Edge cases: huge payloads, corrupt data, rapid fire, empty states,
 * injection attacks, concurrent operations, boundary conditions.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { TrajectoryRecorder } from "../telemetry/trajectory-recorder.js";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";

const TEST_DIR = resolve(process.cwd(), "data", "test_stress_traj");

describe("STRESS: TrajectoryRecorder", () => {
    let recorder: TrajectoryRecorder;

    beforeEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
        recorder = new TrajectoryRecorder(TEST_DIR);
    });

    afterEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    });

    // ─── Empty / Null Edge Cases ─────────────────────────────────────

    it("should handle finish without start", () => {
        const result = recorder.finishRecording({
            success: true, reward: 1.0, model: "test", totalDurationMs: 0,
        });
        assert.strictEqual(result, null);
    });

    it("should handle recording with zero frames", () => {
        recorder.startRecording("Empty task");
        const result = recorder.finishRecording({
            success: true, reward: 1.0, model: "test", totalDurationMs: 0,
        });
        assert.strictEqual(result, null); // no frames = no trajectory
    });

    it("should handle double start (overwrite)", () => {
        recorder.startRecording("Task 1");
        recorder.recordFrame({ tool: "t1", args: {}, result: "ok", durationMs: 10 });
        recorder.startRecording("Task 2"); // should reset
        recorder.recordFrame({ tool: "t2", args: {}, result: "ok", durationMs: 10 });
        const traj = recorder.finishRecording({
            success: true, reward: 1.0, model: "m", totalDurationMs: 100,
        });
        assert.ok(traj);
        assert.strictEqual(traj.task, "Task 2");
        assert.strictEqual(traj.frames.length, 1);
    });

    it("should handle empty task name", () => {
        recorder.startRecording("");
        recorder.recordFrame({ tool: "t", args: {}, result: "ok", durationMs: 10 });
        const traj = recorder.finishRecording({
            success: true, reward: 0.5, model: "m", totalDurationMs: 50,
        });
        assert.ok(traj);
        assert.strictEqual(traj.task, "");
    });

    // ─── Huge Payloads ───────────────────────────────────────────────

    it("should handle massive tool result (truncation)", () => {
        recorder.startRecording("Big result test");
        const hugeResult = "X".repeat(100_000); // 100KB result
        recorder.recordFrame({
            tool: "big_tool",
            args: { data: "huge" },
            result: hugeResult,
            durationMs: 10,
        });
        const traj = recorder.finishRecording({
            success: true, reward: 1.0, model: "m", totalDurationMs: 100,
        });
        assert.ok(traj);
        assert.ok(traj.frames[0]!.result.length <= 500); // should be truncated
    });

    it("should handle 1000 frames in one trajectory", () => {
        recorder.startRecording("Mega task");
        for (let i = 0; i < 1000; i++) {
            recorder.recordFrame({
                tool: `tool_${i}`,
                args: { step: i },
                result: `Result ${i}`,
                durationMs: 1,
            });
        }
        const traj = recorder.finishRecording({
            success: true, reward: 0.9, model: "m", totalDurationMs: 5000,
        });
        assert.ok(traj);
        assert.strictEqual(traj.frames.length, 1000);
    });

    it("should handle massive args object", () => {
        recorder.startRecording("Big args");
        const bigArgs: Record<string, unknown> = {};
        for (let i = 0; i < 100; i++) {
            bigArgs[`key_${i}`] = "x".repeat(1000);
        }
        recorder.recordFrame({
            tool: "big_args",
            args: bigArgs,
            result: "ok",
            durationMs: 10,
        });
        const traj = recorder.finishRecording({
            success: true, reward: 1.0, model: "m", totalDurationMs: 100,
        });
        assert.ok(traj);
    });

    // ─── Special Characters / Injection ──────────────────────────────

    it("should handle special characters in task names", () => {
        const evil = '"; DROP TABLE trajectories; --\n\r\t\\/"<script>alert(1)</script>';
        recorder.startRecording(evil);
        recorder.recordFrame({ tool: "t", args: {}, result: "ok", durationMs: 10 });
        const traj = recorder.finishRecording({
            success: true, reward: 1.0, model: "m", totalDurationMs: 100,
        });
        assert.ok(traj);
        assert.strictEqual(traj.task, evil);
    });

    it("should handle unicode / emoji in data", () => {
        recorder.startRecording("打开设置 📱🔧");
        recorder.recordFrame({
            tool: "adb_tap",
            args: { text: "مرحبا العالم" },
            result: "Нажато ✅",
            durationMs: 10,
        });
        const traj = recorder.finishRecording({
            success: true, reward: 1.0, model: "m", totalDurationMs: 100,
        });
        assert.ok(traj);
        assert.strictEqual(traj.task, "打开设置 📱🔧");
    });

    // ─── Corrupt Data Resilience ─────────────────────────────────────

    it("should handle corrupt trajectory file on disk", () => {
        // Write garbage to a trajectory file
        mkdirSync(TEST_DIR, { recursive: true });
        writeFileSync(resolve(TEST_DIR, "traj_corrupt.json"), "{{NOT VALID JSON!!", "utf-8");

        const stats = recorder.getStats();
        assert.strictEqual(stats.totalTrajectories, 0); // corrupt files skipped
    });

    it("should handle empty trajectory file on disk", () => {
        mkdirSync(TEST_DIR, { recursive: true });
        writeFileSync(resolve(TEST_DIR, "traj_empty.json"), "", "utf-8");

        const stats = recorder.getStats();
        assert.strictEqual(stats.totalTrajectories, 0);
    });

    it("should not load non-trajectory files", () => {
        mkdirSync(TEST_DIR, { recursive: true });
        writeFileSync(resolve(TEST_DIR, "readme.txt"), "not a trajectory", "utf-8");
        writeFileSync(resolve(TEST_DIR, "other.json"), '{"foo":1}', "utf-8");

        const ids = recorder.listTrajectoryIds();
        assert.strictEqual(ids.length, 0);
    });

    // ─── Extreme Reward Values ───────────────────────────────────────

    it("should handle extreme reward values", () => {
        recorder.startRecording("Extreme rewards");
        recorder.recordFrame({ tool: "t", args: {}, result: "ok", durationMs: 10 });

        const traj = recorder.finishRecording({
            success: false, reward: -Infinity, model: "m", totalDurationMs: 0,
        });
        assert.ok(traj);
        assert.strictEqual(traj.reward, -Infinity);
    });

    it("should handle NaN reward", () => {
        recorder.startRecording("NaN reward");
        recorder.recordFrame({ tool: "t", args: {}, result: "ok", durationMs: 10 });

        const traj = recorder.finishRecording({
            success: true, reward: NaN, model: "m", totalDurationMs: 100,
        });
        assert.ok(traj);
        assert.ok(isNaN(traj.reward));
    });

    // ─── Rapid-fire Recording ────────────────────────────────────────

    it("should handle 50 trajectories in rapid succession", () => {
        for (let i = 0; i < 50; i++) {
            recorder.startRecording(`Rapid task ${i}`);
            recorder.recordFrame({ tool: "t", args: { i }, result: `r${i}`, durationMs: 1 });
            recorder.finishRecording({ success: true, reward: 0.5, model: "m", totalDurationMs: 10 });
        }
        const stats = recorder.getStats();
        assert.strictEqual(stats.totalTrajectories, 50);
    });

    // ─── Export Edge Cases ────────────────────────────────────────────

    it("should handle export with zero trajectories", () => {
        const file = recorder.exportAsJsonl();
        assert.ok(existsSync(file));
    });

    it("should handle JSONL export with screenshots stripped", () => {
        recorder.startRecording("Screenshot task");
        recorder.recordFrame({
            tool: "screenshot",
            args: {},
            result: "captured",
            durationMs: 10,
            screenshotBefore: "AAAA" + "B".repeat(10000), // fake base64
            screenshotAfter: "CCCC" + "D".repeat(10000),
        });
        const traj = recorder.finishRecording({
            success: true, reward: 1.0, model: "m", totalDurationMs: 100,
        });
        assert.ok(traj);

        const file = recorder.exportAsJsonl();
        const content = readFileSync(file, "utf-8");
        assert.ok(!content.includes("BBBBBB")); // screenshots should be stripped
    });
});

/**
 * Tests for Trajectory Recorder (RLHF Data Engine)
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { TrajectoryRecorder } from "../telemetry/trajectory-recorder.js";
import { mkdirSync, rmSync, existsSync } from "fs";
import { resolve } from "path";

const TEST_DIR = resolve(process.cwd(), "data", "test_trajectories");

describe("TrajectoryRecorder", () => {
    let recorder: TrajectoryRecorder;

    beforeEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
        recorder = new TrajectoryRecorder(TEST_DIR);
    });

    afterEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    });

    it("should start and finish a recording", () => {
        recorder.startRecording("Open Settings");
        recorder.recordFrame({
            tool: "adb_tap",
            args: { x: 540, y: 1200 },
            result: "Tapped (540, 1200)",
            durationMs: 150,
        });
        recorder.recordFrame({
            tool: "adb_screenshot",
            args: {},
            result: "Screenshot captured",
            durationMs: 500,
        });

        const traj = recorder.finishRecording({
            success: true,
            reward: 0.85,
            model: "qwen2.5",
            totalDurationMs: 3000,
        });

        assert.ok(traj);
        assert.strictEqual(traj.task, "Open Settings");
        assert.strictEqual(traj.frames.length, 2);
        assert.strictEqual(traj.success, true);
        assert.strictEqual(traj.reward, 0.85);
        assert.strictEqual(traj.metadata.model, "qwen2.5");
    });

    it("should persist and retrieve trajectories", () => {
        recorder.startRecording("Test task");
        recorder.recordFrame({
            tool: "shell",
            args: { command: "echo hello" },
            result: "hello",
            durationMs: 50,
        });
        const saved = recorder.finishRecording({
            success: true, reward: 0.5, model: "test", totalDurationMs: 100,
        });

        assert.ok(saved);

        // Load it back
        const loaded = recorder.loadTrajectory(saved.id);
        assert.ok(loaded);
        assert.strictEqual(loaded.task, "Test task");
        assert.strictEqual(loaded.frames.length, 1);
    });

    it("should compute stats correctly", () => {
        // Record two trajectories
        recorder.startRecording("Task 1");
        recorder.recordFrame({ tool: "t1", args: {}, result: "ok", durationMs: 10 });
        recorder.recordFrame({ tool: "t2", args: {}, result: "ok", durationMs: 10 });
        recorder.finishRecording({ success: true, reward: 0.8, model: "m", totalDurationMs: 100 });

        recorder.startRecording("Task 2");
        recorder.recordFrame({ tool: "t3", args: {}, result: "fail", durationMs: 10 });
        recorder.finishRecording({ success: false, reward: -0.5, model: "m", totalDurationMs: 50 });

        const stats = recorder.getStats();
        assert.strictEqual(stats.totalTrajectories, 2);
        assert.strictEqual(stats.successfulTrajectories, 1);
        assert.strictEqual(stats.totalFrames, 3);
        assert.ok(Math.abs(stats.avgReward - 0.15) < 0.01);
    });

    it("should export as JSONL", () => {
        recorder.startRecording("Export test");
        recorder.recordFrame({ tool: "tap", args: {}, result: "ok", durationMs: 10 });
        recorder.finishRecording({ success: true, reward: 1.0, model: "m", totalDurationMs: 100 });

        const exportPath = recorder.exportAsJsonl();
        assert.ok(existsSync(exportPath));
    });

    it("should list trajectory IDs", () => {
        recorder.startRecording("List test");
        recorder.recordFrame({ tool: "tap", args: {}, result: "ok", durationMs: 10 });
        recorder.finishRecording({ success: true, reward: 1.0, model: "m", totalDurationMs: 100 });

        const ids = recorder.listTrajectoryIds();
        assert.strictEqual(ids.length, 1);
        assert.ok(ids[0]!.startsWith("traj_"));
    });

    it("should not record when disabled", () => {
        recorder.setEnabled(false);
        recorder.startRecording("Disabled test");
        recorder.recordFrame({ tool: "tap", args: {}, result: "ok", durationMs: 10 });
        const traj = recorder.finishRecording({ success: true, reward: 1.0, model: "m", totalDurationMs: 100 });
        assert.strictEqual(traj, null);
    });

    it("should toggle enabled state", () => {
        assert.strictEqual(recorder.isEnabled(), true);
        recorder.setEnabled(false);
        assert.strictEqual(recorder.isEnabled(), false);
        recorder.setEnabled(true);
        assert.strictEqual(recorder.isEnabled(), true);
    });
});

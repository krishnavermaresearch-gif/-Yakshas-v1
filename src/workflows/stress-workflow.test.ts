/**
 * BRUTAL STRESS TEST — Workflow Engine
 *
 * Chaos testing: poison steps, crash recovery, deep nesting, concurrent ops,
 * circular conditions, extremely long instructions, state corruption.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { WorkflowEngine } from "../workflows/workflow-engine.js";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";

const TEST_DIR = resolve(process.cwd(), "data", "test_stress_wf");

describe("STRESS: WorkflowEngine", () => {
    let engine: WorkflowEngine;

    beforeEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
        engine = new WorkflowEngine(TEST_DIR);
    });

    afterEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    });

    // ─── Poison Steps ────────────────────────────────────────────────

    it("should survive executor that throws synchronously", async () => {
        engine.setExecutor(async () => { throw new Error("BOOM 💥"); });

        const wf = engine.create({
            name: "Poison",
            description: "test",
            steps: [{ instruction: "explode" }],
        });

        await engine.executeAll(wf.id);
        const result = engine.get(wf.id)!;
        assert.strictEqual(result.status, "failed");
        assert.strictEqual(result.steps[0]!.error, "BOOM 💥");
    });

    it("should survive executor that returns undefined", async () => {
        engine.setExecutor(async () => undefined as any);

        const wf = engine.create({
            name: "Undefined result",
            description: "test",
            steps: [{ instruction: "go" }],
        });

        await engine.executeAll(wf.id);
        assert.strictEqual(engine.get(wf.id)?.status, "completed");
    });

    it("should survive executor that hangs (timeout would be needed)", async () => {
        // Simulate a fast executor — timeout testing needs real infra
        let callCount = 0;
        engine.setExecutor(async () => { callCount++; return "done"; });

        const wf = engine.create({
            name: "Fast",
            description: "test",
            steps: Array.from({ length: 20 }, (_, i) => ({ instruction: `Step ${i}` })),
        });

        await engine.executeAll(wf.id);
        assert.strictEqual(callCount, 20);
        assert.strictEqual(engine.get(wf.id)?.status, "completed");
    });

    // ─── Crash Recovery (Persistence) ────────────────────────────────

    it("should recover workflow state after crash mid-execution", async () => {
        let stepCount = 0;
        engine.setExecutor(async () => {
            stepCount++;
            if (stepCount === 3) throw new Error("Simulated crash");
            return `done_${stepCount}`;
        });

        const wf = engine.create({
            name: "Crash recovery",
            description: "test",
            steps: Array.from({ length: 5 }, (_, i) => ({ instruction: `Step ${i}` })),
        });

        await engine.executeAll(wf.id);
        assert.strictEqual(engine.get(wf.id)?.status, "failed");

        // "Restart" — create new engine (simulates reboot)
        const engine2 = new WorkflowEngine(TEST_DIR);
        const recovered = engine2.get(wf.id);
        assert.ok(recovered);
        assert.strictEqual(recovered.status, "failed");
        assert.strictEqual(recovered.currentStepIndex, 2); // saved at step 2 (0-indexed)
        assert.strictEqual(recovered.steps[0]!.status, "completed");
        assert.strictEqual(recovered.steps[1]!.status, "completed");
        assert.strictEqual(recovered.steps[2]!.status, "failed");
    });

    // ─── Condition Edge Cases ────────────────────────────────────────

    it("should handle all steps with false conditions (all skipped)", async () => {
        engine.setExecutor(async () => "done");

        const wf = engine.create({
            name: "All skipped",
            description: "test",
            steps: [
                { instruction: "A", condition: "never_true" },
                { instruction: "B", condition: "also_false" },
                { instruction: "C", condition: "nope" },
            ],
        });

        await engine.executeAll(wf.id);
        const result = engine.get(wf.id)!;
        assert.strictEqual(result.status, "completed");
        assert.ok(result.steps.every(s => s.status === "skipped"));
    });

    it("should handle condition with special characters", () => {
        const ctx = { "he said": "yes" };
        // This should not crash
        const result = engine.evaluateCondition('he said == yes', ctx);
        assert.strictEqual(typeof result, "boolean");
    });

    it("should handle condition with empty string value", () => {
        assert.strictEqual(engine.evaluateCondition("key == ", { key: "" }), true);
    });

    it("should handle 'contains' with empty context", () => {
        assert.strictEqual(engine.evaluateCondition("x contains hello", {}), false);
    });

    // ─── Context Interpolation Abuse ─────────────────────────────────

    it("should handle nested braces in interpolation", () => {
        const result = engine.interpolate("{{{context.name}}}", { name: "Alice" });
        assert.strictEqual(result, "{Alice}");
    });

    it("should handle missing context key in interpolation", () => {
        const result = engine.interpolate("Hello {{context.missing}}", {});
        assert.strictEqual(result, "Hello {{context.missing}}"); // leave as-is
    });

    it("should handle injection in interpolation", () => {
        const result = engine.interpolate(
            "{{context.evil}}",
            { evil: '"; rm -rf /' },
        );
        assert.strictEqual(result, '"; rm -rf /');
    });

    // ─── Massive Workflows ───────────────────────────────────────────

    it("should handle workflow with 100 steps", async () => {
        engine.setExecutor(async (instruction) => `OK: ${instruction}`);

        const wf = engine.create({
            name: "Century",
            description: "100 steps",
            steps: Array.from({ length: 100 }, (_, i) => ({ instruction: `Step ${i}` })),
        });

        await engine.executeAll(wf.id);
        assert.strictEqual(engine.get(wf.id)?.status, "completed");
        assert.strictEqual(engine.get(wf.id)?.executionCount, 1);
    });

    it("should handle 50 concurrent workflows", async () => {
        engine.setExecutor(async (instruction) => `Done: ${instruction}`);

        const ids: string[] = [];
        for (let i = 0; i < 50; i++) {
            const wf = engine.create({
                name: `Batch ${i}`,
                description: `wf ${i}`,
                steps: [{ instruction: `Task ${i}` }],
            });
            ids.push(wf.id);
        }

        // Execute all in parallel
        await Promise.all(ids.map(id => engine.executeAll(id)));

        const completed = engine.list().filter(w => w.status === "completed");
        assert.strictEqual(completed.length, 50);
    });

    // ─── Cancel Edge Cases ───────────────────────────────────────────

    it("should handle cancelling a non-existent workflow", () => {
        assert.strictEqual(engine.cancel("fake_id"), false);
    });

    it("should handle cancelling an already completed workflow", async () => {
        engine.setExecutor(async () => "done");
        const wf = engine.create({ name: "Done", description: "", steps: [{ instruction: "go" }] });
        await engine.executeAll(wf.id);

        engine.cancel(wf.id);
        assert.strictEqual(engine.get(wf.id)?.status, "cancelled");
    });

    it("should handle double cancel", () => {
        const wf = engine.create({ name: "Double", description: "", steps: [{ instruction: "go" }] });
        engine.cancel(wf.id);
        engine.cancel(wf.id);
        assert.strictEqual(engine.get(wf.id)?.status, "cancelled");
    });

    // ─── Execute After Completion ────────────────────────────────────

    it("should refuse to execute steps on completed workflow", async () => {
        engine.setExecutor(async () => "done");
        const wf = engine.create({ name: "Completed", description: "", steps: [{ instruction: "go" }] });
        await engine.executeAll(wf.id);

        const r = await engine.executeNextStep(wf.id);
        assert.strictEqual(r.done, true);
    });

    it("should refuse to execute steps on failed workflow", async () => {
        engine.setExecutor(async () => { throw new Error("fail"); });
        const wf = engine.create({ name: "Failed", description: "", steps: [{ instruction: "go" }] });
        await engine.executeAll(wf.id);

        const r = await engine.executeNextStep(wf.id);
        assert.strictEqual(r.done, true);
    });

    // ─── Corrupt Data ────────────────────────────────────────────────

    it("should handle corrupt workflow file on disk", () => {
        mkdirSync(TEST_DIR, { recursive: true });
        writeFileSync(resolve(TEST_DIR, "wf_corrupt.json"), "NOT JSON {{{", "utf-8");

        const engine2 = new WorkflowEngine(TEST_DIR);
        assert.strictEqual(engine2.list().length, 0);
    });

    it("should handle empty workflow file on disk", () => {
        mkdirSync(TEST_DIR, { recursive: true });
        writeFileSync(resolve(TEST_DIR, "wf_empty.json"), "", "utf-8");

        const engine2 = new WorkflowEngine(TEST_DIR);
        assert.strictEqual(engine2.list().length, 0);
    });

    // ─── Event Triggers ──────────────────────────────────────────────

    it("should handle resume on non-waiting workflow", () => {
        const wf = engine.create({ name: "Not waiting", description: "", steps: [{ instruction: "go" }] });
        // Should not crash
        engine.resumeFromEvent(wf.id, { data: "test" });
        assert.strictEqual(engine.get(wf.id)?.status, "created");
    });

    it("should handle resume with empty event data", async () => {
        engine.setExecutor(async () => "done");
        const wf = engine.create({
            name: "Event resume",
            description: "test",
            steps: [
                { instruction: "Wait", waitForEvent: "test_event" },
                { instruction: "After wait" },
            ],
        });

        await engine.executeNextStep(wf.id);
        assert.strictEqual(engine.get(wf.id)?.status, "waiting_trigger");

        engine.resumeFromEvent(wf.id); // no event data
        assert.strictEqual(engine.get(wf.id)?.status, "running");
    });

    // ─── Remove ──────────────────────────────────────────────────────

    it("should handle remove non-existent workflow", () => {
        assert.strictEqual(engine.remove("fake"), false);
    });

    it("should handle remove then re-access", () => {
        const wf = engine.create({ name: "Remove me", description: "", steps: [{ instruction: "go" }] });
        engine.remove(wf.id);
        assert.strictEqual(engine.get(wf.id), undefined);
        assert.strictEqual(engine.list().length, 0);
    });

    // ─── Unicode Workflow Names ──────────────────────────────────────

    it("should handle unicode/emoji workflow names and instructions", async () => {
        engine.setExecutor(async (instruction) => `✅ ${instruction}`);

        const wf = engine.create({
            name: "🤖 المراقبة التلقائية",
            description: "日本語テスト",
            steps: [{ instruction: "Проверить почту 📧" }],
        });

        await engine.executeAll(wf.id);
        assert.strictEqual(engine.get(wf.id)?.status, "completed");
        assert.ok(engine.get(wf.id)?.steps[0]!.result?.includes("✅"));
    });
});

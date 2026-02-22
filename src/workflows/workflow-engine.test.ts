/**
 * Tests for Workflow Engine (B2B State Machine)
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { WorkflowEngine } from "../workflows/workflow-engine.js";
import { rmSync, existsSync } from "fs";
import { resolve } from "path";

const TEST_DIR = resolve(process.cwd(), "data", "test_workflows");

describe("WorkflowEngine", () => {
    let engine: WorkflowEngine;

    beforeEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
        engine = new WorkflowEngine(TEST_DIR);
    });

    afterEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    });

    it("should create a workflow with steps", () => {
        const wf = engine.create({
            name: "Test Workflow",
            description: "A test",
            steps: [
                { instruction: "Step 1: Open the app" },
                { instruction: "Step 2: Click the button" },
                { instruction: "Step 3: Verify result" },
            ],
        });

        assert.ok(wf.id.startsWith("wf_"));
        assert.strictEqual(wf.name, "Test Workflow");
        assert.strictEqual(wf.steps.length, 3);
        assert.strictEqual(wf.status, "created");
        assert.strictEqual(wf.currentStepIndex, 0);
    });

    it("should execute steps in sequence", async () => {
        engine.setExecutor(async (instruction) => `Done: ${instruction}`);

        const wf = engine.create({
            name: "Sequential",
            description: "test",
            steps: [
                { instruction: "Step A" },
                { instruction: "Step B" },
            ],
        });

        const r1 = await engine.executeNextStep(wf.id);
        assert.strictEqual(r1.done, false);
        assert.strictEqual(r1.stepResult, "Done: Step A");

        const r2 = await engine.executeNextStep(wf.id);
        assert.strictEqual(r2.done, true);
        assert.strictEqual(r2.stepResult, "Done: Step B");

        const completed = engine.get(wf.id);
        assert.strictEqual(completed?.status, "completed");
    });

    it("should execute all steps at once", async () => {
        engine.setExecutor(async (instruction) => `OK: ${instruction}`);

        const wf = engine.create({
            name: "All at once",
            description: "test",
            steps: [
                { instruction: "A" },
                { instruction: "B" },
                { instruction: "C" },
            ],
        });

        const result = await engine.executeAll(wf.id);
        assert.strictEqual(result.status, "completed");
        assert.strictEqual(result.currentStepIndex, 3);
        assert.strictEqual(result.executionCount, 1);
    });

    it("should handle step failures", async () => {
        engine.setExecutor(async (instruction) => {
            if (instruction.includes("fail")) throw new Error("Simulated failure");
            return "OK";
        });

        const wf = engine.create({
            name: "Failure test",
            description: "test",
            steps: [
                { instruction: "Good step" },
                { instruction: "This will fail" },
            ],
        });

        await engine.executeAll(wf.id);
        const failed = engine.get(wf.id)!;
        assert.strictEqual(failed.status, "failed");
        assert.strictEqual(failed.steps[1]!.status, "failed");
    });

    it("should skip steps when condition is not met", async () => {
        engine.setExecutor(async (instruction) => `Done: ${instruction}`);

        const wf = engine.create({
            name: "Conditional",
            description: "test",
            steps: [
                { instruction: "Always runs" },
                { instruction: "Skip me", condition: "nonexistent_key" },
                { instruction: "Also runs" },
            ],
        });

        await engine.executeAll(wf.id);
        const result = engine.get(wf.id)!;
        assert.strictEqual(result.status, "completed");
        assert.strictEqual(result.steps[1]!.status, "skipped");
        assert.strictEqual(result.steps[2]!.status, "completed");
    });

    it("should carry context between steps", async () => {
        engine.setExecutor(async (instruction, context) => {
            if (instruction.includes("extract")) return "important_data_123";
            return `Used: ${context["step_0_result"]}`;
        });

        const wf = engine.create({
            name: "Context flow",
            description: "test",
            steps: [
                { instruction: "extract data" },
                { instruction: "use {{context.step_0_result}}" },
            ],
        });

        await engine.executeAll(wf.id);
        const result = engine.get(wf.id)!;
        assert.strictEqual(result.context["step_0_result"], "important_data_123");
    });

    it("should interpolate context variables", () => {
        const result = engine.interpolate(
            "Hello {{context.name}}, your order {{context.orderId}} is ready",
            { name: "Alice", orderId: "12345" },
        );
        assert.strictEqual(result, "Hello Alice, your order 12345 is ready");
    });

    it("should evaluate conditions correctly", () => {
        const ctx = { status: "active", name: "test", count: "5" };

        assert.strictEqual(engine.evaluateCondition("status exists", ctx), true);
        assert.strictEqual(engine.evaluateCondition("missing exists", ctx), false);
        assert.strictEqual(engine.evaluateCondition("status == active", ctx), true);
        assert.strictEqual(engine.evaluateCondition("status == inactive", ctx), false);
        assert.strictEqual(engine.evaluateCondition("name contains es", ctx), true);
        assert.strictEqual(engine.evaluateCondition("name contains xyz", ctx), false);
    });

    it("should cancel a workflow", () => {
        const wf = engine.create({
            name: "Cancel me",
            description: "test",
            steps: [{ instruction: "step" }],
        });

        const cancelled = engine.cancel(wf.id);
        assert.strictEqual(cancelled, true);
        assert.strictEqual(engine.get(wf.id)?.status, "cancelled");
    });

    it("should list and filter workflows", async () => {
        engine.setExecutor(async () => "done");

        engine.create({ name: "Active 1", description: "", steps: [{ instruction: "s" }] });
        const wf2 = engine.create({ name: "Active 2", description: "", steps: [{ instruction: "s" }] });
        await engine.executeAll(wf2.id);

        assert.strictEqual(engine.list().length, 2);
        assert.strictEqual(engine.listActive().length, 1);
    });

    it("should wait for event triggers", async () => {
        engine.setExecutor(async () => "done");

        const wf = engine.create({
            name: "Event wait",
            description: "test",
            steps: [
                { instruction: "Wait for email", waitForEvent: "gmail_new" },
                { instruction: "Process email" },
            ],
        });

        const r1 = await engine.executeNextStep(wf.id);
        assert.strictEqual(r1.done, false);
        assert.strictEqual(engine.get(wf.id)?.status, "waiting_trigger");

        // Resume from event
        engine.resumeFromEvent(wf.id, { email_from: "boss@example.com" });
        assert.strictEqual(engine.get(wf.id)?.status, "running");
        assert.strictEqual(engine.get(wf.id)?.context["email_from"], "boss@example.com");
    });

    it("should persist and reload workflows", () => {
        engine.create({
            name: "Persist test",
            description: "test",
            steps: [{ instruction: "step 1" }],
        });

        // Create a new engine instance pointing to same directory
        const engine2 = new WorkflowEngine(TEST_DIR);
        assert.strictEqual(engine2.list().length, 1);
        assert.strictEqual(engine2.list()[0]!.name, "Persist test");
    });
});

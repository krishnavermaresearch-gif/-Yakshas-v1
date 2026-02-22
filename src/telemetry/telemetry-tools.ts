/**
 * Telemetry Tools — agent tools for managing RLHF trajectory recording.
 */

import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";
import { getTrajectoryRecorder } from "./trajectory-recorder.js";

const telemetryStatusTool: ToolDefinition = {
    name: "telemetry_status",
    description: "Show RLHF trajectory recording statistics — total trajectories, success rate, frames, disk usage.",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (): Promise<ToolResult> => {
        const recorder = getTrajectoryRecorder();
        const stats = recorder.getStats();
        const enabled = recorder.isEnabled();

        return {
            type: "text",
            content:
                `📊 RLHF Trajectory Recording: ${enabled ? "✅ ENABLED" : "⛔ DISABLED"}\n\n` +
                `Total trajectories: ${stats.totalTrajectories}\n` +
                `Successful: ${stats.successfulTrajectories} (${stats.totalTrajectories > 0 ? Math.round(stats.successfulTrajectories / stats.totalTrajectories * 100) : 0}%)\n` +
                `Total frames: ${stats.totalFrames}\n` +
                `Avg reward: ${stats.avgReward.toFixed(3)}\n` +
                `Disk usage: ${stats.diskUsageMB} MB`,
        };
    },
};

const telemetryExportTool: ToolDefinition = {
    name: "telemetry_export",
    description: "Export all RLHF trajectories as a JSONL file (standard training data format).",
    parameters: {
        type: "object",
        properties: {
            output_path: {
                type: "string",
                description: "Optional output file path. Defaults to data/trajectories/export_<timestamp>.jsonl",
            },
        },
        required: [],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const recorder = getTrajectoryRecorder();
        const outputPath = args.output_path as string | undefined;
        const file = recorder.exportAsJsonl(outputPath);
        return { type: "text", content: `✅ Exported trajectories to: ${file}` };
    },
};

const telemetryToggleTool: ToolDefinition = {
    name: "telemetry_toggle",
    description: "Enable or disable RLHF trajectory recording.",
    parameters: {
        type: "object",
        properties: {
            enabled: {
                type: "string",
                description: "Set to 'true' to enable, 'false' to disable",
            },
        },
        required: ["enabled"],
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const recorder = getTrajectoryRecorder();
        const enabled = String(args.enabled).toLowerCase() === "true";
        recorder.setEnabled(enabled);
        return { type: "text", content: `📊 RLHF recording: ${enabled ? "✅ ENABLED" : "⛔ DISABLED"}` };
    },
};

export const telemetryTools: ToolDefinition[] = [
    telemetryStatusTool,
    telemetryExportTool,
    telemetryToggleTool,
];

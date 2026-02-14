import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { PluginState } from "../types";

export function createStatusTool(state: PluginState): ToolDefinition {
  return tool({
    description: "Show monitor status and latest metrics",
    args: {},
    async execute() {
      if (!state.lastMetrics) {
        return `TokenSpeed monitor is ${state.enabled ? "ON" : "OFF"}. No metrics yet.`;
      }

      const m = state.lastMetrics;
      const duration = m.durationMs !== undefined ? `${(m.durationMs / 1000).toFixed(1)}s` : "N/A";
      const outputTps = m.outputTps !== undefined ? `${m.outputTps} tok/s` : "N/A";
      const totalTps = m.totalTps !== undefined ? `${m.totalTps} tok/s` : "N/A";

      return [
        `Monitor: ${state.enabled ? "ON" : "OFF"}`,
        `Last model: ${m.modelID}`,
        `Input: ${m.inputTokens}, Output: ${m.outputTokens}, Total: ${m.totalTokens}`,
        `Output TPS: ${outputTps}, Total TPS: ${totalTps}, Duration: ${duration}`,
      ].join("\n");
    },
  });
}

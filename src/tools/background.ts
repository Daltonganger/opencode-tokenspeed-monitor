import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { PluginState } from "../types";

export type BackgroundToggleResult = {
  enabled: boolean;
  detail?: string;
};

export function createBackgroundTool(
  state: PluginState,
  onToggle: (enabled: boolean) => Promise<BackgroundToggleResult>,
): ToolDefinition {
  return tool({
    description: "Toggle TokenSpeed background mode flag (API stays available)",
    args: {},
    async execute() {
      const next = !state.backgroundEnabled;
      const result = await onToggle(next);
      state.backgroundEnabled = result.enabled;
      return result.detail ?? `Background mode: ${state.backgroundEnabled ? "ON" : "OFF"}`;
    },
  });
}

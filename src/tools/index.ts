import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import type { Database } from "bun:sqlite";
import type { PluginState } from "../types";
import { createBackgroundTool, type BackgroundToggleResult } from "./background";
import { createHistoryTool } from "./history";
import { createStatsTool } from "./stats";
import { createStatusTool } from "./status";
import { createToggleTool } from "./toggle";

export function createTools(
  client: PluginInput["client"],
  state: PluginState,
  db: Database,
  onBackgroundToggle: (enabled: boolean) => Promise<BackgroundToggleResult>,
): Record<string, ToolDefinition> {
  return {
    ts: createToggleTool(client, state),
    "ts-status": createStatusTool(state),
    "ts-stats": createStatsTool(db),
    "ts-history": createHistoryTool(db),
    "ts-bg": createBackgroundTool(state, onBackgroundToggle),
  };
}

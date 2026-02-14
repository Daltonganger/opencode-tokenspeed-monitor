import type { ToolDefinition } from "@opencode-ai/plugin";
import type { PluginState } from "../types";
export type BackgroundToggleResult = {
    enabled: boolean;
    detail?: string;
};
export declare function createBackgroundTool(state: PluginState, onToggle: (enabled: boolean) => Promise<BackgroundToggleResult>): ToolDefinition;
//# sourceMappingURL=background.d.ts.map
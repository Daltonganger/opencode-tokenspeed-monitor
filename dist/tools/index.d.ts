import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import type { Database } from "bun:sqlite";
import type { PluginState } from "../types";
import { type BackgroundToggleResult } from "./background";
export declare function createTools(client: PluginInput["client"], state: PluginState, db: Database, shell: PluginInput["$"], onBackgroundToggle: (enabled: boolean) => Promise<BackgroundToggleResult>): Record<string, ToolDefinition>;
//# sourceMappingURL=index.d.ts.map
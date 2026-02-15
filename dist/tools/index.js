import { createBackgroundTool } from "./background";
import { createHistoryTool } from "./history";
import { createOpenTool } from "./open";
import { createStatsTool } from "./stats";
import { createStatusTool } from "./status";
import { createToggleTool } from "./toggle";
export function createTools(client, state, db, shell, onBackgroundToggle) {
    return {
        ts: createOpenTool(client, state, shell),
        "ts-toggle": createToggleTool(client, state),
        "ts-status": createStatusTool(state),
        "ts-stats": createStatsTool(db),
        "ts-history": createHistoryTool(db),
        "ts-bg": createBackgroundTool(state, onBackgroundToggle),
    };
}
//# sourceMappingURL=index.js.map
import { createBackgroundTool } from "./background";
import { createHistoryTool } from "./history";
import { createOpenTool } from "./open";
import { createStatsTool } from "./stats";
import { createStatusTool } from "./status";
import { createToggleTool } from "./toggle";
import { createUploadFlushTool, createUploadStatusTool } from "./upload";
export function createTools(client, state, db, shell, onBackgroundToggle, onUploadFlush, getUploadInfo) {
    return {
        ts: createOpenTool(client, state, shell),
        "ts-toggle": createToggleTool(client, state),
        "ts-status": createStatusTool(state),
        "ts-stats": createStatsTool(db),
        "ts-history": createHistoryTool(db),
        "ts-bg": createBackgroundTool(state, onBackgroundToggle),
        "ts-upload": createUploadStatusTool(db, getUploadInfo),
        "ts-upload-flush": createUploadFlushTool(db, onUploadFlush, getUploadInfo),
    };
}
//# sourceMappingURL=index.js.map
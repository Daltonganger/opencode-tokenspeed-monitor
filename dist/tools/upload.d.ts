import type { ToolDefinition } from "@opencode-ai/plugin";
import type { Database } from "bun:sqlite";
export type UploadInfoProvider = () => {
    enabled: boolean;
    hubURL: string | null;
};
export type UploadFlushResult = {
    ok: boolean;
    detail: string;
};
export declare function createUploadStatusTool(db: Database, getUploadInfo: UploadInfoProvider): ToolDefinition;
export declare function createUploadFlushTool(db: Database, onFlush: () => Promise<UploadFlushResult>, getUploadInfo: UploadInfoProvider): ToolDefinition;
//# sourceMappingURL=upload.d.ts.map
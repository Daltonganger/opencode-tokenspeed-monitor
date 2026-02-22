import type { Database } from "bun:sqlite";
export interface LiveMetricEvent {
    sessionID: string;
    messageID: string;
    modelID: string;
    outputTokens: number;
    outputTps?: number;
    durationMs?: number;
    completedAt?: number;
}
export interface ApiServerHandle {
    port: number;
    url: string;
    publish(event: LiveMetricEvent): void;
    stop(): Promise<void>;
}
export interface ApiServerOptions {
    uploadEnabled?: boolean;
    uploadHubURL?: string | null;
    flushUploadNow?: () => Promise<void>;
}
export declare function startApiServer(db: Database, requestedPort: number, options?: ApiServerOptions): ApiServerHandle;
//# sourceMappingURL=server.d.ts.map
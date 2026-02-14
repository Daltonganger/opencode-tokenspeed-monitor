import type { Database } from "bun:sqlite";
import type { ModelStats, RequestMetrics } from "../types";
export declare function saveRequest(db: Database, item: RequestMetrics): void;
export declare function upsertSession(db: Database, sessionID: string, startedAt: number, lastActivity: number): void;
export declare function getRecentRequests(db: Database, limit?: number): RequestMetrics[];
export declare function getRequestsByModel(db: Database, modelID: string, limit?: number): RequestMetrics[];
export declare function getSessionStats(db: Database): {
    requestCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    totalCost: number;
};
export declare function getModelStats(db: Database): ModelStats[];
export declare function getSessions(db: Database, limit?: number): Array<{
    id: string;
    startedAt: number | null;
    lastActivity: number | null;
    requestCount: number;
}>;
export declare function saveModelStats(db: Database, stats: ModelStats[]): void;
export declare function aggregateModelStatsInDb(db: Database): ModelStats[];
//# sourceMappingURL=database.d.ts.map
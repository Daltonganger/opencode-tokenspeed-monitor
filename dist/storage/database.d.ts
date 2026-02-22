import type { Database } from "bun:sqlite";
import type { ModelStats, ProjectStats, ProviderStats, RequestMetrics } from "../types";
export type RequestFilters = {
    projectID?: string;
    providerID?: string;
    modelID?: string;
};
export declare function saveRequest(db: Database, item: RequestMetrics): void;
export declare function upsertProject(db: Database, projectID: string, name: string, rootPath: string, lastSeen: number): void;
export declare function upsertSession(db: Database, sessionID: string, projectID: string | null, startedAt: number, lastActivity: number): void;
export declare function getRecentRequests(db: Database, limit?: number): RequestMetrics[];
export declare function getFilteredRequests(db: Database, filters?: RequestFilters, limit?: number): RequestMetrics[];
export declare function getRequestsByModel(db: Database, modelID: string, limit?: number): RequestMetrics[];
export declare function getSessionStats(db: Database): {
    requestCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    totalCost: number;
};
export declare function getSessionStatsWithFilters(db: Database, filters: RequestFilters): {
    requestCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    totalCost: number;
};
export declare function getModelStats(db: Database, filters?: RequestFilters): ModelStats[];
export declare function getProviderStats(db: Database, filters?: RequestFilters): ProviderStats[];
export declare function getProjects(db: Database, limit?: number): ProjectStats[];
export declare function getSessions(db: Database, limit?: number): Array<{
    id: string;
    startedAt: number | null;
    lastActivity: number | null;
    requestCount: number;
}>;
export declare function saveModelStats(db: Database, stats: ModelStats[]): void;
export declare function aggregateModelStatsInDb(db: Database): ModelStats[];
//# sourceMappingURL=database.d.ts.map
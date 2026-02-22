import { Database } from "bun:sqlite";
export interface HubBucketInput {
    bucketStart: number;
    bucketEnd: number;
    anonProjectId: string;
    providerId: string;
    modelId: string;
    requestCount: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalCost: number;
    avgOutputTps: number | null;
    minOutputTps: number | null;
    maxOutputTps: number | null;
}
export interface HubSummary {
    requestCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalReasoningTokens: number;
    totalCacheReadTokens: number;
    totalCacheWriteTokens: number;
    totalCost: number;
}
export interface HubModelRow {
    modelId: string;
    providerId: string;
    requestCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;
    avgOutputTps: number | null;
    minOutputTps: number | null;
    maxOutputTps: number | null;
}
export interface HubProviderRow {
    providerId: string;
    requestCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;
    avgOutputTps: number | null;
    minOutputTps: number | null;
    maxOutputTps: number | null;
}
export interface HubProjectRow {
    anonProjectId: string;
    requestCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;
    lastBucketEnd: number | null;
}
export type HubTimeseriesMetric = "tokens" | "cost" | "tps";
export type HubTimeseriesGroupBy = "hour" | "day";
export interface HubTimeseriesPoint {
    ts: number;
    value: number;
    requestCount: number;
}
export interface HubDashboardFilters {
    anonProjectId?: string;
    providerId?: string;
    modelId?: string;
}
export interface HubDeviceRecord {
    deviceId: string;
    label: string | null;
    status: "active" | "revoked";
    signingKey: string;
    createdAt: number;
    updatedAt: number;
    lastSeen: number | null;
    revokedAt: number | null;
}
export declare function openHubDatabase(dbPath?: string): Database;
export declare function runHubMigrations(db: Database): void;
export declare function getHubDevice(db: Database, deviceID: string): HubDeviceRecord | null;
export declare function registerHubDevice(db: Database, deviceID: string, label?: string | null): HubDeviceRecord;
export declare function revokeHubDevice(db: Database, deviceID: string): boolean;
export declare function activateHubDevice(db: Database, deviceID: string): boolean;
export declare function bulkSetHubDevicesStatus(db: Database, deviceIDs: string[], status: "active" | "revoked"): {
    updated: string[];
    missing: string[];
};
export declare function listHubDevices(db: Database, limit?: number): HubDeviceRecord[];
export declare function touchHubDeviceSeen(db: Database, deviceID: string, seenAt: number): void;
export declare function upsertHubBuckets(db: Database, deviceID: string, buckets: HubBucketInput[]): void;
export declare function cleanupExpiredNonces(db: Database, nowSec: number): void;
export declare function isNonceUsed(db: Database, deviceID: string, nonce: string): boolean;
export declare function storeNonce(db: Database, deviceID: string, nonce: string, expiresAt: number): void;
export declare function getHubSummary(db: Database, from?: number | null, to?: number | null, filters?: HubDashboardFilters): HubSummary;
export declare function getHubModels(db: Database, from?: number | null, to?: number | null, limit?: number, filters?: HubDashboardFilters): HubModelRow[];
export declare function getHubProjects(db: Database, from?: number | null, to?: number | null, limit?: number, filters?: HubDashboardFilters): HubProjectRow[];
export declare function getHubProviders(db: Database, from?: number | null, to?: number | null, limit?: number, filters?: HubDashboardFilters): HubProviderRow[];
export declare function getHubTimeseries(db: Database, metric: HubTimeseriesMetric, groupBy: HubTimeseriesGroupBy, from?: number | null, to?: number | null, limit?: number, filters?: HubDashboardFilters): HubTimeseriesPoint[];
//# sourceMappingURL=database.d.ts.map
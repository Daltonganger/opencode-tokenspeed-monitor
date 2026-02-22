import type { Database } from "bun:sqlite";
import type { RequestMetrics } from "../types";
export interface UploadQueueStatus {
    pending: number;
    sent: number;
    dead: number;
    total: number;
    oldestPendingBucketStart: number | null;
}
export interface UploadQueueEntry {
    id: string;
    bucketStart: number;
    bucketEnd: number;
    anonProjectID: string;
    providerID: string;
    modelID: string;
    requestCount: number;
    totalCost: number;
    status: string;
    attemptCount: number;
    nextAttemptAt: number;
    lastError: string | null;
    sentAt: number | null;
}
export interface UploadBucketPayload {
    id: string;
    bucketStart: number;
    bucketEnd: number;
    anonProjectID: string;
    providerID: string;
    modelID: string;
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
    lastSeen: number;
    attemptCount: number;
}
export declare function buildQueueID(bucketStart: number, anonProjectID: string, providerID: string, modelID: string): string;
export declare function enqueueRequestBucket(db: Database, metrics: RequestMetrics, anonProjectID: string, bucketSeconds: number): void;
export declare function getPendingUploadBuckets(db: Database, limit?: number): UploadBucketPayload[];
export declare function getUploadQueueStatus(db: Database): UploadQueueStatus;
export declare function getUploadQueueEntries(db: Database, limit?: number, status?: string): UploadQueueEntry[];
export declare function markUploadBucketSent(db: Database, id: string): void;
export declare function markUploadBucketFailed(db: Database, id: string, error: string, retryAfterSeconds: number): void;
//# sourceMappingURL=queue.d.ts.map
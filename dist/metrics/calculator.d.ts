import type { ModelStats, RequestMetrics } from "../types";
export interface SessionAverages {
    avgOutputTps: number;
    avgTotalTps: number;
    avgDurationMs: number;
    avgInputTokens: number;
    avgOutputTokens: number;
    avgCost: number;
}
export interface SessionTotals {
    requestCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalReasoningTokens: number;
    totalCacheReadTokens: number;
    totalCacheWriteTokens: number;
    totalTokens: number;
    totalCost: number;
}
export declare function round(num: number, digits?: number): number;
export declare function durationMs(startedAt: number, completedAt: number): number;
export declare function outputTps(outputTokens: number, durationMsValue: number): number;
export declare function totalTps(totalTokens: number, durationMsValue: number): number;
export declare function withComputedSpeed(metrics: RequestMetrics): RequestMetrics;
export declare function computeSessionTotals(items: RequestMetrics[]): SessionTotals;
export declare function computeSessionAverages(items: RequestMetrics[]): SessionAverages;
export declare function aggregateModelStats(items: RequestMetrics[]): ModelStats[];
//# sourceMappingURL=calculator.d.ts.map
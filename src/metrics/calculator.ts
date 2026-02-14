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

export function round(num: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(num * factor) / factor;
}

export function durationMs(startedAt: number, completedAt: number): number {
  return Math.max(0, completedAt - startedAt);
}

export function outputTps(outputTokens: number, durationMsValue: number): number {
  if (durationMsValue <= 0) return 0;
  return round((outputTokens / durationMsValue) * 1000);
}

export function totalTps(totalTokens: number, durationMsValue: number): number {
  if (durationMsValue <= 0) return 0;
  return round((totalTokens / durationMsValue) * 1000);
}

export function withComputedSpeed(metrics: RequestMetrics): RequestMetrics {
  if (!metrics.completedAt) return metrics;
  const ms = durationMs(metrics.startedAt, metrics.completedAt);
  return {
    ...metrics,
    durationMs: ms,
    outputTps: outputTps(metrics.outputTokens, ms),
    totalTps: totalTps(metrics.totalTokens, ms),
  };
}

export function computeSessionTotals(items: RequestMetrics[]): SessionTotals {
  return items.reduce<SessionTotals>(
    (acc, item) => {
      acc.requestCount += 1;
      acc.totalInputTokens += item.inputTokens;
      acc.totalOutputTokens += item.outputTokens;
      acc.totalReasoningTokens += item.reasoningTokens;
      acc.totalCacheReadTokens += item.cacheReadTokens;
      acc.totalCacheWriteTokens += item.cacheWriteTokens;
      acc.totalTokens += item.totalTokens;
      acc.totalCost += item.cost ?? 0;
      return acc;
    },
    {
      requestCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalReasoningTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalTokens: 0,
      totalCost: 0,
    },
  );
}

export function computeSessionAverages(items: RequestMetrics[]): SessionAverages {
  if (items.length === 0) {
    return {
      avgOutputTps: 0,
      avgTotalTps: 0,
      avgDurationMs: 0,
      avgInputTokens: 0,
      avgOutputTokens: 0,
      avgCost: 0,
    };
  }

  const totals = items.reduce(
    (acc, item) => {
      acc.outputTps += item.outputTps ?? 0;
      acc.totalTps += item.totalTps ?? 0;
      acc.durationMs += item.durationMs ?? 0;
      acc.inputTokens += item.inputTokens;
      acc.outputTokens += item.outputTokens;
      acc.cost += item.cost ?? 0;
      return acc;
    },
    { outputTps: 0, totalTps: 0, durationMs: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
  );

  return {
    avgOutputTps: round(totals.outputTps / items.length),
    avgTotalTps: round(totals.totalTps / items.length),
    avgDurationMs: round(totals.durationMs / items.length),
    avgInputTokens: round(totals.inputTokens / items.length),
    avgOutputTokens: round(totals.outputTokens / items.length),
    avgCost: round(totals.cost / items.length, 6),
  };
}

export function aggregateModelStats(items: RequestMetrics[]): ModelStats[] {
  const byModel = new Map<string, RequestMetrics[]>();

  for (const item of items) {
    const bucket = byModel.get(item.modelID);
    if (bucket) {
      bucket.push(item);
    } else {
      byModel.set(item.modelID, [item]);
    }
  }

  const result: ModelStats[] = [];
  for (const [modelID, records] of byModel) {
    const requestCount = records.length;
    const totalInputTokens = records.reduce((sum, r) => sum + r.inputTokens, 0);
    const totalOutputTokens = records.reduce((sum, r) => sum + r.outputTokens, 0);
    const tpsValues = records.map(r => r.outputTps ?? 0).filter(v => v > 0);
    const lastSeen = records.reduce((max, r) => Math.max(max, r.completedAt ?? r.startedAt), 0);

    result.push({
      modelID,
      requestCount,
      totalInputTokens,
      totalOutputTokens,
      avgOutputTps: tpsValues.length ? round(tpsValues.reduce((a, b) => a + b, 0) / tpsValues.length) : null,
      minOutputTps: tpsValues.length ? Math.min(...tpsValues) : null,
      maxOutputTps: tpsValues.length ? Math.max(...tpsValues) : null,
      lastSeen: lastSeen || null,
    });
  }

  return result.sort((a, b) => (b.avgOutputTps ?? 0) - (a.avgOutputTps ?? 0));
}

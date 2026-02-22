import { describe, expect, test } from "bun:test";
import { aggregateModelStats, aggregateProviderStats, outputTps, totalTps, withComputedSpeed } from "./calculator";
import type { RequestMetrics } from "../types";

function baseMetrics(overrides: Partial<RequestMetrics> = {}): RequestMetrics {
  return {
    id: "r1",
    sessionID: "s1",
    messageID: "m1",
    modelID: "model-a",
    inputTokens: 100,
    outputTokens: 200,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 300,
    startedAt: 1_000,
    completedAt: 3_000,
    ...overrides,
  };
}

describe("calculator", () => {
  test("returns zero tps for zero duration", () => {
    expect(outputTps(100, 0)).toBe(0);
    expect(totalTps(100, 0)).toBe(0);
  });

  test("computes speed from completed metrics", () => {
    const result = withComputedSpeed(baseMetrics());
    expect(result.durationMs).toBe(2000);
    expect(result.outputTps).toBe(100);
    expect(result.totalTps).toBe(150);
  });

  test("aggregates per-model stats", () => {
    const items = [
      withComputedSpeed(baseMetrics({ id: "r1", messageID: "m1", modelID: "model-a" })),
      withComputedSpeed(baseMetrics({ id: "r2", messageID: "m2", modelID: "model-a", outputTokens: 100 })),
      withComputedSpeed(baseMetrics({ id: "r3", messageID: "m3", modelID: "model-b", outputTokens: 50 })),
    ];

    const stats = aggregateModelStats(items);
    const modelA = stats.find(s => s.modelID === "model-a");
    const modelB = stats.find(s => s.modelID === "model-b");

    expect(modelA?.requestCount).toBe(2);
    expect(modelA?.totalOutputTokens).toBe(300);
    expect(modelB?.requestCount).toBe(1);
  });

  test("aggregates per-provider stats", () => {
    const items = [
      withComputedSpeed(baseMetrics({ id: "r1", messageID: "m1", providerID: "openai", cost: 0.2 })),
      withComputedSpeed(baseMetrics({ id: "r2", messageID: "m2", providerID: "openai", cost: 0.2 })),
      withComputedSpeed(baseMetrics({ id: "r3", messageID: "m3", providerID: "anthropic", cost: 0.1 })),
    ];

    const stats = aggregateProviderStats(items);
    const openai = stats.find(s => s.providerID === "openai");
    const anthropic = stats.find(s => s.providerID === "anthropic");

    expect(openai?.requestCount).toBe(2);
    expect(openai?.totalCost).toBe(0.4);
    expect(anthropic?.requestCount).toBe(1);
  });
});

import { describe, expect, test } from "bun:test";
import type { EventMessagePartUpdated, EventMessageUpdated, EventSessionIdle } from "@opencode-ai/sdk";
import { MetricsCollector } from "./collector";
import type { PluginState, RequestMetrics } from "../types";

function baseState(): PluginState {
  return {
    enabled: true,
    backgroundEnabled: false,
    sessionStats: {
      requestCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
    },
    activeRequests: {},
    lastMetrics: null,
  };
}

describe("collector", () => {
  test("correlates message and step-finish into finalized metrics on session idle", async () => {
    const state = baseState();
    const completed: RequestMetrics[] = [];
    const collector = new MetricsCollector(state, m => {
      completed.push(m);
    });

    const messageEvent: EventMessageUpdated = {
      type: "message.updated",
      properties: {
        info: {
          id: "msg-1",
          sessionID: "ses-1",
          role: "assistant",
          time: { created: 1000, completed: 2500 },
          parentID: "parent-1",
          modelID: "model-a",
          providerID: "provider-a",
          mode: "chat",
          path: { cwd: ".", root: "." },
          cost: 0.1,
          tokens: {
            input: 10,
            output: 20,
            reasoning: 5,
            cache: { read: 1, write: 0 },
          },
        },
      },
    };

    const partEvent: EventMessagePartUpdated = {
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-1",
          sessionID: "ses-1",
          messageID: "msg-1",
          type: "step-finish",
          reason: "complete",
          cost: 0.1,
          tokens: {
            input: 10,
            output: 20,
            reasoning: 5,
            cache: { read: 1, write: 0 },
          },
        },
      },
    };

    const idleEvent: EventSessionIdle = {
      type: "session.idle",
      properties: { sessionID: "ses-1" },
    };

    await collector.handle(messageEvent);
    await collector.handle(partEvent);
    await collector.handle(idleEvent);

    expect(completed.length).toBe(1);
    expect(completed[0]?.modelID).toBe("model-a");
    expect(completed[0]?.totalTokens).toBe(35);
    expect(state.activeRequests["msg-1"]).toBeUndefined();
  });
});

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { RequestMetrics } from "../types";
import {
  getProjects,
  getProviderStats,
  getRecentRequests,
  getSessionStats,
  getSessionStatsWithFilters,
  getSessions,
  saveRequest,
} from "./database";
import { runMigrations } from "./migrations";

function sampleRequest(overrides: Partial<RequestMetrics> = {}): RequestMetrics {
  return {
    id: "req-1",
    sessionID: "ses-1",
    messageID: "msg-1",
    projectID: "/tmp/project-a",
    modelID: "model-a",
    providerID: "provider-a",
    inputTokens: 10,
    outputTokens: 20,
    reasoningTokens: 2,
    cacheReadTokens: 1,
    cacheWriteTokens: 0,
    totalTokens: 32,
    startedAt: 1000,
    completedAt: 2000,
    durationMs: 1000,
    outputTps: 20,
    totalTps: 32,
    cost: 0.01,
    ...overrides,
  };
}

describe("database", () => {
  test("saves and reads request rows", () => {
    const db = new Database(":memory:", { strict: true });
    runMigrations(db);

    saveRequest(db, sampleRequest());

    const rows = getRecentRequests(db, 10);
    expect(rows.length).toBe(1);
    expect(rows[0]?.modelID).toBe("model-a");
    expect(rows[0]?.outputTokens).toBe(20);

    const totals = getSessionStats(db);
    expect(totals.requestCount).toBe(1);
    expect(totals.totalTokens).toBe(32);

    const sessions = getSessions(db, 10);
    expect(sessions.length).toBe(1);
    expect(sessions[0]?.id).toBe("ses-1");

    const providers = getProviderStats(db);
    expect(providers.length).toBe(1);
    expect(providers[0]?.providerID).toBe("provider-a");

    const filteredTotals = getSessionStatsWithFilters(db, { projectID: "/tmp/project-a" });
    expect(filteredTotals.requestCount).toBe(1);

    const projects = getProjects(db, 10);
    expect(projects.length).toBe(1);
    expect(projects[0]?.projectID).toBe("/tmp/project-a");

    db.close();
  });
});

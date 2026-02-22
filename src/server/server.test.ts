import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { saveRequest } from "../storage/database";
import { runMigrations } from "../storage/migrations";
import { startApiServer } from "./server";

describe("api server", () => {
  test("serves stats and history endpoints", async () => {
    const db = new Database(":memory:", { strict: true });
    runMigrations(db);

    saveRequest(db, {
      id: "req-1",
      sessionID: "ses-1",
      messageID: "msg-1",
      projectID: "/tmp/project-a",
      modelID: "model-a",
      providerID: "openai",
      inputTokens: 10,
      outputTokens: 20,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 30,
      startedAt: 1000,
      completedAt: 2000,
      durationMs: 1000,
      outputTps: 20,
      totalTps: 30,
      cost: 0.01,
    });

    saveRequest(db, {
      id: "req-2",
      sessionID: "ses-2",
      messageID: "msg-2",
      projectID: "/tmp/project-b",
      modelID: "model-b",
      providerID: "anthropic",
      inputTokens: 5,
      outputTokens: 15,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 20,
      startedAt: 3000,
      completedAt: 5000,
      durationMs: 2000,
      outputTps: 7.5,
      totalTps: 10,
      cost: 0.02,
    });

    let flushCalls = 0;
    const server = startApiServer(db, 0, {
      uploadEnabled: true,
      uploadHubURL: "https://hub.example.test",
      flushUploadNow: async () => {
        flushCalls += 1;
      },
    });

    const statsRes = await fetch(`${server.url}api/stats`);
    expect(statsRes.status).toBe(200);
    const stats = await statsRes.json();
    expect(stats.requestCount).toBe(2);

    const filteredStatsRes = await fetch(`${server.url}api/stats?providerId=openai`);
    expect(filteredStatsRes.status).toBe(200);
    const filteredStats = await filteredStatsRes.json();
    expect(filteredStats.requestCount).toBe(1);

    const filteredByProjectStatsRes = await fetch(`${server.url}api/stats?projectId=${encodeURIComponent("/tmp/project-b")}`);
    expect(filteredByProjectStatsRes.status).toBe(200);
    const filteredByProjectStats = await filteredByProjectStatsRes.json();
    expect(filteredByProjectStats.requestCount).toBe(1);

    const providersRes = await fetch(`${server.url}api/stats/providers`);
    expect(providersRes.status).toBe(200);
    const providers = await providersRes.json();
    expect(Array.isArray(providers)).toBe(true);
    expect(providers.some((item: { providerID: string }) => item.providerID === "openai")).toBe(true);

    const filteredProvidersRes = await fetch(`${server.url}api/stats/providers?modelId=model-b`);
    expect(filteredProvidersRes.status).toBe(200);
    const filteredProviders = await filteredProvidersRes.json();
    expect(filteredProviders.length).toBe(1);
    expect(filteredProviders[0]?.providerID).toBe("anthropic");

    const projectsRes = await fetch(`${server.url}api/projects?limit=10`);
    expect(projectsRes.status).toBe(200);
    const projects = await projectsRes.json();
    expect(Array.isArray(projects)).toBe(true);
    expect(projects.length).toBe(2);

    const uploadStatusRes = await fetch(`${server.url}api/upload/status`);
    expect(uploadStatusRes.status).toBe(200);
    const uploadStatus = await uploadStatusRes.json();
    expect(uploadStatus.enabled).toBe(true);
    expect(uploadStatus.hubUrl).toBe("https://hub.example.test");
    expect(uploadStatus.queue.pending).toBe(0);

    const uploadQueueRes = await fetch(`${server.url}api/upload/queue?limit=10`);
    expect(uploadQueueRes.status).toBe(200);
    const uploadQueue = await uploadQueueRes.json();
    expect(Array.isArray(uploadQueue)).toBe(true);

    const flushRes = await fetch(`${server.url}api/upload/flush`, { method: "POST" });
    expect(flushRes.status).toBe(200);
    expect(flushCalls).toBe(1);

    const dashboardRes = await fetch(server.url);
    expect(dashboardRes.status).toBe(200);
    const dashboardHtml = await dashboardRes.text();
    expect(dashboardHtml.includes("TokenSpeed Local Dashboard")).toBe(true);

    const historyRes = await fetch(`${server.url}api/history?limit=10`);
    expect(historyRes.status).toBe(200);
    const history = await historyRes.json();
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBe(2);

    const filteredHistoryRes = await fetch(`${server.url}api/history?providerId=openai&limit=10`);
    expect(filteredHistoryRes.status).toBe(200);
    const filteredHistory = await filteredHistoryRes.json();
    expect(filteredHistory.length).toBe(1);
    expect(filteredHistory[0]?.providerID).toBe("openai");

    const projectHistoryRes = await fetch(`${server.url}api/history?projectId=${encodeURIComponent("/tmp/project-b")}&limit=10`);
    expect(projectHistoryRes.status).toBe(200);
    const projectHistory = await projectHistoryRes.json();
    expect(projectHistory.length).toBe(1);
    expect(projectHistory[0]?.projectID).toBe("/tmp/project-b");

    await server.stop();
    db.close();
  });
});

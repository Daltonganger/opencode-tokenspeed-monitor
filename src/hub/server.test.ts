import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runHubMigrations } from "./database";
import { startHubServer } from "./server";

function signPayload(payload: string, timestamp: string, nonce: string, key: string): string {
  return createHmac("sha256", key).update(`${timestamp}.${nonce}.${payload}`).digest("hex");
}

describe("hub server", () => {
  test("registers device and accepts signed ingest", async () => {
    const db = new Database(":memory:", { strict: true });
    runHubMigrations(db);
    const server = startHubServer(0, {
      db,
      inviteToken: "invite-token",
      adminToken: "admin-token",
    });

    const registerRes = await fetch(`${server.url}v1/devices/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        deviceId: "dev_a",
        label: "Laptop A",
        inviteToken: "invite-token",
      }),
    });
    expect(registerRes.status).toBe(200);
    const registered = await registerRes.json();
    expect(registered.deviceId).toBe("dev_a");
    expect(typeof registered.signingKey).toBe("string");
    expect(registered.signingKey.length).toBeGreaterThan(10);

    const devicesRes = await fetch(`${server.url}v1/devices?limit=10`, {
      headers: {
        "X-TS-Admin-Token": "admin-token",
      },
    });
    expect(devicesRes.status).toBe(200);
    const devices = await devicesRes.json();
    expect(Array.isArray(devices)).toBe(true);
    expect(devices[0]?.deviceId).toBe("dev_a");
    expect(typeof devices[0]?.anonUserId).toBe("string");

    const body = {
      schemaVersion: 1,
      deviceId: "dev_a",
      buckets: [
        {
          bucketStart: 1_700_000_000,
          bucketEnd: 1_700_000_299,
          anonProjectId: "anon_project_a",
          providerId: "openai",
          modelId: "gpt-5.3-codex",
          requestCount: 2,
          inputTokens: 200,
          outputTokens: 100,
          reasoningTokens: 20,
          cacheReadTokens: 5,
          cacheWriteTokens: 1,
          totalCost: 0.12,
          avgOutputTps: 50,
          minOutputTps: 40,
          maxOutputTps: 60,
        },
        {
          bucketStart: 1_700_000_000,
          bucketEnd: 1_700_000_299,
          anonProjectId: "anon_project_b",
          providerId: "anthropic",
          modelId: "claude-sonnet",
          requestCount: 1,
          inputTokens: 50,
          outputTokens: 40,
          reasoningTokens: 10,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalCost: 0.08,
          avgOutputTps: 20,
          minOutputTps: 20,
          maxOutputTps: 20,
        },
      ],
    };
    const raw = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(12).toString("hex");
    const signature = signPayload(raw, timestamp, nonce, registered.signingKey);

    const ingestRes = await fetch(`${server.url}v1/ingest/buckets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-TS-Device-ID": "dev_a",
        "X-TS-Timestamp": timestamp,
        "X-TS-Nonce": nonce,
        "X-TS-Signature": signature,
      },
      body: raw,
    });
    expect(ingestRes.status).toBe(200);
    const ingestJson = await ingestRes.json();
    expect(ingestJson.accepted).toBe(2);

    const summaryRes = await fetch(`${server.url}v1/dashboard/summary`);
    expect(summaryRes.status).toBe(200);
    const summary = await summaryRes.json();
    expect(summary.requestCount).toBe(3);
    expect(summary.totalInputTokens).toBe(250);
    expect(summary.totalOutputTokens).toBe(140);
    expect(summary.totalCost).toBe(0.2);

    const filteredSummaryRes = await fetch(`${server.url}v1/dashboard/summary?providerId=openai`);
    expect(filteredSummaryRes.status).toBe(200);
    const filteredSummary = await filteredSummaryRes.json();
    expect(filteredSummary.requestCount).toBe(2);
    expect(filteredSummary.totalInputTokens).toBe(200);

    const modelsRes = await fetch(`${server.url}v1/dashboard/models`);
    expect(modelsRes.status).toBe(200);
    const models = await modelsRes.json();
    expect(models.length).toBe(2);
    expect(models.some((item: { providerId: string }) => item.providerId === "openai")).toBe(true);

    const filteredModelsRes = await fetch(`${server.url}v1/dashboard/models?providerId=anthropic`);
    expect(filteredModelsRes.status).toBe(200);
    const filteredModels = await filteredModelsRes.json();
    expect(filteredModels.length).toBe(1);
    expect(filteredModels[0]?.providerId).toBe("anthropic");

    const providersRes = await fetch(`${server.url}v1/dashboard/providers`);
    expect(providersRes.status).toBe(200);
    const providers = await providersRes.json();
    expect(providers.length).toBe(2);
    expect(providers.some((item: { providerId: string }) => item.providerId === "openai")).toBe(true);

    const filteredProvidersRes = await fetch(`${server.url}v1/dashboard/providers?modelId=claude-sonnet`);
    expect(filteredProvidersRes.status).toBe(200);
    const filteredProviders = await filteredProvidersRes.json();
    expect(filteredProviders.length).toBe(1);
    expect(filteredProviders[0]?.providerId).toBe("anthropic");

    const projectsRes = await fetch(`${server.url}v1/dashboard/projects`);
    expect(projectsRes.status).toBe(200);
    const projects = await projectsRes.json();
    expect(projects.length).toBe(2);
    const filteredProjectsRes = await fetch(`${server.url}v1/dashboard/projects?anonProjectId=anon_project_b`);
    expect(filteredProjectsRes.status).toBe(200);
    const filteredProjects = await filteredProjectsRes.json();
    expect(filteredProjects.length).toBe(1);
    expect(filteredProjects[0]?.anonProjectId).toBe("anon_project_b");

    const timeseriesRes = await fetch(`${server.url}v1/dashboard/timeseries?metric=tokens&groupBy=hour&limit=10`);
    expect(timeseriesRes.status).toBe(200);
    const timeseries = await timeseriesRes.json();
    expect(Array.isArray(timeseries)).toBe(true);
    expect(timeseries.length).toBe(1);
    expect(timeseries[0]?.value).toBe(420);

    const filteredSeriesRes = await fetch(
      `${server.url}v1/dashboard/timeseries?metric=tokens&groupBy=hour&providerId=openai&limit=10`,
    );
    expect(filteredSeriesRes.status).toBe(200);
    const filteredSeries = await filteredSeriesRes.json();
    expect(filteredSeries[0]?.value).toBe(320);

    const exportRes = await fetch(`${server.url}v1/dashboard/export.csv?providerId=openai`);
    expect(exportRes.status).toBe(200);
    expect(exportRes.headers.get("content-type")?.includes("text/csv")).toBe(true);
    const exportCsv = await exportRes.text();
    expect(exportCsv.includes("rowType,from,to,anonProjectId")).toBe(true);
    expect(exportCsv.includes(",openai,")).toBe(true);
    expect(exportCsv.includes("anthropic")).toBe(false);

    const exportJsonRes = await fetch(`${server.url}v1/dashboard/export.json?providerId=openai&groupBy=hour`);
    expect(exportJsonRes.status).toBe(200);
    const exportJson = await exportJsonRes.json();
    expect(exportJson.query.filters.providerId).toBe("openai");
    expect(exportJson.models.length).toBe(1);
    expect(exportJson.models[0]?.providerId).toBe("openai");
    expect(exportJson.providers.length).toBe(1);
    expect(exportJson.providers[0]?.providerId).toBe("openai");
    expect(Array.isArray(exportJson.timeseries.tokens)).toBe(true);

    const bootstrapRes = await fetch(`${server.url}v1/devices/bootstrap`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        deviceId: "dev_boot",
        anonUserId: "usr_person_1",
        label: "Bootstrap Laptop",
      }),
    });
    expect(bootstrapRes.status).toBe(200);
    const boot = await bootstrapRes.json();
    expect(boot.deviceId).toBe("dev_boot");
    expect(boot.anonUserId).toBe("usr_person_1");

    const bootBody = {
      schemaVersion: 1,
      deviceId: "dev_boot",
      buckets: [
        {
          bucketStart: 1_700_000_300,
          bucketEnd: 1_700_000_599,
          anonProjectId: "anon_project_boot",
          providerId: "openai",
          modelId: "gpt-5.3-codex",
          requestCount: 4,
          inputTokens: 400,
          outputTokens: 120,
          reasoningTokens: 30,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalCost: 0.22,
          avgOutputTps: 35,
          minOutputTps: 31,
          maxOutputTps: 39,
        },
      ],
    };
    const bootRaw = JSON.stringify(bootBody);
    const bootTs = Math.floor(Date.now() / 1000).toString();
    const bootNonce = randomBytes(12).toString("hex");
    const bootSig = signPayload(bootRaw, bootTs, bootNonce, boot.signingKey);
    const bootIngestRes = await fetch(`${server.url}v1/ingest/buckets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-TS-Device-ID": "dev_boot",
        "X-TS-Timestamp": bootTs,
        "X-TS-Nonce": bootNonce,
        "X-TS-Signature": bootSig,
      },
      body: bootRaw,
    });
    expect(bootIngestRes.status).toBe(200);

    const userFilterSummaryRes = await fetch(`${server.url}v1/dashboard/summary?anonUserId=usr_person_1`);
    expect(userFilterSummaryRes.status).toBe(200);
    const userFilterSummary = await userFilterSummaryRes.json();
    expect(userFilterSummary.requestCount).toBe(4);
    expect(userFilterSummary.totalInputTokens).toBe(400);

    const deviceFilterSummaryRes = await fetch(`${server.url}v1/dashboard/summary?deviceId=dev_boot`);
    expect(deviceFilterSummaryRes.status).toBe(200);
    const deviceFilterSummary = await deviceFilterSummaryRes.json();
    expect(deviceFilterSummary.requestCount).toBe(4);

    const filteredDevicesRes = await fetch(`${server.url}v1/devices?anonUserId=usr_person_1`, {
      headers: {
        "X-TS-Admin-Token": "admin-token",
      },
    });
    expect(filteredDevicesRes.status).toBe(200);
    const filteredDevices = await filteredDevicesRes.json();
    expect(filteredDevices.length).toBe(1);
    expect(filteredDevices[0]?.deviceId).toBe("dev_boot");

    const dashboardRes = await fetch(server.url);
    expect(dashboardRes.status).toBe(200);
    const dashboardHtml = await dashboardRes.text();
    expect(dashboardHtml.includes("TokenSpeed Hub Dashboard")).toBe(true);

    const healthRes = await fetch(`${server.url}v1/health`);
    expect(healthRes.status).toBe(200);
    const health = await healthRes.json();
    expect(health.ok).toBe(true);

    const adminRes = await fetch(`${server.url}admin`);
    expect(adminRes.status).toBe(401);
    const adminLoginHtml = await adminRes.text();
    expect(adminLoginHtml.includes("Admin access requires")).toBe(true);

    const badLoginRes = await fetch(`${server.url}admin/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ adminToken: "bad-token" }).toString(),
    });
    expect(badLoginRes.status).toBe(403);

    const loginRes = await fetch(`${server.url}admin/login`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ adminToken: "admin-token" }).toString(),
    });
    expect(loginRes.status).toBe(303);
    const cookie = loginRes.headers.get("set-cookie") ?? "";
    expect(cookie.includes("ts_hub_admin_token=")).toBe(true);

    const adminWithCookieRes = await fetch(`${server.url}admin`, {
      headers: {
        Cookie: cookie.split(";")[0] ?? "",
      },
    });
    expect(adminWithCookieRes.status).toBe(200);
    const adminHtml = await adminWithCookieRes.text();
    expect(adminHtml.includes("TokenSpeed Hub Admin")).toBe(true);
    expect(adminHtml.includes("Bulk Revoke")).toBe(true);

    await server.stop();
    db.close();
  });

  test("rejects replay nonce, invalid signature, and revoked device ingest", async () => {
    const db = new Database(":memory:", { strict: true });
    runHubMigrations(db);
    const server = startHubServer(0, {
      db,
      inviteToken: "invite-token",
      adminToken: "admin-token",
    });

    const registerRes = await fetch(`${server.url}v1/devices/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        deviceId: "dev_b",
        inviteToken: "invite-token",
      }),
    });
    expect(registerRes.status).toBe(200);
    const registered = await registerRes.json();

    const body = {
      schemaVersion: 1,
      deviceId: "dev_b",
      buckets: [
        {
          bucketStart: 1_700_000_600,
          bucketEnd: 1_700_000_899,
          anonProjectId: "anon_project_b",
          providerId: "anthropic",
          modelId: "claude-sonnet",
          requestCount: 1,
          inputTokens: 50,
          outputTokens: 40,
          reasoningTokens: 3,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalCost: 0.08,
          avgOutputTps: 20,
          minOutputTps: 20,
          maxOutputTps: 20,
        },
      ],
    };

    const raw = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = "nonce-replay";
    const signature = signPayload(raw, timestamp, nonce, registered.signingKey);

    const first = await fetch(`${server.url}v1/ingest/buckets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-TS-Device-ID": "dev_b",
        "X-TS-Timestamp": timestamp,
        "X-TS-Nonce": nonce,
        "X-TS-Signature": signature,
      },
      body: raw,
    });
    expect(first.status).toBe(200);

    const replay = await fetch(`${server.url}v1/ingest/buckets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-TS-Device-ID": "dev_b",
        "X-TS-Timestamp": timestamp,
        "X-TS-Nonce": nonce,
        "X-TS-Signature": signature,
      },
      body: raw,
    });
    expect(replay.status).toBe(401);

    const badSig = await fetch(`${server.url}v1/ingest/buckets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-TS-Device-ID": "dev_b",
        "X-TS-Timestamp": timestamp,
        "X-TS-Nonce": "other-nonce",
        "X-TS-Signature": "invalid",
      },
      body: raw,
    });
    expect(badSig.status).toBe(401);

    const revokeRes = await fetch(`${server.url}v1/devices/bulk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer admin-token",
      },
      body: JSON.stringify({ action: "revoke", deviceIds: ["dev_b", "missing_dev"] }),
    });
    expect(revokeRes.status).toBe(200);
    const revokedBody = await revokeRes.json();
    expect(revokedBody.updated).toEqual(["dev_b"]);
    expect(revokedBody.missing).toEqual(["missing_dev"]);

    const timestamp2 = Math.floor(Date.now() / 1000).toString();
    const nonce2 = randomBytes(12).toString("hex");
    const signature2 = signPayload(raw, timestamp2, nonce2, registered.signingKey);
    const revokedUpload = await fetch(`${server.url}v1/ingest/buckets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-TS-Device-ID": "dev_b",
        "X-TS-Timestamp": timestamp2,
        "X-TS-Nonce": nonce2,
        "X-TS-Signature": signature2,
      },
      body: raw,
    });
    expect(revokedUpload.status).toBe(403);

    const activateRes = await fetch(`${server.url}v1/devices/bulk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-TS-Admin-Token": "admin-token",
      },
      body: JSON.stringify({ action: "activate", deviceIds: ["dev_b"] }),
    });
    expect(activateRes.status).toBe(200);
    const activatedBody = await activateRes.json();
    expect(activatedBody.updated).toEqual(["dev_b"]);

    const timestamp3 = Math.floor(Date.now() / 1000).toString();
    const nonce3 = randomBytes(12).toString("hex");
    const signature3 = signPayload(raw, timestamp3, nonce3, registered.signingKey);
    const activeUpload = await fetch(`${server.url}v1/ingest/buckets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-TS-Device-ID": "dev_b",
        "X-TS-Timestamp": timestamp3,
        "X-TS-Nonce": nonce3,
        "X-TS-Signature": signature3,
      },
      body: raw,
    });
    expect(activeUpload.status).toBe(200);

    await server.stop();
    db.close();
  });

  test("rate limits repeated failed admin login attempts", async () => {
    const db = new Database(":memory:", { strict: true });
    runHubMigrations(db);
    const server = startHubServer(0, {
      db,
      inviteToken: "invite-token",
      adminToken: "admin-token",
      adminLoginMaxAttempts: 2,
      adminLoginWindowSeconds: 300,
    });

    const badBody = new URLSearchParams({ adminToken: "wrong-token" }).toString();
    const headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Forwarded-For": "10.0.0.5",
    };

    const badAttempt1 = await fetch(`${server.url}admin/login`, {
      method: "POST",
      headers,
      body: badBody,
    });
    expect(badAttempt1.status).toBe(403);

    const badAttempt2 = await fetch(`${server.url}admin/login`, {
      method: "POST",
      headers,
      body: badBody,
    });
    expect(badAttempt2.status).toBe(403);

    const badAttempt3 = await fetch(`${server.url}admin/login`, {
      method: "POST",
      headers,
      body: badBody,
    });
    expect(badAttempt3.status).toBe(429);
    const limitedHtml = await badAttempt3.text();
    expect(limitedHtml.includes("Too many login attempts")).toBe(true);

    const correctAttempt = await fetch(`${server.url}admin/login`, {
      method: "POST",
      headers,
      body: new URLSearchParams({ adminToken: "admin-token" }).toString(),
    });
    expect(correctAttempt.status).toBe(429);

    await server.stop();
    db.close();
  });
});

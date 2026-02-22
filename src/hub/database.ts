import { mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { resolveOpenCodeHome } from "../storage/migrations";

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

type RangeParams = {
  from: number;
  to: number;
};

type FilterParams = {
  anon_project_id: string | null;
  provider_id: string | null;
  model_id: string | null;
};

type RangeFilterParams = RangeParams & FilterParams;

function resolveHubDbPath(dbPath?: string): string {
  if (dbPath?.trim()) return resolve(dbPath);
  const configured = process.env.TS_HUB_DB_PATH?.trim();
  if (configured) return resolve(configured);
  return join(resolveOpenCodeHome(), "tokenspeed-monitor", "hub.sqlite");
}

export function openHubDatabase(dbPath?: string): Database {
  const absolutePath = resolveHubDbPath(dbPath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  const db = new Database(absolutePath, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL;");
  runHubMigrations(db);
  return db;
}

export function runHubMigrations(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hub_buckets (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      bucket_start INTEGER NOT NULL,
      bucket_end INTEGER NOT NULL,
      anon_project_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      total_cost REAL NOT NULL DEFAULT 0,
      avg_output_tps REAL,
      min_output_tps REAL,
      max_output_tps REAL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      UNIQUE(device_id, bucket_start, bucket_end, anon_project_id, provider_id, model_id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS hub_devices (
      id TEXT PRIMARY KEY,
      label TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      signing_key TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      last_seen INTEGER,
      revoked_at INTEGER
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS hub_nonces (
      device_id TEXT NOT NULL,
      nonce TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      expires_at INTEGER NOT NULL,
      PRIMARY KEY(device_id, nonce)
    );
  `);

  db.exec("CREATE INDEX IF NOT EXISTS idx_hub_buckets_bucket_start ON hub_buckets(bucket_start);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_hub_buckets_provider_model ON hub_buckets(provider_id, model_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_hub_buckets_project ON hub_buckets(anon_project_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_hub_devices_status ON hub_devices(status);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_hub_nonces_expiry ON hub_nonces(expires_at);");
}

function mapHubDevice(row: {
  id: string;
  label: string | null;
  status: string;
  signing_key: string;
  created_at: number;
  updated_at: number;
  last_seen: number | null;
  revoked_at: number | null;
}): HubDeviceRecord {
  return {
    deviceId: row.id,
    label: row.label,
    status: row.status === "revoked" ? "revoked" : "active",
    signingKey: row.signing_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeen: row.last_seen,
    revokedAt: row.revoked_at,
  };
}

export function getHubDevice(db: Database, deviceID: string): HubDeviceRecord | null {
  const row = db
    .query<
      {
        id: string;
        label: string | null;
        status: string;
        signing_key: string;
        created_at: number;
        updated_at: number;
        last_seen: number | null;
        revoked_at: number | null;
      },
      { id: string }
    >(
      `SELECT
         id, label, status, signing_key, created_at, updated_at, last_seen, revoked_at
       FROM hub_devices
       WHERE id = $id
       LIMIT 1;`,
    )
    .get({ id: deviceID });

  return row ? mapHubDevice(row) : null;
}

export function registerHubDevice(db: Database, deviceID: string, label?: string | null): HubDeviceRecord {
  const existing = getHubDevice(db, deviceID);
  const now = Math.floor(Date.now() / 1000);

  if (existing && existing.status === "active") {
    db.query(
      `UPDATE hub_devices
       SET label = COALESCE($label, label),
           updated_at = $now
       WHERE id = $id;`,
    ).run({ id: deviceID, label: label ?? null, now });
    const fresh = getHubDevice(db, deviceID);
    if (fresh) return fresh;
  }

  const signingKey = randomBytes(32).toString("hex");
  db.query(
    `INSERT INTO hub_devices (id, label, status, signing_key, created_at, updated_at, revoked_at)
     VALUES ($id, $label, 'active', $signing_key, $now, $now, NULL)
     ON CONFLICT(id) DO UPDATE SET
       label = COALESCE(excluded.label, hub_devices.label),
       status = 'active',
       signing_key = excluded.signing_key,
       updated_at = excluded.updated_at,
       revoked_at = NULL;`,
  ).run({
    id: deviceID,
    label: label ?? null,
    signing_key: signingKey,
    now,
  });

  const created = getHubDevice(db, deviceID);
  if (!created) {
    throw new Error("Failed to register hub device");
  }
  return created;
}

export function revokeHubDevice(db: Database, deviceID: string): boolean {
  const now = Math.floor(Date.now() / 1000);
  const result = db.query(
    `UPDATE hub_devices
     SET status = 'revoked',
         revoked_at = $now,
         updated_at = $now
     WHERE id = $id;`,
  ).run({ id: deviceID, now });

  return result.changes > 0;
}

export function activateHubDevice(db: Database, deviceID: string): boolean {
  const now = Math.floor(Date.now() / 1000);
  const result = db.query(
    `UPDATE hub_devices
     SET status = 'active',
         revoked_at = NULL,
         updated_at = $now
     WHERE id = $id;`,
  ).run({ id: deviceID, now });

  return result.changes > 0;
}

export function bulkSetHubDevicesStatus(
  db: Database,
  deviceIDs: string[],
  status: "active" | "revoked",
): { updated: string[]; missing: string[] } {
  const uniqueIDs = [...new Set(deviceIDs.map(id => id.trim()).filter(Boolean))];
  if (uniqueIDs.length === 0) {
    return { updated: [], missing: [] };
  }

  const missing: string[] = [];
  const updated: string[] = [];
  const now = Math.floor(Date.now() / 1000);

  const tx = db.transaction((ids: string[]) => {
    const query = db.query(
      `UPDATE hub_devices
       SET status = $status,
           revoked_at = $revoked_at,
           updated_at = $now
       WHERE id = $id;`,
    );

    for (const id of ids) {
      const result = query.run({
        id,
        status,
        revoked_at: status === "revoked" ? now : null,
        now,
      });
      if (result.changes > 0) {
        updated.push(id);
      } else {
        missing.push(id);
      }
    }
  });

  tx(uniqueIDs);
  return { updated, missing };
}

export function listHubDevices(db: Database, limit = 200): HubDeviceRecord[] {
  const safeLimit = Math.max(1, Math.min(limit, 1000));
  const rows = db
    .query<
      {
        id: string;
        label: string | null;
        status: string;
        signing_key: string;
        created_at: number;
        updated_at: number;
        last_seen: number | null;
        revoked_at: number | null;
      },
      { limit: number }
    >(
      `SELECT
         id, label, status, signing_key, created_at, updated_at, last_seen, revoked_at
       FROM hub_devices
       ORDER BY updated_at DESC
       LIMIT $limit;`,
    )
    .all({ limit: safeLimit });

  return rows.map(mapHubDevice);
}

export function touchHubDeviceSeen(db: Database, deviceID: string, seenAt: number): void {
  db.query(
    `UPDATE hub_devices
     SET last_seen = CASE
       WHEN last_seen IS NULL THEN $seen_at
       WHEN $seen_at > last_seen THEN $seen_at
       ELSE last_seen
     END,
     updated_at = strftime('%s', 'now')
     WHERE id = $id;`,
  ).run({ id: deviceID, seen_at: seenAt });
}

function bucketId(deviceID: string, bucket: HubBucketInput): string {
  return [
    deviceID,
    bucket.bucketStart,
    bucket.bucketEnd,
    bucket.anonProjectId,
    bucket.providerId,
    bucket.modelId,
  ].join(":");
}

export function upsertHubBuckets(db: Database, deviceID: string, buckets: HubBucketInput[]): void {
  if (buckets.length === 0) return;

  const upsert = db.query(
    `INSERT INTO hub_buckets (
       id, device_id, bucket_start, bucket_end, anon_project_id, provider_id, model_id,
       request_count, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens,
       total_cost, avg_output_tps, min_output_tps, max_output_tps, updated_at
     ) VALUES (
       $id, $device_id, $bucket_start, $bucket_end, $anon_project_id, $provider_id, $model_id,
       $request_count, $input_tokens, $output_tokens, $reasoning_tokens, $cache_read_tokens, $cache_write_tokens,
       $total_cost, $avg_output_tps, $min_output_tps, $max_output_tps, strftime('%s', 'now')
     )
     ON CONFLICT(id) DO UPDATE SET
       request_count = excluded.request_count,
       input_tokens = excluded.input_tokens,
       output_tokens = excluded.output_tokens,
       reasoning_tokens = excluded.reasoning_tokens,
       cache_read_tokens = excluded.cache_read_tokens,
       cache_write_tokens = excluded.cache_write_tokens,
       total_cost = excluded.total_cost,
       avg_output_tps = excluded.avg_output_tps,
       min_output_tps = excluded.min_output_tps,
       max_output_tps = excluded.max_output_tps,
       updated_at = strftime('%s', 'now');`,
  );

  const tx = db.transaction((items: HubBucketInput[]) => {
    for (const bucket of items) {
      upsert.run({
        id: bucketId(deviceID, bucket),
        device_id: deviceID,
        bucket_start: bucket.bucketStart,
        bucket_end: bucket.bucketEnd,
        anon_project_id: bucket.anonProjectId,
        provider_id: bucket.providerId,
        model_id: bucket.modelId,
        request_count: bucket.requestCount,
        input_tokens: bucket.inputTokens,
        output_tokens: bucket.outputTokens,
        reasoning_tokens: bucket.reasoningTokens,
        cache_read_tokens: bucket.cacheReadTokens,
        cache_write_tokens: bucket.cacheWriteTokens,
        total_cost: bucket.totalCost,
        avg_output_tps: bucket.avgOutputTps,
        min_output_tps: bucket.minOutputTps,
        max_output_tps: bucket.maxOutputTps,
      });
    }
  });

  tx(buckets);
}

export function cleanupExpiredNonces(db: Database, nowSec: number): void {
  db.query("DELETE FROM hub_nonces WHERE expires_at < $now;").run({ now: nowSec });
}

export function isNonceUsed(db: Database, deviceID: string, nonce: string): boolean {
  const row = db
    .query<{ found: number }, { device_id: string; nonce: string }>(
      "SELECT 1 AS found FROM hub_nonces WHERE device_id = $device_id AND nonce = $nonce LIMIT 1;",
    )
    .get({ device_id: deviceID, nonce });
  return row?.found === 1;
}

export function storeNonce(db: Database, deviceID: string, nonce: string, expiresAt: number): void {
  db.query(
    `INSERT INTO hub_nonces (device_id, nonce, expires_at)
     VALUES ($device_id, $nonce, $expires_at)
     ON CONFLICT(device_id, nonce) DO NOTHING;`,
  ).run({
    device_id: deviceID,
    nonce,
    expires_at: expiresAt,
  });
}

function rangeParams(from?: number | null, to?: number | null): RangeParams {
  return {
    from: Number.isFinite(from) ? Number(from) : 0,
    to: Number.isFinite(to) ? Number(to) : 2_147_483_647,
  };
}

function filterParams(filters: HubDashboardFilters = {}): FilterParams {
  const anonProjectId = filters.anonProjectId?.trim();
  const providerId = filters.providerId?.trim();
  const modelId = filters.modelId?.trim();

  return {
    anon_project_id: anonProjectId || null,
    provider_id: providerId || null,
    model_id: modelId || null,
  };
}

export function getHubSummary(
  db: Database,
  from?: number | null,
  to?: number | null,
  filters: HubDashboardFilters = {},
): HubSummary {
  const range = rangeParams(from, to);
  const params = { ...range, ...filterParams(filters) };
  const row = db
    .query<
      {
        request_count: number;
        total_input_tokens: number;
        total_output_tokens: number;
        total_reasoning_tokens: number;
        total_cache_read_tokens: number;
        total_cache_write_tokens: number;
        total_cost: number;
      },
      RangeFilterParams
    >(
      `SELECT
         COALESCE(SUM(request_count), 0) AS request_count,
         COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
         COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
         COALESCE(SUM(reasoning_tokens), 0) AS total_reasoning_tokens,
         COALESCE(SUM(cache_read_tokens), 0) AS total_cache_read_tokens,
         COALESCE(SUM(cache_write_tokens), 0) AS total_cache_write_tokens,
         COALESCE(SUM(total_cost), 0) AS total_cost
       FROM hub_buckets
       WHERE bucket_end >= $from
         AND bucket_start <= $to
         AND ($anon_project_id IS NULL OR anon_project_id = $anon_project_id)
         AND ($provider_id IS NULL OR provider_id = $provider_id)
         AND ($model_id IS NULL OR model_id = $model_id);`,
    )
    .get(params);

  return {
    requestCount: row?.request_count ?? 0,
    totalInputTokens: row?.total_input_tokens ?? 0,
    totalOutputTokens: row?.total_output_tokens ?? 0,
    totalReasoningTokens: row?.total_reasoning_tokens ?? 0,
    totalCacheReadTokens: row?.total_cache_read_tokens ?? 0,
    totalCacheWriteTokens: row?.total_cache_write_tokens ?? 0,
    totalCost: row?.total_cost ?? 0,
  };
}

export function getHubModels(
  db: Database,
  from?: number | null,
  to?: number | null,
  limit = 100,
  filters: HubDashboardFilters = {},
): HubModelRow[] {
  const safeLimit = Math.max(1, Math.min(limit, 1000));
  const range = rangeParams(from, to);
  const params = { ...range, ...filterParams(filters), limit: safeLimit };
  const rows = db
    .query<
      {
        model_id: string;
        provider_id: string;
        request_count: number;
        total_input_tokens: number;
        total_output_tokens: number;
        total_cost: number;
        avg_output_tps: number | null;
        min_output_tps: number | null;
        max_output_tps: number | null;
      },
      RangeFilterParams & { limit: number }
    >(
      `SELECT
         model_id,
         provider_id,
         COALESCE(SUM(request_count), 0) AS request_count,
         COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
         COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
         COALESCE(SUM(total_cost), 0) AS total_cost,
         AVG(avg_output_tps) AS avg_output_tps,
         MIN(min_output_tps) AS min_output_tps,
         MAX(max_output_tps) AS max_output_tps
       FROM hub_buckets
       WHERE bucket_end >= $from
         AND bucket_start <= $to
         AND ($anon_project_id IS NULL OR anon_project_id = $anon_project_id)
         AND ($provider_id IS NULL OR provider_id = $provider_id)
         AND ($model_id IS NULL OR model_id = $model_id)
       GROUP BY model_id, provider_id
       ORDER BY request_count DESC
       LIMIT $limit;`,
    )
    .all(params);

  return rows.map(row => ({
    modelId: row.model_id,
    providerId: row.provider_id,
    requestCount: row.request_count,
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    totalCost: row.total_cost,
    avgOutputTps: row.avg_output_tps,
    minOutputTps: row.min_output_tps,
    maxOutputTps: row.max_output_tps,
  }));
}

export function getHubProjects(
  db: Database,
  from?: number | null,
  to?: number | null,
  limit = 100,
  filters: HubDashboardFilters = {},
): HubProjectRow[] {
  const safeLimit = Math.max(1, Math.min(limit, 1000));
  const range = rangeParams(from, to);
  const params = { ...range, ...filterParams(filters), limit: safeLimit };
  const rows = db
    .query<
      {
        anon_project_id: string;
        request_count: number;
        total_input_tokens: number;
        total_output_tokens: number;
        total_cost: number;
        last_bucket_end: number | null;
      },
      RangeFilterParams & { limit: number }
    >(
      `SELECT
         anon_project_id,
         COALESCE(SUM(request_count), 0) AS request_count,
         COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
         COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
         COALESCE(SUM(total_cost), 0) AS total_cost,
         MAX(bucket_end) AS last_bucket_end
       FROM hub_buckets
       WHERE bucket_end >= $from
         AND bucket_start <= $to
         AND ($anon_project_id IS NULL OR anon_project_id = $anon_project_id)
         AND ($provider_id IS NULL OR provider_id = $provider_id)
         AND ($model_id IS NULL OR model_id = $model_id)
       GROUP BY anon_project_id
       ORDER BY request_count DESC
       LIMIT $limit;`,
    )
    .all(params);

  return rows.map(row => ({
    anonProjectId: row.anon_project_id,
    requestCount: row.request_count,
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    totalCost: row.total_cost,
    lastBucketEnd: row.last_bucket_end,
  }));
}

export function getHubProviders(
  db: Database,
  from?: number | null,
  to?: number | null,
  limit = 100,
  filters: HubDashboardFilters = {},
): HubProviderRow[] {
  const safeLimit = Math.max(1, Math.min(limit, 1000));
  const range = rangeParams(from, to);
  const params = { ...range, ...filterParams(filters), limit: safeLimit };
  const rows = db
    .query<
      {
        provider_id: string;
        request_count: number;
        total_input_tokens: number;
        total_output_tokens: number;
        total_cost: number;
        avg_output_tps: number | null;
        min_output_tps: number | null;
        max_output_tps: number | null;
      },
      RangeFilterParams & { limit: number }
    >(
      `SELECT
         provider_id,
         COALESCE(SUM(request_count), 0) AS request_count,
         COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
         COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
         COALESCE(SUM(total_cost), 0) AS total_cost,
         AVG(avg_output_tps) AS avg_output_tps,
         MIN(min_output_tps) AS min_output_tps,
         MAX(max_output_tps) AS max_output_tps
       FROM hub_buckets
       WHERE bucket_end >= $from
         AND bucket_start <= $to
         AND ($anon_project_id IS NULL OR anon_project_id = $anon_project_id)
         AND ($provider_id IS NULL OR provider_id = $provider_id)
         AND ($model_id IS NULL OR model_id = $model_id)
       GROUP BY provider_id
       ORDER BY request_count DESC
       LIMIT $limit;`,
    )
    .all(params);

  return rows.map(row => ({
    providerId: row.provider_id,
    requestCount: row.request_count,
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    totalCost: row.total_cost,
    avgOutputTps: row.avg_output_tps,
    minOutputTps: row.min_output_tps,
    maxOutputTps: row.max_output_tps,
  }));
}

export function getHubTimeseries(
  db: Database,
  metric: HubTimeseriesMetric,
  groupBy: HubTimeseriesGroupBy,
  from?: number | null,
  to?: number | null,
  limit = 200,
  filters: HubDashboardFilters = {},
): HubTimeseriesPoint[] {
  const safeLimit = Math.max(1, Math.min(limit, 2000));
  const range = rangeParams(from, to);
  const params = { ...range, ...filterParams(filters), bucket_seconds: groupBy === "day" ? 86400 : 3600, limit: safeLimit };

  const valueExpr =
    metric === "cost"
      ? "COALESCE(SUM(total_cost), 0)"
      : metric === "tps"
        ? `CASE WHEN COALESCE(SUM(request_count), 0) = 0
             THEN 0
             ELSE COALESCE(SUM(COALESCE(avg_output_tps, 0) * request_count), 0) / SUM(request_count)
           END`
        : "COALESCE(SUM(input_tokens + output_tokens + reasoning_tokens), 0)";

  const rows = db
    .query<
      {
        ts: number;
        value: number;
        request_count: number;
      },
      RangeFilterParams & { bucket_seconds: number; limit: number }
    >(
      `SELECT
         (bucket_start / $bucket_seconds) * $bucket_seconds AS ts,
         ${valueExpr} AS value,
         COALESCE(SUM(request_count), 0) AS request_count
       FROM hub_buckets
       WHERE bucket_end >= $from
         AND bucket_start <= $to
         AND ($anon_project_id IS NULL OR anon_project_id = $anon_project_id)
         AND ($provider_id IS NULL OR provider_id = $provider_id)
         AND ($model_id IS NULL OR model_id = $model_id)
       GROUP BY ts
       ORDER BY ts DESC
       LIMIT $limit;`,
    )
    .all(params);

  return rows
    .map(row => ({
      ts: row.ts,
      value: row.value,
      requestCount: row.request_count,
    }))
    .reverse();
}

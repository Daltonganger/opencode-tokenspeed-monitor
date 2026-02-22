import type { Database } from "bun:sqlite";
import type { RequestMetrics } from "../types";

const UNKNOWN_PROVIDER = "unknown";

type UploadQueueRow = {
  id: string;
  bucket_start: number;
  bucket_end: number;
  anon_project_id: string;
  provider_id: string;
  model_id: string;
  request_count: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_cost: number;
  output_tps_sum: number;
  output_tps_count: number;
  output_tps_min: number | null;
  output_tps_max: number | null;
  last_seen: number;
  attempt_count: number;
  status: string;
  next_attempt_at: number;
  last_error: string | null;
  sent_at: number | null;
};

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

function bucketBounds(timestampMs: number, bucketSeconds: number): { start: number; end: number } {
  const timestampSec = Math.floor(timestampMs / 1000);
  const start = Math.floor(timestampSec / bucketSeconds) * bucketSeconds;
  const end = start + bucketSeconds - 1;
  return { start, end };
}

export function buildQueueID(
  bucketStart: number,
  anonProjectID: string,
  providerID: string,
  modelID: string,
): string {
  return `${bucketStart}:${anonProjectID}:${providerID}:${modelID}`;
}

export function enqueueRequestBucket(
  db: Database,
  metrics: RequestMetrics,
  anonProjectID: string,
  bucketSeconds: number,
): void {
  const safeBucket = Math.max(60, bucketSeconds);
  const completedAt = metrics.completedAt ?? metrics.startedAt;
  const { start, end } = bucketBounds(completedAt, safeBucket);
  const providerID = metrics.providerID ?? UNKNOWN_PROVIDER;
  const queueID = buildQueueID(start, anonProjectID, providerID, metrics.modelID);
  const outputTps = metrics.outputTps ?? null;

  db.query(
    `INSERT INTO upload_queue (
       id, bucket_start, bucket_end, anon_project_id, provider_id, model_id,
       request_count, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens,
       total_cost, output_tps_sum, output_tps_count, output_tps_min, output_tps_max,
       last_seen, status, attempt_count, next_attempt_at, last_error, updated_at, sent_at
     ) VALUES (
       $id, $bucket_start, $bucket_end, $anon_project_id, $provider_id, $model_id,
       1, $input_tokens, $output_tokens, $reasoning_tokens, $cache_read_tokens, $cache_write_tokens,
       $total_cost,
       CASE WHEN $output_tps IS NULL THEN 0 ELSE $output_tps END,
       CASE WHEN $output_tps IS NULL THEN 0 ELSE 1 END,
       $output_tps,
       $output_tps,
       $last_seen, 'pending', 0, 0, NULL, strftime('%s', 'now'), NULL
     )
     ON CONFLICT(id) DO UPDATE SET
       request_count = upload_queue.request_count + 1,
       input_tokens = upload_queue.input_tokens + excluded.input_tokens,
       output_tokens = upload_queue.output_tokens + excluded.output_tokens,
       reasoning_tokens = upload_queue.reasoning_tokens + excluded.reasoning_tokens,
       cache_read_tokens = upload_queue.cache_read_tokens + excluded.cache_read_tokens,
       cache_write_tokens = upload_queue.cache_write_tokens + excluded.cache_write_tokens,
       total_cost = upload_queue.total_cost + excluded.total_cost,
       output_tps_sum = upload_queue.output_tps_sum + excluded.output_tps_sum,
       output_tps_count = upload_queue.output_tps_count + excluded.output_tps_count,
       output_tps_min = CASE
         WHEN excluded.output_tps_min IS NULL THEN upload_queue.output_tps_min
         WHEN upload_queue.output_tps_min IS NULL THEN excluded.output_tps_min
         WHEN excluded.output_tps_min < upload_queue.output_tps_min THEN excluded.output_tps_min
         ELSE upload_queue.output_tps_min
       END,
       output_tps_max = CASE
         WHEN excluded.output_tps_max IS NULL THEN upload_queue.output_tps_max
         WHEN upload_queue.output_tps_max IS NULL THEN excluded.output_tps_max
         WHEN excluded.output_tps_max > upload_queue.output_tps_max THEN excluded.output_tps_max
         ELSE upload_queue.output_tps_max
       END,
       last_seen = MAX(upload_queue.last_seen, excluded.last_seen),
       status = 'pending',
       sent_at = NULL,
       updated_at = strftime('%s', 'now');`,
  ).run({
    id: queueID,
    bucket_start: start,
    bucket_end: end,
    anon_project_id: anonProjectID,
    provider_id: providerID,
    model_id: metrics.modelID,
    input_tokens: metrics.inputTokens,
    output_tokens: metrics.outputTokens,
    reasoning_tokens: metrics.reasoningTokens,
    cache_read_tokens: metrics.cacheReadTokens,
    cache_write_tokens: metrics.cacheWriteTokens,
    total_cost: metrics.cost ?? 0,
    output_tps: outputTps,
    last_seen: completedAt,
  });
}

export function getPendingUploadBuckets(db: Database, limit = 20): UploadBucketPayload[] {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  const rows = db
    .query<UploadQueueRow, { limit: number }>(
      `SELECT
         id, bucket_start, bucket_end, anon_project_id, provider_id, model_id,
         request_count, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens,
          total_cost, output_tps_sum, output_tps_count, output_tps_min, output_tps_max,
         last_seen, attempt_count, status, next_attempt_at, last_error, sent_at
        FROM upload_queue
        WHERE status = 'pending' AND next_attempt_at <= strftime('%s', 'now')
        ORDER BY bucket_start ASC
        LIMIT $limit;`,
    )
    .all({ limit: safeLimit });

  return rows.map(row => ({
    id: row.id,
    bucketStart: row.bucket_start,
    bucketEnd: row.bucket_end,
    anonProjectID: row.anon_project_id,
    providerID: row.provider_id,
    modelID: row.model_id,
    requestCount: row.request_count,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    reasoningTokens: row.reasoning_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    totalCost: row.total_cost,
    avgOutputTps: row.output_tps_count > 0 ? row.output_tps_sum / row.output_tps_count : null,
    minOutputTps: row.output_tps_min,
    maxOutputTps: row.output_tps_max,
    lastSeen: row.last_seen,
    attemptCount: row.attempt_count,
  }));
}

export function getUploadQueueStatus(db: Database): UploadQueueStatus {
  const row = db
    .query<
      {
        pending_count: number;
        sent_count: number;
        dead_count: number;
        total_count: number;
        oldest_pending_bucket_start: number | null;
      },
      []
    >(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
         COALESCE(SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END), 0) AS sent_count,
         COALESCE(SUM(CASE WHEN status = 'dead' THEN 1 ELSE 0 END), 0) AS dead_count,
         COUNT(*) AS total_count,
         MIN(CASE WHEN status = 'pending' THEN bucket_start ELSE NULL END) AS oldest_pending_bucket_start
       FROM upload_queue;`,
    )
    .get();

  if (!row) {
    return {
      pending: 0,
      sent: 0,
      dead: 0,
      total: 0,
      oldestPendingBucketStart: null,
    };
  }

  return {
    pending: row.pending_count,
    sent: row.sent_count,
    dead: row.dead_count,
    total: row.total_count,
    oldestPendingBucketStart: row.oldest_pending_bucket_start,
  };
}

export function getUploadQueueEntries(db: Database, limit = 100, status?: string): UploadQueueEntry[] {
  const safeLimit = Math.max(1, Math.min(limit, 500));
  const normalizedStatus = status?.trim() || null;
  const rows = db
    .query<UploadQueueRow, { limit: number; status: string | null }>(
      `SELECT
         id, bucket_start, bucket_end, anon_project_id, provider_id, model_id,
         request_count, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens,
         total_cost, output_tps_sum, output_tps_count, output_tps_min, output_tps_max,
         last_seen, attempt_count, status, next_attempt_at, last_error, sent_at
       FROM upload_queue
       WHERE ($status IS NULL OR status = $status)
       ORDER BY bucket_start DESC
       LIMIT $limit;`,
    )
    .all({ limit: safeLimit, status: normalizedStatus });

  return rows.map(row => ({
    id: row.id,
    bucketStart: row.bucket_start,
    bucketEnd: row.bucket_end,
    anonProjectID: row.anon_project_id,
    providerID: row.provider_id,
    modelID: row.model_id,
    requestCount: row.request_count,
    totalCost: row.total_cost,
    status: row.status,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    sentAt: row.sent_at,
  }));
}

export function markUploadBucketSent(db: Database, id: string): void {
  db.query(
    `UPDATE upload_queue
     SET status = 'sent',
         sent_at = strftime('%s', 'now'),
         updated_at = strftime('%s', 'now'),
         last_error = NULL
     WHERE id = $id;`,
  ).run({ id });
}

export function markUploadBucketFailed(db: Database, id: string, error: string, retryAfterSeconds: number): void {
  const safeRetry = Math.max(10, retryAfterSeconds);
  db.query(
    `UPDATE upload_queue
     SET status = CASE WHEN attempt_count + 1 >= 10 THEN 'dead' ELSE 'pending' END,
         attempt_count = attempt_count + 1,
         next_attempt_at = CASE
           WHEN attempt_count + 1 >= 10 THEN next_attempt_at
           ELSE strftime('%s', 'now') + $retry_after
         END,
         last_error = $last_error,
         updated_at = strftime('%s', 'now')
     WHERE id = $id;`,
  ).run({
    id,
    retry_after: safeRetry,
    last_error: error.slice(0, 1000),
  });
}

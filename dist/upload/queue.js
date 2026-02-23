const UNKNOWN_PROVIDER = "unknown";
function bucketBounds(timestampMs, bucketSeconds) {
    const timestampSec = Math.floor(timestampMs / 1000);
    const start = Math.floor(timestampSec / bucketSeconds) * bucketSeconds;
    const end = start + bucketSeconds - 1;
    return { start, end };
}
export function buildQueueID(bucketStart, anonProjectID, providerID, modelID) {
    return `${bucketStart}:${anonProjectID}:${providerID}:${modelID}`;
}
export function enqueueRequestBucket(db, metrics, anonProjectID, bucketSeconds) {
    const safeBucket = Math.max(60, bucketSeconds);
    const completedAt = metrics.completedAt ?? metrics.startedAt;
    const { start, end } = bucketBounds(completedAt, safeBucket);
    const providerID = metrics.providerID ?? UNKNOWN_PROVIDER;
    const queueID = buildQueueID(start, anonProjectID, providerID, metrics.modelID);
    const outputTps = metrics.outputTps ?? null;
    db.query(`INSERT INTO upload_queue (
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
       updated_at = strftime('%s', 'now');`).run({
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
export function getPendingUploadBuckets(db, limit = 20) {
    const safeLimit = Math.max(1, Math.min(limit, 200));
    const rows = db
        .query(`SELECT
         id, bucket_start, bucket_end, anon_project_id, provider_id, model_id,
         request_count, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens,
           total_cost, output_tps_sum, output_tps_count, output_tps_min, output_tps_max,
         last_seen, attempt_count, status, next_attempt_at, last_error, sent_at
        FROM upload_queue
        WHERE status = 'pending' AND next_attempt_at <= unixepoch()
        ORDER BY bucket_start ASC
        LIMIT ?;`)
        .all(safeLimit);
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
export function getUploadQueueStatus(db) {
    const row = db
        .query(`SELECT
         COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
         COALESCE(SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END), 0) AS sent_count,
         COALESCE(SUM(CASE WHEN status = 'dead' THEN 1 ELSE 0 END), 0) AS dead_count,
         COUNT(*) AS total_count,
         MIN(CASE WHEN status = 'pending' THEN bucket_start ELSE NULL END) AS oldest_pending_bucket_start
       FROM upload_queue;`)
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
export function getUploadQueueEntries(db, limit = 100, status) {
    const safeLimit = Math.max(1, Math.min(limit, 500));
    const normalizedStatus = status?.trim() || null;
    const rows = db
        .query(`SELECT
         id, bucket_start, bucket_end, anon_project_id, provider_id, model_id,
         request_count, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens,
         total_cost, output_tps_sum, output_tps_count, output_tps_min, output_tps_max,
         last_seen, attempt_count, status, next_attempt_at, last_error, sent_at
       FROM upload_queue
       WHERE ($status IS NULL OR status = $status)
       ORDER BY bucket_start DESC
       LIMIT $limit;`)
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
export function markUploadBucketSent(db, id) {
    db.query(`UPDATE upload_queue
     SET status = 'sent',
         sent_at = strftime('%s', 'now'),
         updated_at = strftime('%s', 'now'),
         last_error = NULL
     WHERE id = $id;`).run({ id });
}
export function markUploadBucketFailed(db, id, error, retryAfterSeconds) {
    const safeRetry = Math.max(10, retryAfterSeconds);
    db.query(`UPDATE upload_queue
     SET status = CASE WHEN attempt_count + 1 >= 10 THEN 'dead' ELSE 'pending' END,
         attempt_count = attempt_count + 1,
         next_attempt_at = CASE
           WHEN attempt_count + 1 >= 10 THEN next_attempt_at
           ELSE strftime('%s', 'now') + $retry_after
         END,
         last_error = $last_error,
         updated_at = strftime('%s', 'now')
     WHERE id = $id;`).run({
        id,
        retry_after: safeRetry,
        last_error: error.slice(0, 1000),
    });
}
//# sourceMappingURL=queue.js.map
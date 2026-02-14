import type { Database } from "bun:sqlite";
import type { ModelStats, RequestMetrics } from "../types";
import { aggregateModelStats } from "../metrics/calculator";

type RequestRow = {
  id: string;
  session_id: string;
  message_id: string;
  model_id: string;
  provider_id: string | null;
  agent: string | null;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read: number;
  cache_write: number;
  total_tokens: number;
  started_at: number;
  completed_at: number | null;
  duration_ms: number | null;
  output_tps: number | null;
  total_tps: number | null;
  cost: number | null;
};

export function saveRequest(db: Database, item: RequestMetrics): void {
  db.query(
    `INSERT OR REPLACE INTO requests (
      id, session_id, message_id, model_id, provider_id, agent,
      input_tokens, output_tokens, reasoning_tokens, cache_read, cache_write, total_tokens,
      started_at, completed_at, duration_ms, output_tps, total_tps, cost
    ) VALUES (
      $id, $session_id, $message_id, $model_id, $provider_id, $agent,
      $input_tokens, $output_tokens, $reasoning_tokens, $cache_read, $cache_write, $total_tokens,
      $started_at, $completed_at, $duration_ms, $output_tps, $total_tps, $cost
    );`,
  ).run({
    id: item.id,
    session_id: item.sessionID,
    message_id: item.messageID,
    model_id: item.modelID,
    provider_id: item.providerID ?? null,
    agent: item.agent ?? null,
    input_tokens: item.inputTokens,
    output_tokens: item.outputTokens,
    reasoning_tokens: item.reasoningTokens,
    cache_read: item.cacheReadTokens,
    cache_write: item.cacheWriteTokens,
    total_tokens: item.totalTokens,
    started_at: item.startedAt,
    completed_at: item.completedAt ?? null,
    duration_ms: item.durationMs ?? null,
    output_tps: item.outputTps ?? null,
    total_tps: item.totalTps ?? null,
    cost: item.cost ?? null,
  });

  upsertSession(db, item.sessionID, item.startedAt, item.completedAt ?? item.startedAt);
}

export function upsertSession(db: Database, sessionID: string, startedAt: number, lastActivity: number): void {
  db.query(
    `INSERT INTO sessions (id, started_at, last_activity, request_count)
     VALUES ($id, $started_at, $last_activity, 1)
     ON CONFLICT(id) DO UPDATE SET
       started_at = MIN(started_at, excluded.started_at),
       last_activity = MAX(last_activity, excluded.last_activity),
       request_count = request_count + 1;`,
  ).run({
    id: sessionID,
    started_at: startedAt,
    last_activity: lastActivity,
  });
}

function mapRequestRow(row: RequestRow): RequestMetrics {
  return {
    id: row.id,
    sessionID: row.session_id,
    messageID: row.message_id,
    modelID: row.model_id,
    providerID: row.provider_id ?? undefined,
    agent: row.agent ?? undefined,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    reasoningTokens: row.reasoning_tokens,
    cacheReadTokens: row.cache_read,
    cacheWriteTokens: row.cache_write,
    totalTokens: row.total_tokens,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    outputTps: row.output_tps ?? undefined,
    totalTps: row.total_tps ?? undefined,
    cost: row.cost ?? undefined,
  };
}

export function getRecentRequests(db: Database, limit = 100): RequestMetrics[] {
  const safeLimit = Math.max(1, Math.min(limit, 1000));
  const rows = db
    .query<RequestRow, { limit: number }>(
      `SELECT
        id, session_id, message_id, model_id, provider_id, agent,
        input_tokens, output_tokens, reasoning_tokens, cache_read, cache_write, total_tokens,
        started_at, completed_at, duration_ms, output_tps, total_tps, cost
      FROM requests
      ORDER BY started_at DESC
      LIMIT $limit;`,
    )
    .all({ limit: safeLimit });
  return rows.map(mapRequestRow);
}

export function getRequestsByModel(db: Database, modelID: string, limit = 100): RequestMetrics[] {
  const safeLimit = Math.max(1, Math.min(limit, 1000));
  const rows = db
    .query<RequestRow, { model_id: string; limit: number }>(
      `SELECT
        id, session_id, message_id, model_id, provider_id, agent,
        input_tokens, output_tokens, reasoning_tokens, cache_read, cache_write, total_tokens,
        started_at, completed_at, duration_ms, output_tps, total_tps, cost
      FROM requests
      WHERE model_id = $model_id
      ORDER BY started_at DESC
      LIMIT $limit;`,
    )
    .all({ model_id: modelID, limit: safeLimit });
  return rows.map(mapRequestRow);
}

export function getSessionStats(db: Database): {
  requestCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: number;
} {
  const row = db
    .query<
      {
        request_count: number;
        total_input_tokens: number;
        total_output_tokens: number;
        total_tokens: number;
        total_cost: number;
      },
      []
    >(
      `SELECT
        COUNT(*) as request_count,
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(SUM(cost), 0) as total_cost
      FROM requests;`,
    )
    .get();

  if (!row) {
    return {
      requestCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalCost: 0,
    };
  }

  return {
    requestCount: row.request_count,
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    totalTokens: row.total_tokens,
    totalCost: row.total_cost,
  };
}

export function getModelStats(db: Database): ModelStats[] {
  const requests = getRecentRequests(db, 10_000);
  return aggregateModelStats(requests);
}

export function getSessions(
  db: Database,
  limit = 100,
): Array<{ id: string; startedAt: number | null; lastActivity: number | null; requestCount: number }> {
  const safeLimit = Math.max(1, Math.min(limit, 1000));
  const rows = db
    .query<
      {
        id: string;
        started_at: number | null;
        last_activity: number | null;
        request_count: number;
      },
      { limit: number }
    >(
      `SELECT id, started_at, last_activity, request_count
       FROM sessions
       ORDER BY COALESCE(last_activity, 0) DESC
       LIMIT $limit;`,
    )
    .all({ limit: safeLimit });

  return rows.map(row => ({
    id: row.id,
    startedAt: row.started_at,
    lastActivity: row.last_activity,
    requestCount: row.request_count,
  }));
}

export function saveModelStats(db: Database, stats: ModelStats[]): void {
  const upsert = db.query(
    `INSERT OR REPLACE INTO model_stats (
      model_id, request_count, total_input_tokens, total_output_tokens,
      avg_output_tps, min_output_tps, max_output_tps, last_seen
    ) VALUES (
      $model_id, $request_count, $total_input_tokens, $total_output_tokens,
      $avg_output_tps, $min_output_tps, $max_output_tps, $last_seen
    );`,
  );

  const tx = db.transaction((items: ModelStats[]) => {
    for (const item of items) {
      upsert.run({
        model_id: item.modelID,
        request_count: item.requestCount,
        total_input_tokens: item.totalInputTokens,
        total_output_tokens: item.totalOutputTokens,
        avg_output_tps: item.avgOutputTps,
        min_output_tps: item.minOutputTps,
        max_output_tps: item.maxOutputTps,
        last_seen: item.lastSeen,
      });
    }
  });

  tx(stats);
}

export function aggregateModelStatsInDb(db: Database): ModelStats[] {
  const stats = getModelStats(db);
  saveModelStats(db, stats);
  return stats;
}

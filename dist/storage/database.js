import { aggregateModelStats, aggregateProviderStats } from "../metrics/calculator";
export function saveRequest(db, item) {
    const projectID = item.projectID ?? null;
    if (projectID) {
        const projectName = projectID.split(/[/\\]/).filter(Boolean).at(-1) ?? "project";
        upsertProject(db, projectID, projectName, projectID, item.completedAt ?? item.startedAt);
    }
    db.query(`INSERT OR REPLACE INTO requests (
      id, session_id, message_id, project_id, model_id, provider_id, agent,
      input_tokens, output_tokens, reasoning_tokens, cache_read, cache_write, total_tokens,
      started_at, completed_at, duration_ms, output_tps, total_tps, cost
    ) VALUES (
      $id, $session_id, $message_id, $project_id, $model_id, $provider_id, $agent,
      $input_tokens, $output_tokens, $reasoning_tokens, $cache_read, $cache_write, $total_tokens,
      $started_at, $completed_at, $duration_ms, $output_tps, $total_tps, $cost
    );`).run({
        id: item.id,
        session_id: item.sessionID,
        message_id: item.messageID,
        project_id: projectID,
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
    upsertSession(db, item.sessionID, projectID, item.startedAt, item.completedAt ?? item.startedAt);
}
export function upsertProject(db, projectID, name, rootPath, lastSeen) {
    db.query(`INSERT INTO projects (id, name, root_path, created_at, last_seen)
     VALUES ($id, $name, $root_path, $created_at, $last_seen)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       root_path = excluded.root_path,
       last_seen = MAX(COALESCE(last_seen, 0), excluded.last_seen);`).run({
        id: projectID,
        name,
        root_path: rootPath,
        created_at: Math.floor(Date.now() / 1000),
        last_seen: lastSeen,
    });
}
export function upsertSession(db, sessionID, projectID, startedAt, lastActivity) {
    db.query(`INSERT INTO sessions (id, project_id, started_at, last_activity, request_count)
     VALUES ($id, $project_id, $started_at, $last_activity, 1)
     ON CONFLICT(id) DO UPDATE SET
       project_id = COALESCE(sessions.project_id, excluded.project_id),
       started_at = MIN(started_at, excluded.started_at),
       last_activity = MAX(last_activity, excluded.last_activity),
       request_count = request_count + 1;`).run({
        id: sessionID,
        project_id: projectID,
        started_at: startedAt,
        last_activity: lastActivity,
    });
}
function mapRequestRow(row) {
    return {
        id: row.id,
        sessionID: row.session_id,
        messageID: row.message_id,
        projectID: row.project_id ?? undefined,
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
export function getRecentRequests(db, limit = 100) {
    return getFilteredRequests(db, {}, limit);
}
export function getFilteredRequests(db, filters = {}, limit = 100) {
    const safeLimit = Math.max(1, Math.min(limit, 1000));
    const projectID = filters.projectID?.trim() || null;
    const providerID = filters.providerID?.trim() || null;
    const modelID = filters.modelID?.trim() || null;
    const rows = db
        .query(`SELECT
        id, session_id, message_id, project_id, model_id, provider_id, agent,
        input_tokens, output_tokens, reasoning_tokens, cache_read, cache_write, total_tokens,
        started_at, completed_at, duration_ms, output_tps, total_tps, cost
      FROM requests
      WHERE ($project_id IS NULL OR project_id = $project_id)
        AND ($provider_id IS NULL OR provider_id = $provider_id)
        AND ($model_id IS NULL OR model_id = $model_id)
      ORDER BY started_at DESC
      LIMIT $limit;`)
        .all({ project_id: projectID, provider_id: providerID, model_id: modelID, limit: safeLimit });
    return rows.map(mapRequestRow);
}
export function getRequestsByModel(db, modelID, limit = 100) {
    const safeLimit = Math.max(1, Math.min(limit, 1000));
    const rows = db
        .query(`SELECT
        id, session_id, message_id, project_id, model_id, provider_id, agent,
        input_tokens, output_tokens, reasoning_tokens, cache_read, cache_write, total_tokens,
        started_at, completed_at, duration_ms, output_tps, total_tps, cost
      FROM requests
      WHERE model_id = $model_id
      ORDER BY started_at DESC
      LIMIT $limit;`)
        .all({ model_id: modelID, limit: safeLimit });
    return rows.map(mapRequestRow);
}
export function getSessionStats(db) {
    return getSessionStatsWithFilters(db, {});
}
export function getSessionStatsWithFilters(db, filters) {
    const projectID = filters.projectID?.trim() || null;
    const providerID = filters.providerID?.trim() || null;
    const modelID = filters.modelID?.trim() || null;
    const row = db
        .query(`SELECT
        COUNT(*) as request_count,
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(SUM(cost), 0) as total_cost
      FROM requests
      WHERE ($project_id IS NULL OR project_id = $project_id)
        AND ($provider_id IS NULL OR provider_id = $provider_id)
        AND ($model_id IS NULL OR model_id = $model_id);`)
        .get({ project_id: projectID, provider_id: providerID, model_id: modelID });
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
export function getModelStats(db, filters = {}) {
    const requests = getFilteredRequests(db, filters, 10_000);
    return aggregateModelStats(requests);
}
export function getProviderStats(db, filters = {}) {
    const requests = getFilteredRequests(db, filters, 10_000);
    return aggregateProviderStats(requests);
}
export function getProjects(db, limit = 100) {
    const safeLimit = Math.max(1, Math.min(limit, 1000));
    const rows = db
        .query(`SELECT
         p.id AS project_id,
         p.name AS name,
         p.root_path AS root_path,
         COUNT(r.id) AS request_count,
         COALESCE(SUM(r.input_tokens), 0) AS total_input_tokens,
         COALESCE(SUM(r.output_tokens), 0) AS total_output_tokens,
         COALESCE(SUM(r.total_tokens), 0) AS total_tokens,
         COALESCE(SUM(r.cost), 0) AS total_cost,
         MAX(COALESCE(r.completed_at, r.started_at)) AS last_seen
       FROM projects p
       LEFT JOIN requests r ON r.project_id = p.id
       GROUP BY p.id, p.name, p.root_path
       ORDER BY COALESCE(last_seen, 0) DESC
       LIMIT $limit;`)
        .all({ limit: safeLimit });
    return rows.map(row => ({
        projectID: row.project_id,
        name: row.name,
        rootPath: row.root_path,
        requestCount: row.request_count,
        totalInputTokens: row.total_input_tokens,
        totalOutputTokens: row.total_output_tokens,
        totalTokens: row.total_tokens,
        totalCost: row.total_cost,
        lastSeen: row.last_seen,
    }));
}
export function getSessions(db, limit = 100) {
    const safeLimit = Math.max(1, Math.min(limit, 1000));
    const rows = db
        .query(`SELECT id, started_at, last_activity, request_count
       FROM sessions
       ORDER BY COALESCE(last_activity, 0) DESC
       LIMIT $limit;`)
        .all({ limit: safeLimit });
    return rows.map(row => ({
        id: row.id,
        startedAt: row.started_at,
        lastActivity: row.last_activity,
        requestCount: row.request_count,
    }));
}
export function saveModelStats(db, stats) {
    const upsert = db.query(`INSERT OR REPLACE INTO model_stats (
      model_id, request_count, total_input_tokens, total_output_tokens,
      avg_output_tps, min_output_tps, max_output_tps, last_seen
    ) VALUES (
      $model_id, $request_count, $total_input_tokens, $total_output_tokens,
      $avg_output_tps, $min_output_tps, $max_output_tps, $last_seen
    );`);
    const tx = db.transaction((items) => {
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
export function aggregateModelStatsInDb(db) {
    const stats = getModelStats(db);
    saveModelStats(db, stats);
    return stats;
}
//# sourceMappingURL=database.js.map
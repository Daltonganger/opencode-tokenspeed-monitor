import { getFilteredRequests, getModelStats, getProjects, getProviderStats, getSessionStatsWithFilters, getSessions, } from "../storage/database";
import { getUploadQueueEntries, getUploadQueueStatus } from "../upload/queue";
const API_CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};
function sseData(event) {
    return `data: ${JSON.stringify(event)}\n\n`;
}
function withCors(response) {
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(API_CORS_HEADERS)) {
        headers.set(key, value);
    }
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}
function jsonResponse(data) {
    return withCors(Response.json(data));
}
function preflightResponse() {
    return new Response(null, { status: 204, headers: API_CORS_HEADERS });
}
function methodNotAllowed() {
    return new Response("Method Not Allowed", { status: 405 });
}
function parseLimit(url, fallback = 100) {
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : fallback;
    return Number.isFinite(limit) ? limit : fallback;
}
function parseRequestFilters(url) {
    const projectID = url.searchParams.get("projectId")?.trim();
    const providerID = url.searchParams.get("providerId")?.trim();
    const modelID = url.searchParams.get("modelId")?.trim();
    return {
        projectID: projectID ? projectID : undefined,
        providerID: providerID ? providerID : undefined,
        modelID: modelID ? modelID : undefined,
    };
}
function dashboardHtml() {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TokenSpeed Local Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7fb;
      --panel: #ffffff;
      --ink: #0f1a2b;
      --muted: #5b6778;
      --line: #d7dfeb;
      --brand: #1268ff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: radial-gradient(circle at top right, #e8f0ff 0%, var(--bg) 55%);
      color: var(--ink);
    }
    main {
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px;
      display: grid;
      gap: 16px;
    }
    h1 { margin: 0; font-size: 1.5rem; }
    p { margin: 0; color: var(--muted); }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }
    .card, .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 14px;
      box-shadow: 0 1px 2px rgba(10, 20, 40, 0.05);
    }
    .label { font-size: 0.78rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }
    .value { margin-top: 6px; font-size: 1.25rem; font-weight: 600; }
    .head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 12px;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
    }
    @media (min-width: 960px) {
      .grid { grid-template-columns: 1fr 1fr; }
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      font-size: 0.9rem;
    }
    th, td {
      text-align: left;
      border-bottom: 1px solid var(--line);
      padding: 7px 8px;
      vertical-align: top;
    }
    th { font-size: 0.76rem; text-transform: uppercase; color: var(--muted); letter-spacing: 0.03em; }
    td { color: #253247; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.84rem; }
    .footer { color: var(--muted); font-size: 0.8rem; }
    a { color: var(--brand); text-decoration: none; }
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: end;
    }
    .filters label {
      display: grid;
      gap: 4px;
      font-size: 0.8rem;
      color: var(--muted);
      min-width: 180px;
    }
    .filters select,
    .filters button {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 7px 10px;
      background: #fff;
      color: var(--ink);
      font-size: 0.9rem;
    }
    .filters button {
      cursor: pointer;
      background: #f9fbff;
    }
  </style>
</head>
<body>
  <main>
    <div class="head">
      <h1>TokenSpeed Local Dashboard</h1>
      <p id="updated">Loading...</p>
    </div>

    <section class="panel filters">
      <label>Project
        <select id="projectFilter"></select>
      </label>
      <label>Provider
        <select id="providerFilter"></select>
      </label>
      <label>Model
        <select id="modelFilter"></select>
      </label>
      <button id="applyFilters" type="button">Apply</button>
      <button id="resetFilters" type="button">Reset</button>
    </section>

    <section class="cards">
      <div class="card"><div class="label">Requests</div><div class="value" id="requests">-</div></div>
      <div class="card"><div class="label">Input Tokens</div><div class="value" id="input">-</div></div>
      <div class="card"><div class="label">Output Tokens</div><div class="value" id="output">-</div></div>
      <div class="card"><div class="label">Total Tokens</div><div class="value" id="total">-</div></div>
      <div class="card"><div class="label">Total Cost</div><div class="value" id="cost">-</div></div>
    </section>

    <section class="panel filters">
      <div><strong>Upload Queue</strong> <span class="footer" id="uploadMeta">-</span></div>
      <div class="card"><div class="label">Pending</div><div class="value" id="uploadPending">-</div></div>
      <div class="card"><div class="label">Sent</div><div class="value" id="uploadSent">-</div></div>
      <div class="card"><div class="label">Dead</div><div class="value" id="uploadDead">-</div></div>
      <button id="flushUpload" type="button">Flush Upload Queue</button>
    </section>

    <section class="grid">
      <div class="panel">
        <strong>Models</strong>
        <table>
          <thead><tr><th>Model</th><th>Req</th><th>Avg TPS</th><th>Output</th></tr></thead>
          <tbody id="models"></tbody>
        </table>
      </div>
      <div class="panel">
        <strong>Providers</strong>
        <table>
          <thead><tr><th>Provider</th><th>Req</th><th>Avg TPS</th><th>Cost</th></tr></thead>
          <tbody id="providers"></tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <strong>Recent Requests</strong>
      <table>
        <thead>
          <tr>
            <th>Started</th><th>Provider</th><th>Model</th><th>Input</th><th>Output</th><th>TPS</th><th>Cost</th>
          </tr>
        </thead>
        <tbody id="history"></tbody>
      </table>
    </section>

    <p class="footer">
      Endpoints: <a href="/api/stats">/api/stats</a>, <a href="/api/stats/models">/api/stats/models</a>,
      <a href="/api/stats/providers">/api/stats/providers</a>, <a href="/api/projects">/api/projects</a>,
      <a href="/api/history?limit=20">/api/history</a>, <a href="/api/upload/status">/api/upload/status</a>
    </p>
  </main>

  <script>
    const intFmt = n => Number(n ?? 0).toLocaleString();
    const numFmt = n => (n === null || n === undefined ? "N/A" : Number(n).toFixed(2));
    const costFmt = n => "$" + Number(n ?? 0).toFixed(4);
    const state = { projectId: "", providerId: "", modelId: "" };

    function buildQuery(extra) {
      const params = new URLSearchParams();
      if (state.projectId) params.set("projectId", state.projectId);
      if (state.providerId) params.set("providerId", state.providerId);
      if (state.modelId) params.set("modelId", state.modelId);
      if (extra) {
        for (const [key, value] of Object.entries(extra)) {
          if (value !== undefined && value !== null && value !== "") {
            params.set(key, String(value));
          }
        }
      }
      return params.toString();
    }

    function withQuery(path, extra) {
      const query = buildQuery(extra);
      return query ? path + "?" + query : path;
    }

    async function fetchJson(path, extra) {
      const response = await fetch(withQuery(path, extra));
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    }

    async function fetchJsonUnfiltered(path, extra) {
      const params = new URLSearchParams();
      if (extra) {
        for (const [key, value] of Object.entries(extra)) {
          if (value !== undefined && value !== null && value !== "") {
            params.set(key, String(value));
          }
        }
      }
      const query = params.toString();
      const response = await fetch(query ? path + "?" + query : path);
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    }

    const dateFmt = ts => {
      if (!ts) return "-";
      const d = new Date(ts);
      return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString();
    };

    function row(cells) {
      const tr = document.createElement("tr");
      for (const value of cells) {
        const td = document.createElement("td");
        td.textContent = String(value);
        tr.appendChild(td);
      }
      return tr;
    }

    function setRows(id, rows, mapFn, emptyCols = 4) {
      const tbody = document.getElementById(id);
      tbody.innerHTML = "";
      if (!rows.length) {
        const empty = ["No data"];
        for (let i = 1; i < emptyCols; i += 1) empty.push("");
        tbody.appendChild(row(empty));
        return;
      }
      for (const item of rows) {
        tbody.appendChild(row(mapFn(item)));
      }
    }

    function syncSelect(selectId, options, selectedValue, allLabel) {
      const select = document.getElementById(selectId);
      const current = selectedValue || "";
      select.innerHTML = "";

      const allOption = document.createElement("option");
      allOption.value = "";
      allOption.textContent = allLabel;
      select.appendChild(allOption);

      for (const value of options) {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = value;
        select.appendChild(opt);
      }

      select.value = current;
    }

    async function load() {
      try {
        const [projects, allModels, allProviders, stats, models, providers, history, uploadStatus] = await Promise.all([
          fetchJsonUnfiltered("/api/projects", { limit: 200 }),
          fetchJsonUnfiltered("/api/stats/models", { limit: 200 }),
          fetchJsonUnfiltered("/api/stats/providers", { limit: 200 }),
          fetchJson("/api/stats"),
          fetchJson("/api/stats/models", { limit: 30 }),
          fetchJson("/api/stats/providers", { limit: 30 }),
          fetchJson("/api/history", { limit: 30 }),
          fetchJsonUnfiltered("/api/upload/status")
        ]);

        syncSelect(
          "projectFilter",
          projects.map(item => item.projectID),
          state.projectId,
          "All projects"
        );
        syncSelect(
          "providerFilter",
          allProviders.map(item => item.providerID),
          state.providerId,
          "All providers"
        );
        syncSelect(
          "modelFilter",
          allModels.map(item => item.modelID),
          state.modelId,
          "All models"
        );

        document.getElementById("requests").textContent = intFmt(stats.requestCount);
        document.getElementById("input").textContent = intFmt(stats.totalInputTokens);
        document.getElementById("output").textContent = intFmt(stats.totalOutputTokens);
        document.getElementById("total").textContent = intFmt(stats.totalTokens);
        document.getElementById("cost").textContent = costFmt(stats.totalCost);
        document.getElementById("uploadPending").textContent = intFmt(uploadStatus.queue.pending);
        document.getElementById("uploadSent").textContent = intFmt(uploadStatus.queue.sent);
        document.getElementById("uploadDead").textContent = intFmt(uploadStatus.queue.dead);
        document.getElementById("uploadMeta").textContent = uploadStatus.enabled
          ? "enabled - " + (uploadStatus.hubUrl ?? "no hub")
          : "disabled";

        setRows("models", models.slice(0, 20), item => [
          item.modelID,
          intFmt(item.requestCount),
          numFmt(item.avgOutputTps),
          intFmt(item.totalOutputTokens),
        ]);

        setRows("providers", providers.slice(0, 20), item => [
          item.providerID,
          intFmt(item.requestCount),
          numFmt(item.avgOutputTps),
          costFmt(item.totalCost),
        ]);

        setRows("history", history.slice(0, 30), item => [
          dateFmt(item.startedAt),
          item.providerID ?? "unknown",
          item.modelID,
          intFmt(item.inputTokens),
          intFmt(item.outputTokens),
          numFmt(item.outputTps),
          costFmt(item.cost),
        ], 7);

        document.getElementById("updated").textContent = "Updated: " + new Date().toLocaleTimeString();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        document.getElementById("updated").textContent = "Load failed: " + msg;
      }
    }

    document.getElementById("applyFilters").addEventListener("click", () => {
      const projectValue = document.getElementById("projectFilter").value;
      const providerValue = document.getElementById("providerFilter").value;
      const modelValue = document.getElementById("modelFilter").value;
      state.projectId = projectValue;
      state.providerId = providerValue;
      state.modelId = modelValue;
      load();
    });

    document.getElementById("resetFilters").addEventListener("click", () => {
      state.projectId = "";
      state.providerId = "";
      state.modelId = "";
      load();
    });

    document.getElementById("flushUpload").addEventListener("click", async () => {
      try {
        const response = await fetch("/api/upload/flush", { method: "POST" });
        if (!response.ok) throw new Error("HTTP " + response.status);
        await load();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        document.getElementById("updated").textContent = "Flush failed: " + msg;
      }
    });

    load();
    setInterval(load, 5000);
  </script>
</body>
</html>`;
}
export function startApiServer(db, requestedPort, options = {}) {
    const subscribers = new Set();
    const createSseResponse = () => {
        let heartbeat;
        const stream = new ReadableStream({
            start(controller) {
                const subscriber = {
                    enqueue: chunk => controller.enqueue(chunk),
                    close: () => controller.close(),
                };
                subscribers.add(subscriber);
                controller.enqueue(": connected\n\n");
                heartbeat = setInterval(() => {
                    try {
                        controller.enqueue(": heartbeat\n\n");
                    }
                    catch {
                        subscribers.delete(subscriber);
                        clearInterval(heartbeat);
                    }
                }, 15000);
            },
            cancel() {
                if (heartbeat)
                    clearInterval(heartbeat);
            },
        });
        return withCors(new Response(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
            },
        }));
    };
    const tryStart = (port) => Bun.serve({
        port,
        routes: {
            "/": req => {
                if (req.method !== "GET")
                    return methodNotAllowed();
                return new Response(dashboardHtml(), {
                    headers: {
                        "Content-Type": "text/html; charset=utf-8",
                        "Cache-Control": "no-store",
                    },
                });
            },
            "/api/stats": req => {
                if (req.method === "OPTIONS")
                    return preflightResponse();
                if (req.method !== "GET")
                    return methodNotAllowed();
                const url = new URL(req.url);
                return jsonResponse(getSessionStatsWithFilters(db, parseRequestFilters(url)));
            },
            "/api/stats/models": req => {
                if (req.method === "OPTIONS")
                    return preflightResponse();
                if (req.method !== "GET")
                    return methodNotAllowed();
                const url = new URL(req.url);
                const filters = parseRequestFilters(url);
                const limit = parseLimit(url, 100);
                return jsonResponse(getModelStats(db, filters).slice(0, Math.max(1, Math.min(limit, 1000))));
            },
            "/api/stats/providers": req => {
                if (req.method === "OPTIONS")
                    return preflightResponse();
                if (req.method !== "GET")
                    return methodNotAllowed();
                const url = new URL(req.url);
                const filters = parseRequestFilters(url);
                const limit = parseLimit(url, 100);
                return jsonResponse(getProviderStats(db, filters).slice(0, Math.max(1, Math.min(limit, 1000))));
            },
            "/api/projects": req => {
                if (req.method === "OPTIONS")
                    return preflightResponse();
                if (req.method !== "GET")
                    return methodNotAllowed();
                const url = new URL(req.url);
                return jsonResponse(getProjects(db, parseLimit(url, 100)));
            },
            "/api/upload/status": req => {
                if (req.method === "OPTIONS")
                    return preflightResponse();
                if (req.method !== "GET")
                    return methodNotAllowed();
                return jsonResponse({
                    enabled: options.uploadEnabled ?? false,
                    hubUrl: options.uploadHubURL ?? null,
                    queue: getUploadQueueStatus(db),
                });
            },
            "/api/upload/queue": req => {
                if (req.method === "OPTIONS")
                    return preflightResponse();
                if (req.method !== "GET")
                    return methodNotAllowed();
                const url = new URL(req.url);
                const limit = parseLimit(url, 100);
                const status = url.searchParams.get("status")?.trim() || undefined;
                return jsonResponse(getUploadQueueEntries(db, limit, status));
            },
            "/api/upload/flush": async (req) => {
                if (req.method === "OPTIONS")
                    return preflightResponse();
                if (req.method !== "POST")
                    return methodNotAllowed();
                if (!options.flushUploadNow) {
                    return withCors(new Response("Upload dispatcher unavailable", { status: 503 }));
                }
                await options.flushUploadNow();
                return jsonResponse({ ok: true });
            },
            "/api/history": req => {
                if (req.method === "OPTIONS")
                    return preflightResponse();
                if (req.method !== "GET")
                    return methodNotAllowed();
                const url = new URL(req.url);
                const limit = parseLimit(url, 100);
                return jsonResponse(getFilteredRequests(db, parseRequestFilters(url), limit));
            },
            "/api/sessions": req => {
                if (req.method === "OPTIONS")
                    return preflightResponse();
                if (req.method !== "GET")
                    return methodNotAllowed();
                const url = new URL(req.url);
                return jsonResponse(getSessions(db, parseLimit(url, 100)));
            },
            "/api/live": req => {
                if (req.method === "OPTIONS")
                    return preflightResponse();
                if (req.method !== "GET")
                    return methodNotAllowed();
                return createSseResponse();
            },
        },
        fetch: () => new Response("Not Found", { status: 404 }),
    });
    let server;
    try {
        server = tryStart(requestedPort);
    }
    catch {
        server = tryStart(0);
    }
    return {
        port: server.port ?? requestedPort,
        url: server.url.toString(),
        publish(event) {
            const payload = sseData(event);
            for (const subscriber of subscribers) {
                try {
                    subscriber.enqueue(payload);
                }
                catch {
                    subscribers.delete(subscriber);
                    try {
                        subscriber.close();
                    }
                    catch (error) {
                        void error;
                    }
                }
            }
        },
        async stop() {
            for (const subscriber of subscribers) {
                try {
                    subscriber.close();
                }
                catch (error) {
                    void error;
                }
            }
            subscribers.clear();
            await server.stop(true);
        },
    };
}
//# sourceMappingURL=server.js.map
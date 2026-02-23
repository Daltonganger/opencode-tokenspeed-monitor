import type { Database } from "bun:sqlite";
import {
  getFilteredRequests,
  getModelStats,
  getProjects,
  getProviderStats,
  getSessionStatsWithFilters,
  getSessions,
  type RequestFilters,
} from "../storage/database";
import { getTokenSpeedLogoWebp } from "../ui/logo";
import { getUploadQueueEntries, getUploadQueueStatus } from "../upload/queue";

export interface LiveMetricEvent {
  sessionID: string;
  messageID: string;
  modelID: string;
  outputTokens: number;
  outputTps?: number;
  durationMs?: number;
  completedAt?: number;
}

export interface ApiServerHandle {
  port: number;
  url: string;
  publish(event: LiveMetricEvent): void;
  stop(): Promise<void>;
}

export interface ApiServerOptions {
  uploadEnabled?: boolean;
  uploadHubURL?: string | null;
  flushUploadNow?: () => Promise<void>;
}

type StreamController = {
  enqueue: (chunk: string) => void;
  close: () => void;
};

const API_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function sseData(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function withCors(response: Response): Response {
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

function jsonResponse(data: unknown): Response {
  return withCors(Response.json(data));
}

function preflightResponse(): Response {
  return new Response(null, { status: 204, headers: API_CORS_HEADERS });
}

function methodNotAllowed(): Response {
  return new Response("Method Not Allowed", { status: 405 });
}

function parseLimit(url: URL, fallback = 100): number {
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : fallback;
  return Number.isFinite(limit) ? limit : fallback;
}

function parseRequestFilters(url: URL): RequestFilters {
  const projectID = url.searchParams.get("projectId")?.trim();
  const providerID = url.searchParams.get("providerId")?.trim();
  const modelID = url.searchParams.get("modelId")?.trim();

  return {
    projectID: projectID ? projectID : undefined,
    providerID: providerID ? providerID : undefined,
    modelID: modelID ? modelID : undefined,
  };
}

function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TokenSpeed Local Control Center</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js"></script>
  <style>
    @import url("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap");

    :root {
      color-scheme: dark;
      --bg: #030712;
      --bg-2: #0f172a;
      --panel: rgba(15, 23, 42, 0.66);
      --panel-solid: #111b39;
      --line: rgba(255, 255, 255, 0.08);
      --text: #f8fafc;
      --muted: #94a3b8;
      --accent: #5fc4ff;
      --accent-2: #8e6bff;
      --good: #35d38a;
      --warn: #f7bf58;
      --danger: #ff668f;
      --shadow: 0 16px 44px rgba(2, 8, 30, 0.45);
    }

    body[data-theme="light"] {
      color-scheme: light;
      --bg: #edf4ff;
      --bg-2: #dce9ff;
      --panel: rgba(255, 255, 255, 0.9);
      --panel-solid: #ffffff;
      --line: rgba(15, 23, 42, 0.08);
      --text: #10203f;
      --muted: #4f6386;
      --accent: #1558ff;
      --accent-2: #6a3cff;
      --good: #1a9f62;
      --warn: #bc7d12;
      --danger: #ca325d;
      --shadow: 0 16px 30px rgba(58, 91, 173, 0.16);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, "Segoe UI", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at 20% 0%, rgba(106, 70, 255, 0.24), transparent 35%),
        radial-gradient(circle at 90% 20%, rgba(30, 168, 255, 0.18), transparent 42%),
        linear-gradient(140deg, var(--bg), var(--bg-2));
      background-attachment: fixed;
    }

    .layout {
      display: grid;
      grid-template-columns: 280px minmax(0, 1fr);
      gap: 18px;
      max-width: 1520px;
      margin: 0 auto;
      padding: 18px;
    }

    .sidebar,
    .panel,
    .card {
      border: 1px solid var(--line);
      background: var(--panel);
      backdrop-filter: blur(16px);
      border-radius: 16px;
      box-shadow: var(--shadow);
    }

    .sidebar {
      padding: 20px;
      display: grid;
      align-content: start;
      gap: 18px;
      min-height: calc(100vh - 36px);
      position: sticky;
      top: 18px;
    }

    .brand-logo {
      display: grid;
      place-items: center;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: linear-gradient(145deg, rgba(17, 32, 70, 0.65), rgba(11, 22, 52, 0.82));
      padding: 14px;
    }

    body[data-theme="light"] .brand-logo {
      background: linear-gradient(145deg, rgba(245, 250, 255, 0.85), rgba(224, 236, 255, 0.95));
    }

    .brand-logo img {
      width: 100%;
      max-width: 220px;
      height: auto;
    }

    .chip-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .chip {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 7px 11px;
      font-size: 0.76rem;
      color: var(--muted);
      background: rgba(76, 116, 255, 0.12);
    }

    body[data-theme="light"] .chip {
      background: rgba(76, 116, 255, 0.08);
    }

    .sidebar-meta {
      font-size: 0.86rem;
      color: var(--muted);
      display: grid;
      gap: 8px;
    }

    .sidebar-meta > div {
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }

    .sidebar-meta strong {
      color: var(--text);
      font-weight: 600;
      white-space: nowrap;
    }

    .content {
      display: grid;
      gap: 14px;
      min-width: 0;
    }

    .topbar {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 14px 16px;
      border-radius: 16px;
      border: 1px solid var(--line);
      background: rgba(11, 21, 45, 0.72);
      backdrop-filter: blur(10px);
      box-shadow: var(--shadow);
    }

    body[data-theme="light"] .topbar {
      background: rgba(255, 255, 255, 0.88);
    }

    .title {
      margin: 0;
      font-family: "Space Grotesk", Inter, sans-serif;
      font-size: clamp(1.2rem, 1.2vw + 1rem, 1.8rem);
      letter-spacing: 0.01em;
    }

    .title span {
      background: linear-gradient(94deg, var(--accent), var(--accent-2));
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }

    .top-controls,
    .range-controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }

    button,
    select {
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.06);
      color: var(--text);
      border-radius: 10px;
      padding: 8px 12px;
      min-height: 44px;
      font-size: 0.85rem;
      font-weight: 600;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.14);
      transition: transform 120ms ease, border-color 120ms ease, background 120ms ease, box-shadow 120ms ease;
    }

    body[data-theme="light"] button,
    body[data-theme="light"] select {
      background: rgba(255, 255, 255, 0.78);
    }

    button:hover,
    select:hover {
      transform: translateY(-1px);
      border-color: rgba(130, 177, 255, 0.42);
      background: rgba(255, 255, 255, 0.1);
    }

    select {
      appearance: none;
      padding-right: 30px;
      background-image: linear-gradient(45deg, transparent 50%, var(--muted) 50%), linear-gradient(135deg, var(--muted) 50%, transparent 50%);
      background-position: calc(100% - 14px) 52%, calc(100% - 9px) 52%;
      background-size: 5px 5px, 5px 5px;
      background-repeat: no-repeat;
    }

    button:focus-visible,
    select:focus-visible,
    a:focus-visible,
    .live-item:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    button[data-range][data-active="true"] {
      background: linear-gradient(100deg, rgba(57, 171, 255, 0.34), rgba(140, 102, 255, 0.34));
      border-color: rgba(157, 180, 255, 0.75);
    }

    .status {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      font-size: 0.82rem;
      color: var(--muted);
    }

    .status-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--warn);
      box-shadow: 0 0 0 0 rgba(247, 191, 88, 0.6);
      animation: pulse 2s infinite;
    }

    .status-dot.live {
      background: var(--good);
      box-shadow: 0 0 0 0 rgba(53, 211, 138, 0.6);
    }

    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(98, 163, 255, 0.5); }
      70% { box-shadow: 0 0 0 6px rgba(98, 163, 255, 0); }
      100% { box-shadow: 0 0 0 0 rgba(98, 163, 255, 0); }
    }

    .filters {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr)) auto auto auto;
      gap: 10px;
      align-items: end;
      padding: 16px;
    }

    .filters label {
      display: grid;
      gap: 6px;
      font-size: 0.74rem;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--muted);
    }

    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px;
    }

    .card {
      padding: 20px;
      position: relative;
      overflow: hidden;
    }

    .card::after {
      content: "";
      position: absolute;
      inset: auto -20% -50% auto;
      width: 120%;
      aspect-ratio: 1;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(110, 174, 255, 0.07), transparent 70%);
      pointer-events: none;
    }

    .card-label {
      font-size: 0.76rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.07em;
    }

    .card-value {
      margin-top: 10px;
      font-family: "Space Grotesk", Inter, sans-serif;
      font-size: clamp(1.25rem, 1vw + 0.95rem, 1.75rem);
      font-weight: 700;
      line-height: 1.1;
      letter-spacing: -0.02em;
    }

    .card-trend {
      margin-top: 8px;
      font-size: 0.8rem;
      font-weight: 700;
      color: var(--muted);
    }

    .card-trend[data-kind="up"] { color: var(--good); }
    .card-trend[data-kind="down"] { color: var(--danger); }

    .two-col {
      display: grid;
      grid-template-columns: minmax(0, 2.2fr) minmax(0, 1fr);
      gap: 12px;
    }

    .panel {
      padding: 20px;
      min-width: 0;
    }

    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 10px;
    }

    .panel-title {
      margin: 0;
      font-size: 0.95rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      font-weight: 600;
    }

    .panel-sub {
      margin: 0;
      font-size: 0.8rem;
      color: var(--muted);
    }

    .chart-wrap {
      height: 330px;
    }

    .mini-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .mini-chart {
      height: 220px;
    }

    .live-feed {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 12px;
      max-height: 330px;
      overflow: auto;
    }

    .live-item {
      border: 1px solid var(--line);
      background: rgba(21, 38, 78, 0.45);
      border-radius: 10px;
      padding: 12px 16px;
      display: grid;
      gap: 4px;
      cursor: pointer;
      transition: border-color 120ms ease, transform 120ms ease, background 120ms ease;
    }

    body[data-theme="light"] .live-item {
      background: rgba(244, 248, 255, 0.9);
    }

    .live-item:hover {
      transform: translateY(-1px);
      border-color: rgba(140, 171, 255, 0.7);
      background: rgba(255, 255, 255, 0.08);
    }

    .live-meta {
      font-size: 0.74rem;
      color: var(--muted);
    }

    .live-main {
      font-size: 0.88rem;
      font-weight: 600;
      color: var(--text);
    }

    .table-wrap {
      overflow: auto;
      border-radius: 12px;
      border: 1px solid var(--line);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.86rem;
      min-width: 780px;
      background: rgba(12, 20, 42, 0.36);
    }

    body[data-theme="light"] table {
      background: rgba(255, 255, 255, 0.72);
    }

    th,
    td {
      text-align: left;
      border-bottom: 1px solid var(--line);
      padding: 9px 10px;
      vertical-align: middle;
    }

    tbody tr:hover {
      background: rgba(255, 255, 255, 0.04);
    }

    th {
      font-size: 0.72rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 600;
      position: sticky;
      top: 0;
      background: var(--panel-solid);
    }

    .mono {
      font-family: "JetBrains Mono", ui-monospace, monospace;
      font-size: 0.77rem;
    }

    .table-view {
      padding: 6px 9px;
      font-size: 0.74rem;
    }

    .details-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-top: 8px;
    }

    .detail-box {
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px;
      background: rgba(24, 39, 80, 0.48);
    }

    body[data-theme="light"] .detail-box {
      background: rgba(246, 250, 255, 0.92);
    }

    .detail-label {
      font-size: 0.72rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .detail-value {
      margin-top: 7px;
      font-family: "JetBrains Mono", ui-monospace, monospace;
      font-size: 0.87rem;
      color: var(--text);
      word-break: break-word;
    }

    .footer {
      color: var(--muted);
      font-size: 0.78rem;
      padding: 0 4px 4px;
    }

    .footer a {
      color: var(--accent);
      text-decoration: none;
      margin-right: 10px;
    }

    .toast-stack {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 50;
      display: grid;
      gap: 8px;
      width: min(360px, 88vw);
    }

    .toast {
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px 12px;
      background: rgba(16, 27, 57, 0.92);
      color: var(--text);
      font-size: 0.84rem;
      box-shadow: var(--shadow);
      animation: toastIn 180ms ease;
    }

    body[data-theme="light"] .toast {
      background: rgba(255, 255, 255, 0.95);
    }

    .toast.error {
      border-color: rgba(255, 98, 144, 0.55);
    }

    .live-feed::-webkit-scrollbar,
    .table-wrap::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }

    .live-feed::-webkit-scrollbar-track,
    .table-wrap::-webkit-scrollbar-track {
      background: transparent;
    }

    .live-feed::-webkit-scrollbar-thumb,
    .table-wrap::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2);
      border-radius: 999px;
    }

    @keyframes toastIn {
      from { transform: translateY(8px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    @media (max-width: 1260px) {
      .layout {
        grid-template-columns: minmax(0, 1fr);
      }

      .sidebar {
        position: static;
        min-height: auto;
      }

      .cards {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .filters {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }

    @media (max-width: 920px) {
      .two-col,
      .mini-grid,
      .details-grid,
      .filters {
        grid-template-columns: minmax(0, 1fr);
      }

      .chart-wrap {
        height: 270px;
      }
    }

    @media (max-width: 600px) {
      .topbar {
        flex-direction: column;
        align-items: stretch;
        text-align: center;
      }

      .top-controls,
      .range-controls {
        justify-content: center;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
      }
    }
  </style>
</head>
<body data-theme="dark">
  <!-- TokenSpeed Local Dashboard -->
  <div class="layout">
    <aside class="sidebar">
      <div class="brand-logo">
        <img src="/assets/tokenspeed-logo.webp" alt="TokenSpeed logo">
      </div>
      <div>
        <h2 class="title" style="margin:0 0 6px 0; font-size:1.05rem;">TokenSpeed <span>Control Center</span></h2>
        <p class="panel-sub" style="margin:0;">Realtime observability for requests, cost, throughput and model behavior.</p>
      </div>
      <div class="chip-list">
        <span class="chip">Local Node</span>
        <span class="chip">Realtime SSE</span>
        <span class="chip">Analytics</span>
      </div>
      <div class="sidebar-meta">
        <div>Last refresh: <strong id="sidebarUpdated">-</strong></div>
        <div>Upload queue: <strong id="uploadMeta">-</strong></div>
        <div>Pending: <strong id="uploadPending">-</strong> | Sent: <strong id="uploadSent">-</strong> | Dead: <strong id="uploadDead">-</strong></div>
      </div>
      <button id="flushUpload" type="button">Flush Upload Queue</button>
    </aside>

    <main class="content">
      <header class="topbar">
        <div>
          <h1 class="title">TokenSpeed <span>Local Dashboard</span></h1>
          <div class="status"><span id="liveDot" class="status-dot"></span><span id="liveText">Live channel connecting...</span></div>
        </div>
        <div class="top-controls">
          <div class="range-controls" id="rangeControls">
            <button type="button" data-range="24" data-active="true">24H</button>
            <button type="button" data-range="72">3D</button>
            <button type="button" data-range="168">7D</button>
            <button type="button" data-range="720">30D</button>
          </div>
          <button id="themeToggle" type="button" aria-label="Toggle theme">Toggle Theme</button>
          <button id="refreshNow" type="button" aria-label="Refresh dashboard">Refresh</button>
        </div>
      </header>

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
        <div class="status" id="updated">Updating...</div>
      </section>

      <section class="cards">
        <article class="card">
          <div class="card-label">Requests</div>
          <div class="card-value" id="requests">-</div>
          <div class="card-trend" id="trendRequests">-</div>
        </article>
        <article class="card">
          <div class="card-label">Input Tokens</div>
          <div class="card-value" id="input">-</div>
          <div class="card-trend" id="trendInput">-</div>
        </article>
        <article class="card">
          <div class="card-label">Output Tokens</div>
          <div class="card-value" id="output">-</div>
          <div class="card-trend" id="trendOutput">-</div>
        </article>
        <article class="card">
          <div class="card-label">Total Tokens</div>
          <div class="card-value" id="total">-</div>
          <div class="card-trend" id="trendTotal">-</div>
        </article>
        <article class="card">
          <div class="card-label">Total Cost</div>
          <div class="card-value" id="cost">-</div>
          <div class="card-trend" id="trendCost">-</div>
        </article>
      </section>

      <section class="two-col">
        <article class="panel">
          <div class="panel-head">
            <h2 class="panel-title">Timeseries (tokens/cost/tps)</h2>
            <p class="panel-sub">Window based on selected range</p>
          </div>
          <div class="chart-wrap"><canvas id="trendChart"></canvas></div>
        </article>
        <article class="panel">
          <div class="panel-head">
            <h2 class="panel-title">Live activity</h2>
            <p class="panel-sub">Most recent requests</p>
          </div>
          <ul class="live-feed" id="liveFeed"></ul>
        </article>
      </section>

      <section class="mini-grid">
        <article class="panel">
          <div class="panel-head">
            <h2 class="panel-title">Model usage</h2>
          </div>
          <div class="mini-chart"><canvas id="modelChart"></canvas></div>
        </article>
        <article class="panel">
          <div class="panel-head">
            <h2 class="panel-title">Provider load</h2>
          </div>
          <div class="mini-chart"><canvas id="providerChart"></canvas></div>
        </article>
        <article class="panel">
          <div class="panel-head">
            <h2 class="panel-title">Project costs</h2>
          </div>
          <div class="mini-chart"><canvas id="projectChart"></canvas></div>
        </article>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2 class="panel-title">Recent requests + details</h2>
          <p class="panel-sub">Click view to inspect one request</p>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Started</th>
                <th>Provider</th>
                <th>Model</th>
                <th>Input</th>
                <th>Output</th>
                <th>TPS</th>
                <th>Cost</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody id="history"></tbody>
          </table>
        </div>
        <div class="details-grid" id="detailsGrid">
          <div class="detail-box"><div class="detail-label">Request ID</div><div class="detail-value" id="dReq">-</div></div>
          <div class="detail-box"><div class="detail-label">Session</div><div class="detail-value" id="dSession">-</div></div>
          <div class="detail-box"><div class="detail-label">Message</div><div class="detail-value" id="dMessage">-</div></div>
          <div class="detail-box"><div class="detail-label">Project</div><div class="detail-value" id="dProject">-</div></div>
          <div class="detail-box"><div class="detail-label">Duration</div><div class="detail-value" id="dDuration">-</div></div>
          <div class="detail-box"><div class="detail-label">Reasoning</div><div class="detail-value" id="dReasoning">-</div></div>
          <div class="detail-box"><div class="detail-label">Cache Read</div><div class="detail-value" id="dCacheRead">-</div></div>
          <div class="detail-box"><div class="detail-label">Cache Write</div><div class="detail-value" id="dCacheWrite">-</div></div>
        </div>
      </section>

      <p class="footer">
        Endpoints:
        <a href="/api/stats">/api/stats</a>
        <a href="/api/stats/models">/api/stats/models</a>
        <a href="/api/stats/providers">/api/stats/providers</a>
        <a href="/api/projects">/api/projects</a>
        <a href="/api/history?limit=20">/api/history</a>
        <a href="/api/upload/status">/api/upload/status</a>
      </p>
    </main>
  </div>

  <div id="toastStack" class="toast-stack"></div>

  <script>
    const intFmt = n => Number(n ?? 0).toLocaleString();
    const numFmt = n => (n === null || n === undefined ? "N/A" : Number(n).toFixed(2));
    const costFmt = n => "$" + Number(n ?? 0).toFixed(4);
    const state = {
      projectId: "",
      providerId: "",
      modelId: "",
      rangeHours: 24,
      theme: localStorage.getItem("tokenspeed_theme") || "dark",
    };

    const charts = {
      trend: null,
      models: null,
      providers: null,
      projects: null,
    };

    let previousStats = null;
    let historyCache = [];
    let modelCache = [];
    let providerCache = [];
    let projectCache = [];
    let loadQueued = false;

    function notify(message, isError) {
      const stack = document.getElementById("toastStack");
      const div = document.createElement("div");
      div.className = "toast" + (isError ? " error" : "");
      div.textContent = message;
      stack.appendChild(div);
      setTimeout(() => div.remove(), 3800);
    }

    function dateFmt(ts) {
      if (!ts) return "-";
      const d = new Date(Number(ts));
      return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString();
    }

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
      if (!response.ok) throw new Error("HTTP " + response.status + " on " + path);
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
      if (!response.ok) throw new Error("HTTP " + response.status + " on " + path);
      return response.json();
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

    function applyTheme(theme) {
      state.theme = theme === "light" ? "light" : "dark";
      document.body.setAttribute("data-theme", state.theme);
      localStorage.setItem("tokenspeed_theme", state.theme);
    }

    function trendLabel(delta) {
      if (!Number.isFinite(delta)) return "n/a";
      if (delta === 0) return "0.0%";
      const sign = delta > 0 ? "+" : "";
      return sign + delta.toFixed(1) + "%";
    }

    function updateTrendCard(id, delta) {
      const node = document.getElementById(id);
      node.textContent = trendLabel(delta);
      if (!Number.isFinite(delta) || delta === 0) {
        node.setAttribute("data-kind", "neutral");
      } else {
        node.setAttribute("data-kind", delta > 0 ? "up" : "down");
      }
    }

    function percentDelta(current, previous) {
      if (!previous) return NaN;
      if (previous === 0) return current === 0 ? 0 : 100;
      return ((current - previous) / previous) * 100;
    }

    function buildTrend(history) {
      const now = Date.now();
      const from = now - state.rangeHours * 3600 * 1000;
      const buckets = new Map();

      for (const item of history) {
        const started = Number(item.startedAt || 0);
        if (!Number.isFinite(started) || started < from) continue;
        const d = new Date(started);
        d.setMinutes(0, 0, 0);
        const key = d.getTime();
        const current = buckets.get(key) || { tokens: 0, cost: 0, tpsSum: 0, tpsCount: 0 };
        current.tokens += Number(item.totalTokens || 0);
        current.cost += Number(item.cost || 0);
        const tps = Number(item.outputTps);
        if (Number.isFinite(tps) && tps > 0) {
          current.tpsSum += tps;
          current.tpsCount += 1;
        }
        buckets.set(key, current);
      }

      const points = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
      const labels = [];
      const tokens = [];
      const costs = [];
      const tps = [];

      for (const [ts, value] of points) {
        const d = new Date(ts);
        labels.push(d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
        tokens.push(value.tokens);
        costs.push(Number(value.cost.toFixed(4)));
        tps.push(value.tpsCount ? Number((value.tpsSum / value.tpsCount).toFixed(2)) : 0);
      }

      if (!labels.length) {
        labels.push("-");
        tokens.push(0);
        costs.push(0);
        tps.push(0);
      }

      return { labels, tokens, costs, tps };
    }

    function initCharts() {
      if (!window.Chart || charts.trend) return;

      charts.trend = new Chart(document.getElementById("trendChart"), {
        type: "line",
        data: {
          labels: ["-"],
          datasets: [
            {
              label: "Tokens",
              data: [0],
              borderColor: "#5dd4ff",
              backgroundColor: "rgba(93, 212, 255, 0.17)",
              fill: true,
              tension: 0.35,
              pointRadius: 0,
              borderWidth: 2,
            },
            {
              label: "Cost",
              data: [0],
              borderColor: "#f8bf57",
              backgroundColor: "rgba(248, 191, 87, 0.12)",
              fill: true,
              tension: 0.35,
              pointRadius: 0,
              borderWidth: 2,
            },
            {
              label: "Avg TPS",
              data: [0],
              borderColor: "#9d79ff",
              backgroundColor: "rgba(157, 121, 255, 0.1)",
              fill: true,
              tension: 0.35,
              pointRadius: 0,
              borderWidth: 2,
            },
          ],
        },
        options: {
          maintainAspectRatio: false,
          responsive: true,
          plugins: {
            legend: { labels: { color: "#9bacd4" } },
          },
          scales: {
            x: { ticks: { color: "#9bacd4" }, grid: { color: "rgba(126, 155, 255, 0.15)" } },
            y: { ticks: { color: "#9bacd4" }, grid: { color: "rgba(126, 155, 255, 0.15)" } },
          },
        },
      });

      charts.models = new Chart(document.getElementById("modelChart"), {
        type: "doughnut",
        data: { labels: ["none"], datasets: [{ data: [1], backgroundColor: ["#2d3a68"] }] },
        options: { maintainAspectRatio: false, plugins: { legend: { labels: { color: "#9bacd4" } } } },
      });

      charts.providers = new Chart(document.getElementById("providerChart"), {
        type: "bar",
        data: { labels: ["none"], datasets: [{ data: [0], backgroundColor: "#5dd4ff" }] },
        options: {
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: "#9bacd4" }, grid: { color: "rgba(126, 155, 255, 0.15)" } },
            y: { ticks: { color: "#9bacd4" }, grid: { color: "rgba(126, 155, 255, 0.15)" } },
          },
        },
      });

      charts.projects = new Chart(document.getElementById("projectChart"), {
        type: "bar",
        data: { labels: ["none"], datasets: [{ data: [0], backgroundColor: ["#7b6dff"] }] },
        options: {
          indexAxis: "y",
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: "#9bacd4" }, grid: { color: "rgba(126, 155, 255, 0.15)" } },
            y: { ticks: { color: "#9bacd4" }, grid: { display: false } },
          },
        },
      });
    }

    function updateCharts(models, providers, projects, history) {
      if (!charts.trend) return;

      const trend = buildTrend(history);
      charts.trend.data.labels = trend.labels;
      charts.trend.data.datasets[0].data = trend.tokens;
      charts.trend.data.datasets[1].data = trend.costs;
      charts.trend.data.datasets[2].data = trend.tps;
      charts.trend.update("none");

      const topModels = models.slice(0, 6);
      charts.models.data.labels = topModels.map(item => item.modelID);
      charts.models.data.datasets[0].data = topModels.map(item => item.requestCount);
      charts.models.data.datasets[0].backgroundColor = ["#65d7ff", "#8f79ff", "#45d090", "#f2b35b", "#ff6c9a", "#7aa2ff"];
      charts.models.update("none");

      const topProviders = providers.slice(0, 6);
      charts.providers.data.labels = topProviders.map(item => item.providerID);
      charts.providers.data.datasets[0].data = topProviders.map(item => item.requestCount);
      charts.providers.data.datasets[0].backgroundColor = "#5dd4ff";
      charts.providers.update("none");

      const topProjects = projects.slice(0, 6);
      charts.projects.data.labels = topProjects.map(item => item.projectID.split(/[\\/]/).filter(Boolean).pop() || item.projectID);
      charts.projects.data.datasets[0].data = topProjects.map(item => Number(item.totalCost || 0));
      charts.projects.data.datasets[0].backgroundColor = ["#66cfff", "#7f78ff", "#4fd08d", "#f5bb56", "#ff709a", "#9a80ff"];
      charts.projects.update("none");
    }

    function showDetails(item) {
      if (!item) return;
      document.getElementById("dReq").textContent = item.id || "-";
      document.getElementById("dSession").textContent = item.sessionID || "-";
      document.getElementById("dMessage").textContent = item.messageID || "-";
      document.getElementById("dProject").textContent = item.projectID || "-";
      document.getElementById("dDuration").textContent = Number.isFinite(Number(item.durationMs)) ? Number(item.durationMs).toFixed(0) + " ms" : "n/a";
      document.getElementById("dReasoning").textContent = intFmt(item.reasoningTokens);
      document.getElementById("dCacheRead").textContent = intFmt(item.cacheReadTokens);
      document.getElementById("dCacheWrite").textContent = intFmt(item.cacheWriteTokens);
    }

    function renderLiveFeed(history) {
      const target = document.getElementById("liveFeed");
      target.innerHTML = "";
      const entries = history.slice(0, 14);
      if (!entries.length) {
        const empty = document.createElement("li");
        empty.className = "live-item";
        empty.textContent = "No recent requests yet.";
        target.appendChild(empty);
        return;
      }

      entries.forEach((item, index) => {
        const li = document.createElement("li");
        li.className = "live-item";
        li.setAttribute("role", "button");
        li.setAttribute("tabindex", "0");
        li.setAttribute("aria-label", "Show details for " + (item.providerID || "unknown") + " " + item.modelID);
        li.innerHTML =
          '<div class="live-main">' +
          (item.providerID || "unknown") +
          " / " +
          item.modelID +
          "</div>" +
          '<div class="live-meta">' +
          dateFmt(item.startedAt) +
          " • " +
          intFmt(item.outputTokens) +
          " output • " +
          numFmt(item.outputTps) +
          " TPS</div>";
        li.addEventListener("click", () => showDetails(historyCache[index]));
        li.addEventListener("keydown", event => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            showDetails(historyCache[index]);
          }
        });
        target.appendChild(li);
      });
    }

    function renderHistory(history) {
      const tbody = document.getElementById("history");
      tbody.innerHTML = "";
      if (!history.length) {
        const tr = document.createElement("tr");
        tr.innerHTML = '<td colspan="8">No data</td>';
        tbody.appendChild(tr);
        return;
      }

      history.slice(0, 60).forEach((item, index) => {
        const tr = document.createElement("tr");
        tr.innerHTML =
          "<td>" + dateFmt(item.startedAt) + "</td>" +
          "<td>" + (item.providerID || "unknown") + "</td>" +
          "<td class=\"mono\">" + item.modelID + "</td>" +
          "<td>" + intFmt(item.inputTokens) + "</td>" +
          "<td>" + intFmt(item.outputTokens) + "</td>" +
          "<td>" + numFmt(item.outputTps) + "</td>" +
          "<td>" + costFmt(item.cost) + "</td>" +
          '<td><button type="button" class="table-view" data-idx="' + index + '">View</button></td>';
        tbody.appendChild(tr);
      });

      tbody.querySelectorAll("button[data-idx]").forEach(button => {
        button.addEventListener("click", () => {
          const idx = Number(button.getAttribute("data-idx"));
          showDetails(historyCache[idx]);
        });
      });
    }

    function queueLoad() {
      if (loadQueued) return;
      loadQueued = true;
      setTimeout(() => {
        loadQueued = false;
        void load();
      }, 900);
    }

    function connectLive() {
      const dot = document.getElementById("liveDot");
      const text = document.getElementById("liveText");
      let source;
      try {
        source = new EventSource("/api/live");
      } catch {
        text.textContent = "Live unavailable";
        return;
      }

      source.onopen = () => {
        dot.classList.add("live");
        text.textContent = "Live stream active";
      };

      source.onerror = () => {
        dot.classList.remove("live");
        text.textContent = "Live reconnecting...";
      };

      source.onmessage = () => {
        queueLoad();
      };
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
          fetchJson("/api/history", { limit: 220 }),
          fetchJsonUnfiltered("/api/upload/status"),
        ]);

        syncSelect("projectFilter", projects.map(item => item.projectID), state.projectId, "All projects");
        syncSelect("providerFilter", allProviders.map(item => item.providerID), state.providerId, "All providers");
        syncSelect("modelFilter", allModels.map(item => item.modelID), state.modelId, "All models");

        document.getElementById("requests").textContent = intFmt(stats.requestCount);
        document.getElementById("input").textContent = intFmt(stats.totalInputTokens);
        document.getElementById("output").textContent = intFmt(stats.totalOutputTokens);
        document.getElementById("total").textContent = intFmt(stats.totalTokens);
        document.getElementById("cost").textContent = costFmt(stats.totalCost);

        updateTrendCard("trendRequests", percentDelta(stats.requestCount, previousStats?.requestCount));
        updateTrendCard("trendInput", percentDelta(stats.totalInputTokens, previousStats?.totalInputTokens));
        updateTrendCard("trendOutput", percentDelta(stats.totalOutputTokens, previousStats?.totalOutputTokens));
        updateTrendCard("trendTotal", percentDelta(stats.totalTokens, previousStats?.totalTokens));
        updateTrendCard("trendCost", percentDelta(stats.totalCost, previousStats?.totalCost));

        previousStats = {
          requestCount: Number(stats.requestCount || 0),
          totalInputTokens: Number(stats.totalInputTokens || 0),
          totalOutputTokens: Number(stats.totalOutputTokens || 0),
          totalTokens: Number(stats.totalTokens || 0),
          totalCost: Number(stats.totalCost || 0),
        };

        historyCache = history.slice();
        modelCache = models.slice();
        providerCache = providers.slice();
        projectCache = projects.slice();
        renderLiveFeed(historyCache);
        renderHistory(historyCache);
        showDetails(historyCache[0]);
        updateCharts(modelCache, providerCache, projectCache, historyCache);

        document.getElementById("uploadPending").textContent = intFmt(uploadStatus.queue.pending);
        document.getElementById("uploadSent").textContent = intFmt(uploadStatus.queue.sent);
        document.getElementById("uploadDead").textContent = intFmt(uploadStatus.queue.dead);
        document.getElementById("uploadMeta").textContent = uploadStatus.enabled
          ? "enabled • " + (uploadStatus.hubUrl || "local")
          : "disabled";

        const now = new Date().toLocaleTimeString();
        document.getElementById("updated").textContent = "Updated: " + now;
        document.getElementById("sidebarUpdated").textContent = now;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        document.getElementById("updated").textContent = "Load failed: " + msg;
        notify("Dashboard refresh failed: " + msg, true);
      }
    }

    document.getElementById("applyFilters").addEventListener("click", () => {
      state.projectId = document.getElementById("projectFilter").value;
      state.providerId = document.getElementById("providerFilter").value;
      state.modelId = document.getElementById("modelFilter").value;
      void load();
    });

    document.getElementById("resetFilters").addEventListener("click", () => {
      state.projectId = "";
      state.providerId = "";
      state.modelId = "";
      void load();
    });

    document.getElementById("refreshNow").addEventListener("click", () => {
      void load();
    });

    document.getElementById("themeToggle").addEventListener("click", () => {
      applyTheme(state.theme === "dark" ? "light" : "dark");
      notify("Theme switched to " + state.theme + " mode", false);
    });

    document.getElementById("flushUpload").addEventListener("click", async () => {
      try {
        const response = await fetch("/api/upload/flush", { method: "POST" });
        if (!response.ok) throw new Error("HTTP " + response.status);
        notify("Upload queue flush requested", false);
        await load();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        notify("Flush failed: " + msg, true);
      }
    });

    document.querySelectorAll("button[data-range]").forEach(button => {
      button.addEventListener("click", () => {
        const hours = Number(button.getAttribute("data-range"));
        if (!Number.isFinite(hours) || hours <= 0) return;
        state.rangeHours = hours;
        document.querySelectorAll("button[data-range]").forEach(node => node.setAttribute("data-active", "false"));
        button.setAttribute("data-active", "true");
        updateCharts(modelCache, providerCache, projectCache, historyCache);
      });
    });

    applyTheme(state.theme);
    initCharts();
    connectLive();
    void load();
    setInterval(() => {
      void load();
    }, 8000);
  </script>
</body>
</html>`;
}

export function startApiServer(db: Database, requestedPort: number, options: ApiServerOptions = {}): ApiServerHandle {
  const subscribers = new Set<StreamController>();

  const createSseResponse = () => {
    let heartbeat: Timer | undefined;

    const stream = new ReadableStream<string>({
      start(controller) {
        const subscriber: StreamController = {
          enqueue: chunk => controller.enqueue(chunk),
          close: () => controller.close(),
        };

        subscribers.add(subscriber);
        controller.enqueue(": connected\n\n");

        heartbeat = setInterval(() => {
          try {
            controller.enqueue(": heartbeat\n\n");
          } catch {
            subscribers.delete(subscriber);
            clearInterval(heartbeat);
          }
        }, 15000);
      },
      cancel() {
        if (heartbeat) clearInterval(heartbeat);
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

  const tryStart = (port: number) =>
    Bun.serve({
      port,
      routes: {
        "/": req => {
          if (req.method !== "GET") return methodNotAllowed();
          return new Response(dashboardHtml(), {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
            },
          });
        },
        "/assets/tokenspeed-logo.webp": req => {
          if (req.method === "OPTIONS") return preflightResponse();
          if (req.method !== "GET") return methodNotAllowed();
          const logo = getTokenSpeedLogoWebp();
          if (!logo) return new Response("Not Found", { status: 404 });
          return new Response(logo, {
            headers: {
              "Content-Type": "image/webp",
              "Cache-Control": "public, max-age=86400",
            },
          });
        },
        "/api/stats": req => {
          if (req.method === "OPTIONS") return preflightResponse();
          if (req.method !== "GET") return methodNotAllowed();
          const url = new URL(req.url);
          return jsonResponse(getSessionStatsWithFilters(db, parseRequestFilters(url)));
        },
        "/api/stats/models": req => {
          if (req.method === "OPTIONS") return preflightResponse();
          if (req.method !== "GET") return methodNotAllowed();
          const url = new URL(req.url);
          const filters = parseRequestFilters(url);
          const limit = parseLimit(url, 100);
          return jsonResponse(getModelStats(db, filters).slice(0, Math.max(1, Math.min(limit, 1000))));
        },
        "/api/stats/providers": req => {
          if (req.method === "OPTIONS") return preflightResponse();
          if (req.method !== "GET") return methodNotAllowed();
          const url = new URL(req.url);
          const filters = parseRequestFilters(url);
          const limit = parseLimit(url, 100);
          return jsonResponse(getProviderStats(db, filters).slice(0, Math.max(1, Math.min(limit, 1000))));
        },
        "/api/projects": req => {
          if (req.method === "OPTIONS") return preflightResponse();
          if (req.method !== "GET") return methodNotAllowed();
          const url = new URL(req.url);
          return jsonResponse(getProjects(db, parseLimit(url, 100)));
        },
        "/api/upload/status": req => {
          if (req.method === "OPTIONS") return preflightResponse();
          if (req.method !== "GET") return methodNotAllowed();
          return jsonResponse({
            enabled: options.uploadEnabled ?? false,
            hubUrl: options.uploadHubURL ?? null,
            queue: getUploadQueueStatus(db),
          });
        },
        "/api/upload/queue": req => {
          if (req.method === "OPTIONS") return preflightResponse();
          if (req.method !== "GET") return methodNotAllowed();
          const url = new URL(req.url);
          const limit = parseLimit(url, 100);
          const status = url.searchParams.get("status")?.trim() || undefined;
          return jsonResponse(getUploadQueueEntries(db, limit, status));
        },
        "/api/upload/flush": async req => {
          if (req.method === "OPTIONS") return preflightResponse();
          if (req.method !== "POST") return methodNotAllowed();
          if (!options.flushUploadNow) {
            return withCors(new Response("Upload dispatcher unavailable", { status: 503 }));
          }
          await options.flushUploadNow();
          return jsonResponse({ ok: true });
        },
        "/api/history": req => {
          if (req.method === "OPTIONS") return preflightResponse();
          if (req.method !== "GET") return methodNotAllowed();
          const url = new URL(req.url);
          const limit = parseLimit(url, 100);
          return jsonResponse(getFilteredRequests(db, parseRequestFilters(url), limit));
        },
        "/api/sessions": req => {
          if (req.method === "OPTIONS") return preflightResponse();
          if (req.method !== "GET") return methodNotAllowed();
          const url = new URL(req.url);
          return jsonResponse(getSessions(db, parseLimit(url, 100)));
        },
        "/api/live": req => {
          if (req.method === "OPTIONS") return preflightResponse();
          if (req.method !== "GET") return methodNotAllowed();
          return createSseResponse();
        },
      },
      fetch: () => new Response("Not Found", { status: 404 }),
    });

  let server: Bun.Server<unknown>;
  try {
    server = tryStart(requestedPort);
  } catch {
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
        } catch {
          subscribers.delete(subscriber);
          try {
            subscriber.close();
          } catch (error) {
            void error;
          }
        }
      }
    },
    async stop() {
      for (const subscriber of subscribers) {
        try {
          subscriber.close();
        } catch (error) {
          void error;
        }
      }
      subscribers.clear();
      await server.stop(true);
    },
  };
}

import { createHmac, randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import {
  activateHubDevice,
  bulkSetHubDevicesStatus,
  cleanupExpiredNonces,
  getHubDevice,
  getHubProviders,
  listHubDevices,
  getHubModels,
  getHubProjects,
  getHubSummary,
  getHubTimeseries,
  type HubDashboardFilters,
  type HubTimeseriesGroupBy,
  type HubTimeseriesMetric,
  isNonceUsed,
  openHubDatabase,
  registerHubDevice,
  revokeHubDevice,
  storeNonce,
  touchHubDeviceSeen,
  type HubBucketInput,
  upsertHubBuckets,
} from "./database";
import { getTokenSpeedLogoWebp } from "../ui/logo";

const DEFAULT_HUB_PORT = 3476;
const TIMESTAMP_WINDOW_SECONDS = 300;
const DEFAULT_ADMIN_LOGIN_WINDOW_SECONDS = 300;
const DEFAULT_ADMIN_LOGIN_MAX_ATTEMPTS = 10;

export interface HubServerHandle {
  port: number;
  url: string;
  stop(): Promise<void>;
}

export type HubServerOptions = {
  db?: Database;
  signingKey?: string;
  inviteToken?: string;
  adminToken?: string;
  allowedDevices?: Set<string>;
  adminLoginWindowSeconds?: number;
  adminLoginMaxAttempts?: number;
};

type IngestPayload = {
  schemaVersion: number;
  deviceId: string;
  buckets: HubBucketInput[];
};

type RegisterPayload = {
  deviceId?: string;
  anonUserId?: string;
  label?: string;
  inviteToken: string;
};

type BootstrapPayload = {
  deviceId?: string;
  anonUserId?: string;
  label?: string;
};

type RevokePayload = {
  deviceId: string;
};

type BulkDevicePayload = {
  action: "revoke" | "activate";
  deviceIds: string[];
};

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-TS-Admin-Token, X-TS-Device-ID, X-TS-Timestamp, X-TS-Nonce, X-TS-Signature",
};

function parsePositiveInt(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function parsePort(value: string | undefined): number {
  if (!value) return DEFAULT_HUB_PORT;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 65535) return DEFAULT_HUB_PORT;
  return parsed;
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(data: unknown, status = 200): Response {
  return withCors(Response.json(data, { status }));
}

function err(status: number, message: string): Response {
  return withCors(new Response(message, { status }));
}

function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function parseRange(url: URL): { from?: number; to?: number; limit: number } {
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");
  const limitRaw = url.searchParams.get("limit");

  const from = fromRaw ? Number(fromRaw) : undefined;
  const to = toRaw ? Number(toRaw) : undefined;
  const limitParsed = limitRaw ? Number(limitRaw) : 100;
  const limit = Number.isFinite(limitParsed) ? Math.max(1, Math.min(1000, Math.floor(limitParsed))) : 100;

  return {
    from: Number.isFinite(from) ? from : undefined,
    to: Number.isFinite(to) ? to : undefined,
    limit,
  };
}

function parseMetric(url: URL): HubTimeseriesMetric {
  const metric = url.searchParams.get("metric")?.trim() ?? "tokens";
  if (metric === "cost" || metric === "tps") return metric;
  return "tokens";
}

function parseGroupBy(url: URL): HubTimeseriesGroupBy {
  const groupBy = url.searchParams.get("groupBy")?.trim() ?? "hour";
  if (groupBy === "day") return "day";
  return "hour";
}

function parseDashboardFilters(url: URL): HubDashboardFilters {
  const anonProjectId = url.searchParams.get("anonProjectId")?.trim();
  const providerId = url.searchParams.get("providerId")?.trim();
  const modelId = url.searchParams.get("modelId")?.trim();
  const deviceId = url.searchParams.get("deviceId")?.trim();
  const anonUserId = url.searchParams.get("anonUserId")?.trim();

  return {
    anonProjectId: anonProjectId || undefined,
    providerId: providerId || undefined,
    modelId: modelId || undefined,
    deviceId: deviceId || undefined,
    anonUserId: anonUserId || undefined,
  };
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll("\"", "\"\"")}"`;
}

function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(",");
}

function buildDashboardExportCsv(db: Database, url: URL): string {
  const range = parseRange(url);
  const filters = parseDashboardFilters(url);
  const groupBy = parseGroupBy(url);

  const summary = getHubSummary(db, range.from, range.to, filters);
  const models = getHubModels(db, range.from, range.to, range.limit, filters);
  const providers = getHubProviders(db, range.from, range.to, range.limit, filters);
  const projects = getHubProjects(db, range.from, range.to, range.limit, filters);
  const tokenSeries = getHubTimeseries(db, "tokens", groupBy, range.from, range.to, range.limit, filters);
  const costSeries = getHubTimeseries(db, "cost", groupBy, range.from, range.to, range.limit, filters);
  const tpsSeries = getHubTimeseries(db, "tps", groupBy, range.from, range.to, range.limit, filters);

  const lines: string[] = [];
  lines.push(
    csvRow([
      "rowType",
      "from",
      "to",
      "anonProjectId",
      "providerId",
      "modelId",
      "deviceId",
      "anonUserId",
      "timestamp",
      "metric",
      "groupBy",
      "requestCount",
      "inputTokens",
      "outputTokens",
      "reasoningTokens",
      "cacheReadTokens",
      "cacheWriteTokens",
      "totalCost",
      "avgOutputTps",
      "minOutputTps",
      "maxOutputTps",
      "value",
    ]),
  );

  lines.push(
    csvRow([
      "summary",
      range.from ?? "",
      range.to ?? "",
      filters.anonProjectId ?? "",
      filters.providerId ?? "",
      filters.modelId ?? "",
      filters.deviceId ?? "",
      filters.anonUserId ?? "",
      "",
      "",
      "",
      summary.requestCount,
      summary.totalInputTokens,
      summary.totalOutputTokens,
      summary.totalReasoningTokens,
      summary.totalCacheReadTokens,
      summary.totalCacheWriteTokens,
      summary.totalCost,
      "",
      "",
      "",
      "",
    ]),
  );

  for (const model of models) {
    lines.push(
      csvRow([
        "model",
        range.from ?? "",
        range.to ?? "",
        filters.anonProjectId ?? "",
        model.providerId,
        model.modelId,
        filters.deviceId ?? "",
        filters.anonUserId ?? "",
        "",
        "",
        "",
        model.requestCount,
        model.totalInputTokens,
        model.totalOutputTokens,
        "",
        "",
        "",
        model.totalCost,
        model.avgOutputTps,
        model.minOutputTps,
        model.maxOutputTps,
        "",
      ]),
    );
  }

  for (const provider of providers) {
    lines.push(
      csvRow([
        "provider",
        range.from ?? "",
        range.to ?? "",
        filters.anonProjectId ?? "",
        provider.providerId,
        "",
        filters.deviceId ?? "",
        filters.anonUserId ?? "",
        "",
        "",
        "",
        provider.requestCount,
        provider.totalInputTokens,
        provider.totalOutputTokens,
        "",
        "",
        "",
        provider.totalCost,
        provider.avgOutputTps,
        provider.minOutputTps,
        provider.maxOutputTps,
        "",
      ]),
    );
  }

  for (const project of projects) {
    lines.push(
      csvRow([
        "project",
        range.from ?? "",
        range.to ?? "",
        project.anonProjectId,
        "",
        "",
        filters.deviceId ?? "",
        filters.anonUserId ?? "",
        project.lastBucketEnd ?? "",
        "",
        "",
        project.requestCount,
        project.totalInputTokens,
        project.totalOutputTokens,
        "",
        "",
        "",
        project.totalCost,
        "",
        "",
        "",
        "",
      ]),
    );
  }

  const appendSeries = (metric: "tokens" | "cost" | "tps", points: Array<{ ts: number; value: number; requestCount: number }>) => {
    for (const point of points) {
      lines.push(
        csvRow([
          "timeseries",
          range.from ?? "",
          range.to ?? "",
        filters.anonProjectId ?? "",
        filters.providerId ?? "",
        filters.modelId ?? "",
        filters.deviceId ?? "",
        filters.anonUserId ?? "",
        point.ts,
          metric,
          groupBy,
          point.requestCount,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          point.value,
        ]),
      );
    }
  };

  appendSeries("tokens", tokenSeries);
  appendSeries("cost", costSeries);
  appendSeries("tps", tpsSeries);

  return `${lines.join("\n")}\n`;
}

function buildDashboardExportJson(db: Database, url: URL): unknown {
  const range = parseRange(url);
  const filters = parseDashboardFilters(url);
  const groupBy = parseGroupBy(url);

  const summary = getHubSummary(db, range.from, range.to, filters);
  const models = getHubModels(db, range.from, range.to, range.limit, filters);
  const providers = getHubProviders(db, range.from, range.to, range.limit, filters);
  const projects = getHubProjects(db, range.from, range.to, range.limit, filters);
  const tokenSeries = getHubTimeseries(db, "tokens", groupBy, range.from, range.to, range.limit, filters);
  const costSeries = getHubTimeseries(db, "cost", groupBy, range.from, range.to, range.limit, filters);
  const tpsSeries = getHubTimeseries(db, "tps", groupBy, range.from, range.to, range.limit, filters);

  return {
    generatedAt: Math.floor(Date.now() / 1000),
    query: {
      from: range.from ?? null,
      to: range.to ?? null,
      limit: range.limit,
      groupBy,
      filters: {
        anonProjectId: filters.anonProjectId ?? null,
        providerId: filters.providerId ?? null,
        modelId: filters.modelId ?? null,
        deviceId: filters.deviceId ?? null,
        anonUserId: filters.anonUserId ?? null,
      },
    },
    summary,
    models,
    providers,
    projects,
    timeseries: {
      tokens: tokenSeries,
      cost: costSeries,
      tps: tpsSeries,
    },
  };
}

function hubDashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TokenSpeed Hub Command Center</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js"></script>
  <style>
    @import url("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap");

    :root {
      color-scheme: dark;
      --bg: #030712;
      --bg-2: #0f172a;
      --panel: rgba(15, 23, 42, 0.66);
      --panel-solid: #111c3b;
      --line: rgba(255, 255, 255, 0.08);
      --text: #f8fafc;
      --muted: #94a3b8;
      --accent: #59c5ff;
      --accent-2: #906dff;
      --good: #3fd58f;
      --warn: #f7bf58;
      --shadow: 0 16px 44px rgba(0, 7, 30, 0.45);
    }

    body[data-theme="light"] {
      color-scheme: light;
      --bg: #ecf4ff;
      --bg-2: #dae9ff;
      --panel: rgba(255, 255, 255, 0.9);
      --panel-solid: #ffffff;
      --line: rgba(15, 23, 42, 0.08);
      --text: #132547;
      --muted: #4f6386;
      --accent: #1b5eff;
      --accent-2: #6f42ff;
      --good: #12945a;
      --warn: #b67e17;
      --shadow: 0 16px 30px rgba(55, 85, 160, 0.17);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, "Segoe UI", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at 18% 0%, rgba(106, 71, 255, 0.23), transparent 35%),
        radial-gradient(circle at 88% 20%, rgba(42, 169, 255, 0.18), transparent 38%),
        linear-gradient(140deg, var(--bg), var(--bg-2));
      background-attachment: fixed;
    }

    .layout {
      display: grid;
      grid-template-columns: 280px minmax(0, 1fr);
      gap: 16px;
      max-width: 1540px;
      margin: 0 auto;
      padding: 16px;
    }

    .sidebar,
    .panel,
    .card {
      border: 1px solid var(--line);
      border-radius: 16px;
      background: var(--panel);
      backdrop-filter: blur(16px);
      box-shadow: var(--shadow);
    }

    .sidebar {
      padding: 20px;
      display: grid;
      align-content: start;
      gap: 14px;
      position: sticky;
      top: 16px;
      min-height: calc(100vh - 32px);
    }

    .logo-wrap {
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 14px;
      background: linear-gradient(140deg, rgba(15, 30, 70, 0.7), rgba(9, 20, 48, 0.82));
      display: grid;
      place-items: center;
    }

    body[data-theme="light"] .logo-wrap {
      background: linear-gradient(140deg, rgba(247, 252, 255, 0.9), rgba(225, 238, 255, 0.97));
    }

    .logo-wrap img {
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
      font-size: 0.75rem;
      color: var(--muted);
      background: rgba(77, 121, 255, 0.14);
    }

    body[data-theme="light"] .chip {
      background: rgba(76, 116, 255, 0.08);
    }

    .mono {
      font-family: "JetBrains Mono", ui-monospace, monospace;
    }

    .meta {
      font-size: 0.84rem;
      color: var(--muted);
      display: grid;
      gap: 8px;
    }

    .meta > div {
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }

    .meta strong {
      color: var(--text);
    }

    .content {
      display: grid;
      gap: 12px;
      min-width: 0;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 14px;
      background: rgba(9, 18, 42, 0.72);
      backdrop-filter: blur(10px);
      box-shadow: var(--shadow);
    }

    body[data-theme="light"] .topbar {
      background: rgba(255, 255, 255, 0.9);
    }

    h1 {
      margin: 0;
      font-family: "Space Grotesk", Inter, sans-serif;
      font-size: clamp(1.2rem, 1.2vw + 1rem, 1.8rem);
    }

    h1 span {
      background: linear-gradient(94deg, var(--accent), var(--accent-2));
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }

    .muted {
      margin: 0;
      color: var(--muted);
      font-size: 0.84rem;
    }

    .control-row,
    .range-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }

    button,
    input,
    select {
      border: 1px solid var(--line);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.06);
      color: var(--text);
      padding: 8px 11px;
      min-height: 44px;
      font-size: 0.84rem;
      font-weight: 600;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.14);
      transition: transform 120ms ease, border-color 120ms ease, background 120ms ease, box-shadow 120ms ease;
    }

    body[data-theme="light"] button,
    body[data-theme="light"] input,
    body[data-theme="light"] select {
      background: rgba(255, 255, 255, 0.78);
    }

    button:hover,
    input:hover,
    select:hover {
      transform: translateY(-1px);
      border-color: rgba(137, 172, 255, 0.42);
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
    input:focus-visible,
    select:focus-visible,
    a:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    button[data-range][data-active="true"] {
      background: linear-gradient(100deg, rgba(84, 192, 255, 0.36), rgba(145, 115, 255, 0.36));
      border-color: rgba(152, 181, 255, 0.82);
    }

    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: end;
      padding: 12px;
    }

    .filters input[type="number"] {
      width: 132px;
      max-width: 100%;
    }

    .filters input[type="text"] {
      width: 168px;
      max-width: 100%;
    }

    .filters button {
      flex: 0 0 auto;
    }

    label {
      display: grid;
      gap: 6px;
      font-size: 0.72rem;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      color: var(--muted);
    }

    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px;
    }

    .card {
      padding: 20px;
      overflow: hidden;
      position: relative;
    }

    .card::after {
      content: "";
      position: absolute;
      width: 120%;
      aspect-ratio: 1;
      right: -20%;
      bottom: -55%;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(111, 179, 255, 0.07), transparent 70%);
      pointer-events: none;
    }

    .label {
      font-size: 0.72rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .value {
      margin-top: 8px;
      font-family: "Space Grotesk", Inter, sans-serif;
      font-size: clamp(1.15rem, 1vw + 0.85rem, 1.6rem);
      font-weight: 700;
      line-height: 1.1;
      letter-spacing: -0.02em;
    }

    .charts-grid {
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
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }

    .panel-title {
      margin: 0;
      font-size: 0.93rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      font-weight: 600;
    }

    .chart-wrap {
      height: 320px;
    }

    .mini-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .mini-chart {
      height: 220px;
    }

    .table-wrap {
      overflow: auto;
      border-radius: 12px;
      border: 1px solid var(--line);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 760px;
      font-size: 0.85rem;
      background: rgba(11, 20, 44, 0.35);
    }

    body[data-theme="light"] table {
      background: rgba(255, 255, 255, 0.7);
    }

    th,
    td {
      text-align: left;
      border-bottom: 1px solid var(--line);
      padding: 8px 9px;
      vertical-align: middle;
    }

    tbody tr:hover {
      background: rgba(255, 255, 255, 0.04);
    }

    th {
      position: sticky;
      top: 0;
      background: var(--panel-solid);
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 0.71rem;
      font-weight: 600;
    }

    .footer {
      color: var(--muted);
      font-size: 0.78rem;
      margin: 0;
      padding: 0 4px 4px;
    }

    a {
      color: var(--accent);
      text-decoration: none;
      margin-right: 10px;
    }

    .status {
      display: inline-flex;
      gap: 7px;
      align-items: center;
      font-size: 0.82rem;
      color: var(--muted);
    }

    .dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--good);
      box-shadow: 0 0 0 0 rgba(63, 213, 143, 0.55);
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(63, 213, 143, 0.5); }
      70% { box-shadow: 0 0 0 6px rgba(63, 213, 143, 0); }
      100% { box-shadow: 0 0 0 0 rgba(63, 213, 143, 0); }
    }

    .table-wrap::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }

    .table-wrap::-webkit-scrollbar-track {
      background: transparent;
    }

    .table-wrap::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2);
      border-radius: 999px;
    }

    @media (max-width: 1320px) {
      .layout {
        grid-template-columns: minmax(0, 1fr);
      }

      .sidebar {
        position: static;
        min-height: auto;
      }

      .cards {
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      }
    }

    @media (max-width: 940px) {
      .charts-grid,
      .mini-grid,
      .cards {
        grid-template-columns: minmax(0, 1fr);
      }

      .chart-wrap {
        height: 270px;
      }
    }

    @media (max-width: 600px) {
      .filters {
        flex-direction: column;
        align-items: stretch;
      }

      .filters label,
      .filters input[type="number"],
      .filters input[type="text"],
      .filters button {
        width: 100%;
      }

      .topbar {
        flex-direction: column;
        align-items: stretch;
        text-align: center;
      }

      .control-row,
      .range-row {
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
  <!-- TokenSpeed Hub Dashboard -->
  <div class="layout">
    <aside class="sidebar">
      <div class="logo-wrap"><img src="/assets/tokenspeed-logo.webp" alt="TokenSpeed logo"></div>
      <div>
        <h2 style="margin:0; font-family:Space Grotesk, Inter, sans-serif; font-size:1.05rem;">Hub <span style="background:linear-gradient(95deg,var(--accent),var(--accent-2));-webkit-background-clip:text;background-clip:text;color:transparent;">Command Center</span></h2>
        <p class="muted" style="margin-top:6px;">Centralized usage, cost and throughput analytics across devices.</p>
      </div>
      <div class="chip-list">
        <span class="chip">Central Hub</span>
        <span class="chip">CSV/JSON Export</span>
        <span class="chip">Multi-Device</span>
      </div>
      <div class="meta">
        <div>Last refresh: <strong id="sideUpdated">-</strong></div>
        <div>Current range: <strong id="rangeMeta">open</strong></div>
        <div>Grouping: <strong id="groupMeta">hour</strong></div>
      </div>
      <a href="/admin">Open Admin Panel</a>
    </aside>

    <main class="content">
      <header class="topbar">
        <div>
          <h1>TokenSpeed <span>Hub Dashboard</span></h1>
          <div class="status"><span class="dot"></span><span id="updated">Loading...</span></div>
        </div>
        <div class="control-row">
          <div class="range-row" id="rangeButtons">
            <button type="button" data-range="24" data-active="true">24H</button>
            <button type="button" data-range="168">7D</button>
            <button type="button" data-range="720">30D</button>
          </div>
          <select id="groupBy">
            <option value="hour">Hour</option>
            <option value="day">Day</option>
          </select>
          <button id="themeToggle" type="button" aria-label="Toggle theme">Toggle Theme</button>
          <button id="refreshNow" type="button" aria-label="Refresh dashboard">Refresh</button>
        </div>
      </header>

      <section class="panel filters">
        <label>From (unix sec)
          <input id="from" type="number" min="0" step="1" placeholder="optional">
        </label>
        <label>To (unix sec)
          <input id="to" type="number" min="0" step="1" placeholder="optional">
        </label>
        <label>Provider
          <input id="provider" type="text" placeholder="optional">
        </label>
        <label>Model
          <input id="model" type="text" placeholder="optional">
        </label>
        <label>Anon project
          <input id="anonProject" type="text" placeholder="optional">
        </label>
        <label>Device
          <input id="device" type="text" placeholder="optional">
        </label>
        <label>Anon user
          <input id="anonUser" type="text" placeholder="optional">
        </label>
        <button id="apply" type="button">Apply</button>
        <button id="clear" type="button">Clear</button>
        <button id="last24h" type="button">Last 24h</button>
      </section>

      <section class="cards">
        <div class="card"><div class="label">Requests</div><div class="value" id="requests">-</div></div>
        <div class="card"><div class="label">Input Tokens</div><div class="value" id="input">-</div></div>
        <div class="card"><div class="label">Output Tokens</div><div class="value" id="output">-</div></div>
        <div class="card"><div class="label">Reasoning Tokens</div><div class="value" id="reasoning">-</div></div>
        <div class="card"><div class="label">Cache Read</div><div class="value" id="cacheRead">-</div></div>
        <div class="card"><div class="label">Total Cost</div><div class="value" id="cost">-</div></div>
      </section>

      <section class="charts-grid">
        <article class="panel">
          <div class="panel-head">
            <h2 class="panel-title">Timeseries (tokens/cost/tps)</h2>
            <p class="muted">Based on selected filters</p>
          </div>
          <div class="chart-wrap"><canvas id="trendChart"></canvas></div>
        </article>
        <article class="panel">
          <div class="panel-head">
            <h2 class="panel-title">Timeseries table</h2>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Timestamp</th><th>Tokens</th><th>Cost</th><th>Avg TPS</th><th>Requests</th></tr></thead>
              <tbody id="timeseries"></tbody>
            </table>
          </div>
        </article>
      </section>

      <section class="mini-grid">
        <article class="panel">
          <div class="panel-head"><h2 class="panel-title">Model usage</h2></div>
          <div class="mini-chart"><canvas id="modelChart"></canvas></div>
        </article>
        <article class="panel">
          <div class="panel-head"><h2 class="panel-title">Provider load</h2></div>
          <div class="mini-chart"><canvas id="providerChart"></canvas></div>
        </article>
        <article class="panel">
          <div class="panel-head"><h2 class="panel-title">Project cost map</h2></div>
          <div class="mini-chart"><canvas id="projectChart"></canvas></div>
        </article>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2 class="panel-title">Top models / providers / projects</h2>
          <p class="muted">Drill-down list</p>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Primary</th>
                <th>Secondary</th>
                <th>Requests</th>
                <th>Input</th>
                <th>Output</th>
                <th>Cost</th>
                <th>Avg TPS</th>
              </tr>
            </thead>
            <tbody id="combinedRows"></tbody>
          </table>
        </div>
      </section>

      <p class="footer">
        Endpoints:
        <a href="/v1/dashboard/summary">/v1/dashboard/summary</a>
        <a href="/v1/dashboard/models">/v1/dashboard/models</a>
        <a href="/v1/dashboard/projects">/v1/dashboard/projects</a>
        <a href="/v1/dashboard/providers">/v1/dashboard/providers</a>
        <a href="/v1/dashboard/timeseries">/v1/dashboard/timeseries</a>
        <a id="exportCsvLink" href="/v1/dashboard/export.csv">/v1/dashboard/export.csv</a>
        <a id="exportJsonLink" href="/v1/dashboard/export.json">/v1/dashboard/export.json</a>
      </p>
    </main>
  </div>

  <script>
    const state = {
      from: "",
      to: "",
      providerId: "",
      modelId: "",
      anonProjectId: "",
      deviceId: "",
      anonUserId: "",
      groupBy: "hour",
      theme: localStorage.getItem("tokenspeed_theme") || "dark",
    };

    const intFmt = n => Number(n ?? 0).toLocaleString();
    const costFmt = n => "$" + Number(n ?? 0).toFixed(4);
    const numFmt = n => (n === null || n === undefined ? "N/A" : Number(n).toFixed(2));
    const tsFmt = ts => {
      const d = new Date(Number(ts) * 1000);
      return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString();
    };

    const charts = {
      trend: null,
      models: null,
      providers: null,
      projects: null,
    };

    function applyTheme(theme) {
      state.theme = theme === "light" ? "light" : "dark";
      document.body.setAttribute("data-theme", state.theme);
      localStorage.setItem("tokenspeed_theme", state.theme);
    }

    function query(extra) {
      const params = new URLSearchParams();
      if (state.from) params.set("from", state.from);
      if (state.to) params.set("to", state.to);
      if (state.providerId) params.set("providerId", state.providerId);
      if (state.modelId) params.set("modelId", state.modelId);
      if (state.anonProjectId) params.set("anonProjectId", state.anonProjectId);
      if (state.deviceId) params.set("deviceId", state.deviceId);
      if (state.anonUserId) params.set("anonUserId", state.anonUserId);
      if (extra) {
        for (const [key, value] of Object.entries(extra)) {
          if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
        }
      }
      const q = params.toString();
      return q ? "?" + q : "";
    }

    function refreshExportLink() {
      const csvLink = document.getElementById("exportCsvLink");
      const jsonLink = document.getElementById("exportJsonLink");
      csvLink.setAttribute("href", "/v1/dashboard/export.csv" + query());
      jsonLink.setAttribute("href", "/v1/dashboard/export.json" + query());
    }

    async function getJson(path, extra) {
      const response = await fetch(path + query(extra));
      if (!response.ok) throw new Error("HTTP " + response.status + " on " + path);
      return response.json();
    }

    function initCharts() {
      if (!window.Chart || charts.trend) return;

      charts.trend = new Chart(document.getElementById("trendChart"), {
        type: "line",
        data: {
          labels: ["-"],
          datasets: [
            { label: "Tokens", data: [0], borderColor: "#60d0ff", backgroundColor: "rgba(96, 208, 255, 0.18)", fill: true, tension: 0.35, pointRadius: 0 },
            { label: "Cost", data: [0], borderColor: "#f7bf58", backgroundColor: "rgba(247, 191, 88, 0.13)", fill: true, tension: 0.35, pointRadius: 0 },
            { label: "TPS", data: [0], borderColor: "#9a78ff", backgroundColor: "rgba(154, 120, 255, 0.12)", fill: true, tension: 0.35, pointRadius: 0 },
          ],
        },
        options: {
          maintainAspectRatio: false,
          plugins: { legend: { labels: { color: "#9fafd7" } } },
          scales: {
            x: { ticks: { color: "#9fafd7" }, grid: { color: "rgba(123, 152, 255, 0.15)" } },
            y: { ticks: { color: "#9fafd7" }, grid: { color: "rgba(123, 152, 255, 0.15)" } },
          },
        },
      });

      charts.models = new Chart(document.getElementById("modelChart"), {
        type: "doughnut",
        data: { labels: ["none"], datasets: [{ data: [1], backgroundColor: ["#2f3a67"] }] },
        options: { maintainAspectRatio: false, plugins: { legend: { labels: { color: "#9fafd7" } } } },
      });

      charts.providers = new Chart(document.getElementById("providerChart"), {
        type: "bar",
        data: { labels: ["none"], datasets: [{ data: [0], backgroundColor: "#60d0ff" }] },
        options: {
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: "#9fafd7" }, grid: { color: "rgba(123, 152, 255, 0.15)" } },
            y: { ticks: { color: "#9fafd7" }, grid: { color: "rgba(123, 152, 255, 0.15)" } },
          },
        },
      });

      charts.projects = new Chart(document.getElementById("projectChart"), {
        type: "bar",
        data: { labels: ["none"], datasets: [{ data: [0], backgroundColor: ["#8e6fff"] }] },
        options: {
          indexAxis: "y",
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: "#9fafd7" }, grid: { color: "rgba(123, 152, 255, 0.15)" } },
            y: { ticks: { color: "#9fafd7" }, grid: { display: false } },
          },
        },
      });
    }

    function row(cells) {
      const tr = document.createElement("tr");
      for (const value of cells) {
        const td = document.createElement("td");
        td.innerHTML = value;
        tr.appendChild(td);
      }
      return tr;
    }

    function setRows(id, rows, mapRow, emptyCols) {
      const tbody = document.getElementById(id);
      tbody.innerHTML = "";
      if (!rows.length) {
        const empty = ["No data"];
        for (let i = 1; i < emptyCols; i += 1) empty.push("");
        tbody.appendChild(row(empty));
        return;
      }
      for (const item of rows) {
        tbody.appendChild(row(mapRow(item)));
      }
    }

    function renderCombinedRows(models, providers, projects) {
      const tbody = document.getElementById("combinedRows");
      tbody.innerHTML = "";

      models.slice(0, 8).forEach(item => {
        tbody.appendChild(row([
          "Model",
          '<span class="mono">' + item.providerId + "</span>",
          '<span class="mono">' + item.modelId + "</span>",
          intFmt(item.requestCount),
          intFmt(item.totalInputTokens),
          intFmt(item.totalOutputTokens),
          costFmt(item.totalCost),
          numFmt(item.avgOutputTps),
        ]));
      });

      providers.slice(0, 8).forEach(item => {
        tbody.appendChild(row([
          "Provider",
          '<span class="mono">' + item.providerId + "</span>",
          "-",
          intFmt(item.requestCount),
          intFmt(item.totalInputTokens),
          intFmt(item.totalOutputTokens),
          costFmt(item.totalCost),
          numFmt(item.avgOutputTps),
        ]));
      });

      projects.slice(0, 8).forEach(item => {
        tbody.appendChild(row([
          "Project",
          '<span class="mono">' + item.anonProjectId + "</span>",
          tsFmt(item.lastBucketEnd || 0),
          intFmt(item.requestCount),
          intFmt(item.totalInputTokens),
          intFmt(item.totalOutputTokens),
          costFmt(item.totalCost),
          "-",
        ]));
      });
    }

    function applyRange(hours) {
      const now = Math.floor(Date.now() / 1000);
      state.from = String(now - hours * 3600);
      state.to = String(now);
      document.getElementById("from").value = state.from;
      document.getElementById("to").value = state.to;
      document.getElementById("rangeMeta").textContent = hours + "h";
    }

    function updateCharts(models, providers, projects, mergedSeries) {
      if (!charts.trend) return;

      charts.trend.data.labels = mergedSeries.map(item => tsFmt(item.ts));
      charts.trend.data.datasets[0].data = mergedSeries.map(item => item.tokens);
      charts.trend.data.datasets[1].data = mergedSeries.map(item => Number(item.cost.toFixed(4)));
      charts.trend.data.datasets[2].data = mergedSeries.map(item => Number(item.tps.toFixed(2)));
      charts.trend.update("none");

      const topModels = models.slice(0, 6);
      charts.models.data.labels = topModels.map(item => item.modelId);
      charts.models.data.datasets[0].data = topModels.map(item => item.requestCount);
      charts.models.data.datasets[0].backgroundColor = ["#64d8ff", "#8e79ff", "#44cf8d", "#f2b259", "#ff6a96", "#7fa2ff"];
      charts.models.update("none");

      const topProviders = providers.slice(0, 6);
      charts.providers.data.labels = topProviders.map(item => item.providerId);
      charts.providers.data.datasets[0].data = topProviders.map(item => item.requestCount);
      charts.providers.data.datasets[0].backgroundColor = "#62d4ff";
      charts.providers.update("none");

      const topProjects = projects.slice(0, 6);
      charts.projects.data.labels = topProjects.map(item => item.anonProjectId);
      charts.projects.data.datasets[0].data = topProjects.map(item => Number(item.totalCost || 0));
      charts.projects.data.datasets[0].backgroundColor = ["#66ccff", "#7f74ff", "#4ed193", "#f5b751", "#ff739b", "#9d82ff"];
      charts.projects.update("none");
    }

    async function load() {
      try {
        const [summary, models, providers, projects, tokensSeries, costSeries, tpsSeries] = await Promise.all([
          getJson("/v1/dashboard/summary"),
          getJson("/v1/dashboard/models", { limit: 40 }),
          getJson("/v1/dashboard/providers", { limit: 40 }),
          getJson("/v1/dashboard/projects", { limit: 40 }),
          getJson("/v1/dashboard/timeseries", { metric: "tokens", groupBy: state.groupBy, limit: 90 }),
          getJson("/v1/dashboard/timeseries", { metric: "cost", groupBy: state.groupBy, limit: 90 }),
          getJson("/v1/dashboard/timeseries", { metric: "tps", groupBy: state.groupBy, limit: 90 }),
        ]);

        document.getElementById("requests").textContent = intFmt(summary.requestCount);
        document.getElementById("input").textContent = intFmt(summary.totalInputTokens);
        document.getElementById("output").textContent = intFmt(summary.totalOutputTokens);
        document.getElementById("reasoning").textContent = intFmt(summary.totalReasoningTokens);
        document.getElementById("cacheRead").textContent = intFmt(summary.totalCacheReadTokens);
        document.getElementById("cost").textContent = costFmt(summary.totalCost);

        const byTs = new Map();
        for (const point of tokensSeries) byTs.set(point.ts, { ts: point.ts, tokens: point.value, cost: 0, tps: 0, requestCount: point.requestCount });
        for (const point of costSeries) {
          const current = byTs.get(point.ts) || { ts: point.ts, tokens: 0, cost: 0, tps: 0, requestCount: point.requestCount };
          current.cost = point.value;
          byTs.set(point.ts, current);
        }
        for (const point of tpsSeries) {
          const current = byTs.get(point.ts) || { ts: point.ts, tokens: 0, cost: 0, tps: 0, requestCount: point.requestCount };
          current.tps = point.value;
          byTs.set(point.ts, current);
        }

        const mergedSeries = [...byTs.values()].sort((a, b) => a.ts - b.ts).slice(-36);

        setRows("timeseries", mergedSeries, item => [
          tsFmt(item.ts),
          intFmt(item.tokens),
          costFmt(item.cost),
          numFmt(item.tps),
          intFmt(item.requestCount),
        ], 5);

        renderCombinedRows(models, providers, projects);
        updateCharts(models, providers, projects, mergedSeries.length ? mergedSeries : [{ ts: 0, tokens: 0, cost: 0, tps: 0, requestCount: 0 }]);

        const now = new Date().toLocaleTimeString();
        document.getElementById("updated").textContent = "Updated " + now;
        document.getElementById("sideUpdated").textContent = now;
        document.getElementById("groupMeta").textContent = state.groupBy;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        document.getElementById("updated").textContent = "Load failed: " + msg;
      }
    }

    function applyFiltersFromInputs() {
      state.from = document.getElementById("from").value.trim();
      state.to = document.getElementById("to").value.trim();
      state.providerId = document.getElementById("provider").value.trim();
      state.modelId = document.getElementById("model").value.trim();
      state.anonProjectId = document.getElementById("anonProject").value.trim();
      state.deviceId = document.getElementById("device").value.trim();
      state.anonUserId = document.getElementById("anonUser").value.trim();
      state.groupBy = document.getElementById("groupBy").value;
      if (state.from && state.to) {
        document.getElementById("rangeMeta").textContent = state.from + " - " + state.to;
      } else {
        document.getElementById("rangeMeta").textContent = "open";
      }
      refreshExportLink();
    }

    document.getElementById("apply").addEventListener("click", () => {
      applyFiltersFromInputs();
      void load();
    });

    document.getElementById("clear").addEventListener("click", () => {
      state.from = "";
      state.to = "";
      state.providerId = "";
      state.modelId = "";
      state.anonProjectId = "";
      state.deviceId = "";
      state.anonUserId = "";
      document.getElementById("from").value = "";
      document.getElementById("to").value = "";
      document.getElementById("provider").value = "";
      document.getElementById("model").value = "";
      document.getElementById("anonProject").value = "";
      document.getElementById("device").value = "";
      document.getElementById("anonUser").value = "";
      document.getElementById("rangeMeta").textContent = "open";
      refreshExportLink();
      void load();
    });

    document.getElementById("last24h").addEventListener("click", () => {
      applyRange(24);
      applyFiltersFromInputs();
      void load();
    });

    document.getElementById("refreshNow").addEventListener("click", () => {
      applyFiltersFromInputs();
      void load();
    });

    document.getElementById("themeToggle").addEventListener("click", () => {
      applyTheme(state.theme === "dark" ? "light" : "dark");
    });

    document.getElementById("groupBy").addEventListener("change", () => {
      state.groupBy = document.getElementById("groupBy").value;
      applyFiltersFromInputs();
      void load();
    });

    document.querySelectorAll("button[data-range]").forEach(button => {
      button.addEventListener("click", () => {
        const hours = Number(button.getAttribute("data-range"));
        if (!Number.isFinite(hours) || hours <= 0) return;
        applyRange(hours);
        document.querySelectorAll("button[data-range]").forEach(node => node.setAttribute("data-active", "false"));
        button.setAttribute("data-active", "true");
        applyFiltersFromInputs();
        void load();
      });
    });

    applyTheme(state.theme);
    applyRange(24);
    applyFiltersFromInputs();
    initCharts();
    void load();
    setInterval(() => {
      applyFiltersFromInputs();
      void load();
    }, 10000);
  </script>
</body>
</html>`;
}

function hubAdminHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TokenSpeed Hub Admin</title>
  <style>
    @import url("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600;700&display=swap");

    :root {
      color-scheme: dark;
      --bg: #060b1f;
      --bg2: #0d1739;
      --panel: rgba(16, 27, 58, 0.82);
      --ink: #e7efff;
      --muted: #9aabd4;
      --line: rgba(109, 141, 255, 0.25);
      --brand: #5ac6ff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at 20% 0%, rgba(108, 72, 255, 0.22), transparent 36%),
        radial-gradient(circle at 90% 20%, rgba(41, 164, 255, 0.17), transparent 38%),
        linear-gradient(140deg, var(--bg), var(--bg2));
      color: var(--ink);
    }
    main {
      max-width: 980px;
      margin: 0 auto;
      padding: 24px;
      display: grid;
      gap: 12px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px;
      backdrop-filter: blur(16px);
      box-shadow: 0 16px 44px rgba(0, 7, 30, 0.45);
    }
    h1 { margin: 0 0 8px 0; font-size: 1.4rem; }
    .muted { margin: 0; color: var(--muted); }
    .hero {
      display: grid;
      grid-template-columns: 140px 1fr;
      gap: 12px;
      align-items: center;
    }
    .hero-logo {
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 8px;
      background: rgba(9, 20, 48, 0.78);
    }
    .hero-logo img {
      width: 100%;
      height: auto;
      display: block;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
    }
    @media (min-width: 900px) {
      .grid { grid-template-columns: 1fr 1fr; }
    }
    label {
      display: grid;
      gap: 4px;
      font-size: 0.8rem;
      color: var(--muted);
    }
    input, button {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 7px 10px;
      min-height: 44px;
      background: rgba(255, 255, 255, 0.06);
      color: var(--ink);
      font-size: 0.9rem;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.14);
    }
    button {
      cursor: pointer;
      background: rgba(255, 255, 255, 0.1);
    }
    input:focus-visible, button:focus-visible, a:focus-visible {
      outline: 2px solid var(--brand);
      outline-offset: 2px;
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
    th { font-size: 0.76rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }
    pre {
      margin: 0;
      background: rgba(7, 15, 35, 0.8);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px;
      overflow: auto;
      max-height: 260px;
      font-size: 0.8rem;
    }
    a { color: var(--brand); text-decoration: none; }

    tbody tr:hover {
      background: rgba(255, 255, 255, 0.04);
    }

    @media (max-width: 760px) {
      .hero { grid-template-columns: 1fr; }
    }

    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
    }
  </style>
</head>
<body>
  <main>
    <section class="panel">
      <div class="hero">
        <div class="hero-logo"><img src="/assets/tokenspeed-logo.webp" alt="TokenSpeed logo"></div>
        <div>
          <h1>TokenSpeed Hub Admin</h1>
          <p class="muted">Manage devices using invite and admin tokens.</p>
        </div>
      </div>
    </section>

    <section class="panel grid">
      <label>Admin token
        <input id="adminToken" type="password" placeholder="required for list/revoke">
      </label>
      <label>Invite token
        <input id="inviteToken" type="password" placeholder="required for register">
      </label>
      <label>Device ID
        <input id="deviceId" type="text" placeholder="optional for register, required for revoke">
      </label>
      <label>Anon user ID
        <input id="anonUserId" type="text" placeholder="optional for register/list">
      </label>
      <label>Status filter
        <input id="deviceStatus" type="text" placeholder="active or revoked">
      </label>
      <label>Label
        <input id="label" type="text" placeholder="optional for register">
      </label>
      <label>Bulk device IDs (comma or newline)
        <input id="deviceIds" type="text" placeholder="dev_a,dev_b,dev_c">
      </label>
    </section>

    <section class="panel">
      <button id="registerBtn" type="button">Register Device</button>
      <button id="listBtn" type="button">List Devices</button>
      <button id="revokeBtn" type="button">Revoke Device</button>
      <button id="activateBtn" type="button">Activate Device</button>
      <button id="bulkRevokeBtn" type="button">Bulk Revoke</button>
      <button id="bulkActivateBtn" type="button">Bulk Activate</button>
      <button id="logoutBtn" type="button">Logout</button>
    </section>

    <section class="panel">
      <strong>Devices</strong>
      <table>
        <thead>
          <tr>
            <th>Device</th><th>Anon User</th><th>Label</th><th>Status</th><th>Last Seen</th><th>Updated</th>
          </tr>
        </thead>
        <tbody id="devices"></tbody>
      </table>
    </section>

    <section class="panel">
      <strong>Response</strong>
      <pre id="output">Ready.</pre>
    </section>

    <section class="panel">
      <a href="/">Back to dashboard</a>
    </section>
  </main>

  <script>
    function byId(id) { return document.getElementById(id); }
    function fmtTs(ts) {
      if (!ts) return "-";
      const d = new Date(Number(ts) * 1000);
      return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString();
    }
    function showJson(value) {
      byId("output").textContent = JSON.stringify(value, null, 2);
    }
    function row(cells) {
      const tr = document.createElement("tr");
      for (const value of cells) {
        const td = document.createElement("td");
        td.textContent = String(value);
        tr.appendChild(td);
      }
      return tr;
    }
    function setDeviceRows(devices) {
      const tbody = byId("devices");
      tbody.innerHTML = "";
      if (!devices.length) {
        tbody.appendChild(row(["No devices", "", "", "", "", ""]));
        return;
      }
      for (const device of devices) {
        tbody.appendChild(row([
          device.deviceId,
          device.anonUserId || "",
          device.label || "",
          device.status,
          fmtTs(device.lastSeen),
          fmtTs(device.updatedAt),
        ]));
      }
    }
    function parseBulkIds(value) {
      return value
        .split(/[\n,]+/)
        .map(item => item.trim())
        .filter(Boolean);
    }
    async function listDevices() {
      const adminToken = byId("adminToken").value.trim();
      const deviceId = byId("deviceId").value.trim();
      const anonUserId = byId("anonUserId").value.trim();
      const status = byId("deviceStatus").value.trim();
      const params = new URLSearchParams({ limit: "200" });
      if (deviceId) params.set("deviceId", deviceId);
      if (anonUserId) params.set("anonUserId", anonUserId);
      if (status === "active" || status === "revoked") params.set("status", status);
      const response = await fetch("/v1/devices?" + params.toString(), {
        headers: {
          "X-TS-Admin-Token": adminToken,
        },
      });
      const text = await response.text();
      let body = text;
      try { body = JSON.parse(text); } catch {}
      if (!response.ok) {
        showJson({ status: response.status, error: body });
        return;
      }
      showJson(body);
      setDeviceRows(Array.isArray(body) ? body : []);
    }
    byId("listBtn").addEventListener("click", async () => {
      try {
        await listDevices();
      } catch (error) {
        showJson({ error: String(error) });
      }
    });
    byId("registerBtn").addEventListener("click", async () => {
      const inviteToken = byId("inviteToken").value.trim();
      const deviceId = byId("deviceId").value.trim();
      const label = byId("label").value.trim();
      try {
        const response = await fetch("/v1/devices/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            inviteToken: inviteToken,
            deviceId: deviceId || undefined,
            anonUserId: byId("anonUserId").value.trim() || undefined,
            label: label || undefined,
          }),
        });
        const text = await response.text();
        let body = text;
        try { body = JSON.parse(text); } catch {}
        showJson({ status: response.status, body: body });
        if (response.ok) await listDevices();
      } catch (error) {
        showJson({ error: String(error) });
      }
    });
    byId("revokeBtn").addEventListener("click", async () => {
      const adminToken = byId("adminToken").value.trim();
      const deviceId = byId("deviceId").value.trim();
      try {
        const response = await fetch("/v1/devices/revoke", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-TS-Admin-Token": adminToken,
          },
          body: JSON.stringify({ deviceId: deviceId }),
        });
        const text = await response.text();
        let body = text;
        try { body = JSON.parse(text); } catch {}
        showJson({ status: response.status, body: body });
        if (response.ok) await listDevices();
      } catch (error) {
        showJson({ error: String(error) });
      }
    });
    byId("activateBtn").addEventListener("click", async () => {
      const adminToken = byId("adminToken").value.trim();
      const deviceId = byId("deviceId").value.trim();
      try {
        const response = await fetch("/v1/devices/activate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-TS-Admin-Token": adminToken,
          },
          body: JSON.stringify({ deviceId: deviceId }),
        });
        const text = await response.text();
        let body = text;
        try { body = JSON.parse(text); } catch {}
        showJson({ status: response.status, body: body });
        if (response.ok) await listDevices();
      } catch (error) {
        showJson({ error: String(error) });
      }
    });
    async function callBulk(action) {
      const adminToken = byId("adminToken").value.trim();
      const deviceIds = parseBulkIds(byId("deviceIds").value.trim());
      if (!deviceIds.length) {
        showJson({ error: "Provide at least one device ID for bulk action." });
        return;
      }
      const response = await fetch("/v1/devices/bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-TS-Admin-Token": adminToken,
        },
        body: JSON.stringify({ action, deviceIds }),
      });
      const text = await response.text();
      let body = text;
      try { body = JSON.parse(text); } catch {}
      showJson({ status: response.status, body: body });
      if (response.ok) await listDevices();
    }
    byId("bulkRevokeBtn").addEventListener("click", async () => {
      try {
        await callBulk("revoke");
      } catch (error) {
        showJson({ error: String(error) });
      }
    });
    byId("bulkActivateBtn").addEventListener("click", async () => {
      try {
        await callBulk("activate");
      } catch (error) {
        showJson({ error: String(error) });
      }
    });
    byId("logoutBtn").addEventListener("click", async () => {
      try {
        await fetch("/admin/logout", { method: "POST" });
      } finally {
        window.location.href = "/admin";
      }
    });
  </script>
</body>
</html>`;
}

function hubAdminLoginHtml(errorMessage?: string): string {
  const message = errorMessage ? `<p class="error">${errorMessage}</p>` : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TokenSpeed Hub Admin Login</title>
  <style>
    @import url("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600;700&display=swap");

    :root {
      color-scheme: dark;
      --bg: #060b1f;
      --bg2: #0d1739;
      --panel: rgba(15, 26, 55, 0.86);
      --ink: #e9efff;
      --muted: #9eafd6;
      --line: rgba(109, 141, 255, 0.24);
      --danger: #b42318;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: Inter, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at 20% 0%, rgba(108, 72, 255, 0.24), transparent 36%),
        radial-gradient(circle at 90% 20%, rgba(41, 164, 255, 0.18), transparent 38%),
        linear-gradient(140deg, var(--bg), var(--bg2));
      color: var(--ink);
    }
    main {
      width: min(440px, 92vw);
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 20px;
      display: grid;
      gap: 12px;
      box-shadow: 0 18px 44px rgba(1, 8, 33, 0.5);
      backdrop-filter: blur(10px);
    }
    h1 {
      margin: 0;
      font-size: 1.2rem;
      font-family: "Space Grotesk", Inter, sans-serif;
    }
    p { margin: 0; color: var(--muted); }
    .logo-wrap {
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px;
      background: rgba(8, 18, 44, 0.8);
      display: grid;
      place-items: center;
    }
    .logo-wrap img {
      width: min(240px, 100%);
      height: auto;
      display: block;
    }
    .error {
      color: var(--danger);
      background: #fff2f0;
      border: 1px solid #ffd0ca;
      border-radius: 8px;
      padding: 8px 10px;
    }
    label {
      display: grid;
      gap: 6px;
      font-size: 0.82rem;
      color: var(--muted);
    }
    input, button {
      border: 1px solid var(--line);
      border-radius: 9px;
      padding: 9px 11px;
      min-height: 44px;
      font-size: 0.93rem;
      color: var(--ink);
      background: rgba(255, 255, 255, 0.08);
    }
    button {
      cursor: pointer;
      font-weight: 600;
      background: rgba(255, 255, 255, 0.12);
    }
    input:focus-visible, button:focus-visible {
      outline: 2px solid #5ac6ff;
      outline-offset: 2px;
    }
    code {
      font-size: 0.82rem;
      background: rgba(34, 56, 118, 0.35);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 2px 6px;
    }

    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
    }
  </style>
</head>
<body>
  <main>
    <div class="logo-wrap"><img src="/assets/tokenspeed-logo.webp" alt="TokenSpeed logo"></div>
    <h1>TokenSpeed Hub Admin</h1>
    <p>Admin access requires <code>TS_HUB_ADMIN_TOKEN</code>. Enter the token to continue.</p>
    ${message}
    <form method="post" action="/admin/login">
      <label>Admin token
        <input name="adminToken" type="password" autocomplete="current-password" required>
      </label>
      <button type="submit">Open Admin</button>
    </form>
  </main>
</body>
</html>`;
}

function isValidBucket(input: unknown): input is HubBucketInput {
  if (typeof input !== "object" || input === null) return false;
  const candidate = input as Record<string, unknown>;
  const requiredNumber = [
    "bucketStart",
    "bucketEnd",
    "requestCount",
    "inputTokens",
    "outputTokens",
    "reasoningTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "totalCost",
  ];
  for (const key of requiredNumber) {
    if (typeof candidate[key] !== "number" || !Number.isFinite(candidate[key] as number)) return false;
  }
  const requiredString = ["anonProjectId", "providerId", "modelId"];
  for (const key of requiredString) {
    if (typeof candidate[key] !== "string" || (candidate[key] as string).trim().length === 0) return false;
  }
  if (candidate.avgOutputTps !== null && candidate.avgOutputTps !== undefined && typeof candidate.avgOutputTps !== "number") {
    return false;
  }
  if (candidate.minOutputTps !== null && candidate.minOutputTps !== undefined && typeof candidate.minOutputTps !== "number") {
    return false;
  }
  if (candidate.maxOutputTps !== null && candidate.maxOutputTps !== undefined && typeof candidate.maxOutputTps !== "number") {
    return false;
  }
  return true;
}

function isValidIngestPayload(input: unknown): input is IngestPayload {
  if (typeof input !== "object" || input === null) return false;
  const candidate = input as Record<string, unknown>;
  if (typeof candidate.schemaVersion !== "number") return false;
  if (typeof candidate.deviceId !== "string" || candidate.deviceId.trim().length === 0) return false;
  if (!Array.isArray(candidate.buckets)) return false;
  return candidate.buckets.every(isValidBucket);
}

function signatureFor(payload: string, timestamp: string, nonce: string, signingKey: string): string {
  return createHmac("sha256", signingKey).update(`${timestamp}.${nonce}.${payload}`).digest("hex");
}

function secureEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function parseSignedBody(req: Request): Promise<{ raw: string; payload: IngestPayload } | Response> {
  let rawBody = "";
  try {
    rawBody = await req.text();
  } catch {
    return err(400, "Unable to read request body");
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return err(400, "Invalid JSON body");
  }

  if (!isValidIngestPayload(body)) {
    return err(400, "Invalid ingest payload schema");
  }

  return { raw: rawBody, payload: body };
}

async function parseJsonBody(req: Request): Promise<unknown | Response> {
  try {
    return await req.json();
  } catch {
    return err(400, "Invalid JSON body");
  }
}

function isRegisterPayload(input: unknown): input is RegisterPayload {
  if (typeof input !== "object" || input === null) return false;
  const candidate = input as Record<string, unknown>;
  if (typeof candidate.inviteToken !== "string" || candidate.inviteToken.trim().length === 0) return false;
  if (candidate.deviceId !== undefined && typeof candidate.deviceId !== "string") return false;
  if (candidate.anonUserId !== undefined && typeof candidate.anonUserId !== "string") return false;
  if (candidate.label !== undefined && typeof candidate.label !== "string") return false;
  return true;
}

function isBootstrapPayload(input: unknown): input is BootstrapPayload {
  if (typeof input !== "object" || input === null) return false;
  const candidate = input as Record<string, unknown>;
  if (candidate.deviceId !== undefined && typeof candidate.deviceId !== "string") return false;
  if (candidate.anonUserId !== undefined && typeof candidate.anonUserId !== "string") return false;
  if (candidate.label !== undefined && typeof candidate.label !== "string") return false;
  return true;
}

function isRevokePayload(input: unknown): input is RevokePayload {
  if (typeof input !== "object" || input === null) return false;
  const candidate = input as Record<string, unknown>;
  return typeof candidate.deviceId === "string" && candidate.deviceId.trim().length > 0;
}

function isBulkDevicePayload(input: unknown): input is BulkDevicePayload {
  if (typeof input !== "object" || input === null) return false;
  const candidate = input as Record<string, unknown>;
  if (candidate.action !== "revoke" && candidate.action !== "activate") return false;
  if (!Array.isArray(candidate.deviceIds)) return false;
  return candidate.deviceIds.every(item => typeof item === "string");
}

function randomDeviceId(): string {
  return `dev_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function readAdminToken(req: Request): string {
  const fromHeader = req.headers.get("X-TS-Admin-Token")?.trim();
  if (fromHeader) return fromHeader;
  const auth = req.headers.get("Authorization")?.trim();
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const cookieHeader = req.headers.get("Cookie") ?? "";
  const cookies = cookieHeader.split(";");
  for (const entry of cookies) {
    const part = entry.trim();
    if (!part) continue;
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    if (key !== "ts_hub_admin_token") continue;
    const raw = part.slice(idx + 1).trim();
    if (!raw) continue;
    try {
      const decoded = decodeURIComponent(raw);
      if (decoded) return decoded;
    } catch {
      return raw;
    }
  }
  return "";
}

function clientAddress(req: Request): string {
  const forwarded = req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  const realIp = req.headers.get("CF-Connecting-IP")?.trim();
  if (realIp) return realIp;
  return "unknown";
}

function isSecureRequest(req: Request): boolean {
  const forwardedProto = req.headers.get("X-Forwarded-Proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwardedProto === "https") return true;
  try {
    const url = new URL(req.url);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function adminTokenCookie(token: string, secure: boolean): string {
  const secureFlag = secure ? "; Secure" : "";
  return `ts_hub_admin_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${secureFlag}`;
}

function clearAdminTokenCookie(secure: boolean): string {
  const secureFlag = secure ? "; Secure" : "";
  return `ts_hub_admin_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureFlag}`;
}

function auditLog(action: string, fields: Record<string, string | number | boolean | null>): void {
  const payload = {
    ...fields,
    action,
    at: Math.floor(Date.now() / 1000),
  };
  console.info(`[tokenspeed-hub] ${JSON.stringify(payload)}`);
}

export function startHubServer(requestedPort?: number, options: HubServerOptions = {}): HubServerHandle {
  const db = options.db ?? openHubDatabase();
  const signingKey = options.signingKey ?? process.env.TS_HUB_SIGNING_KEY?.trim() ?? "";
  const inviteToken = options.inviteToken ?? process.env.TS_HUB_INVITE_TOKEN?.trim() ?? "";
  const adminToken = options.adminToken ?? process.env.TS_HUB_ADMIN_TOKEN?.trim() ?? "";
  const adminLoginWindowSeconds =
    options.adminLoginWindowSeconds ??
    parsePositiveInt(
      process.env.TS_HUB_ADMIN_LOGIN_WINDOW_SEC,
      DEFAULT_ADMIN_LOGIN_WINDOW_SECONDS,
      10,
      3600,
    );
  const adminLoginMaxAttempts =
    options.adminLoginMaxAttempts ??
    parsePositiveInt(
      process.env.TS_HUB_ADMIN_LOGIN_MAX_ATTEMPTS,
      DEFAULT_ADMIN_LOGIN_MAX_ATTEMPTS,
      1,
      100,
    );
  const allowedDevices = options.allowedDevices ?? null;
  const enforceRegisteredDevices = inviteToken.length > 0;
  const adminLoginAttempts = new Map<string, { count: number; resetAt: number }>();

  if (!signingKey && !inviteToken) {
    throw new Error("TS_HUB_SIGNING_KEY or TS_HUB_INVITE_TOKEN is required");
  }

  const serve = (port: number) =>
    Bun.serve({
      port,
      routes: {
        "/": req => {
          if (req.method === "OPTIONS") return preflight();
          if (req.method !== "GET") return err(405, "Method Not Allowed");
          return withCors(
            new Response(hubDashboardHtml(), {
              headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store",
              },
            }),
          );
        },
        "/assets/tokenspeed-logo.webp": req => {
          if (req.method === "OPTIONS") return preflight();
          if (req.method !== "GET") return err(405, "Method Not Allowed");
          const logo = getTokenSpeedLogoWebp();
          if (!logo) return err(404, "Logo not found");
          return withCors(
            new Response(logo, {
              headers: {
                "Content-Type": "image/webp",
                "Cache-Control": "public, max-age=86400",
              },
            }),
          );
        },
        "/dashboard": req => {
          if (req.method === "OPTIONS") return preflight();
          if (req.method !== "GET") return err(405, "Method Not Allowed");
          return withCors(
            new Response(hubDashboardHtml(), {
              headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store",
              },
            }),
          );
        },
        "/admin": req => {
          if (req.method === "OPTIONS") return preflight();
          if (req.method !== "GET") return err(405, "Method Not Allowed");
          if (!adminToken) return err(503, "Admin token is not configured on hub");
          const supplied = readAdminToken(req);
          if (!supplied || supplied !== adminToken) {
            return withCors(
              new Response(hubAdminLoginHtml(), {
                status: 401,
                headers: {
                  "Content-Type": "text/html; charset=utf-8",
                  "Cache-Control": "no-store",
                },
              }),
            );
          }
          return withCors(
            new Response(hubAdminHtml(), {
              headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store",
              },
            }),
          );
        },
        "/admin/login": async req => {
          if (req.method === "OPTIONS") return preflight();
          if (req.method !== "POST") return err(405, "Method Not Allowed");
          if (!adminToken) return err(503, "Admin token is not configured on hub");

          const now = Math.floor(Date.now() / 1000);
          const source = clientAddress(req);
          const rateEntry = adminLoginAttempts.get(source);
          if (rateEntry && rateEntry.resetAt > now && rateEntry.count >= adminLoginMaxAttempts) {
            auditLog("admin_login_rate_limited", {
              source,
              attempts: rateEntry.count,
              windowSeconds: adminLoginWindowSeconds,
            });
            return withCors(
              new Response(hubAdminLoginHtml("Too many login attempts. Try again later."), {
                status: 429,
                headers: {
                  "Content-Type": "text/html; charset=utf-8",
                  "Cache-Control": "no-store",
                },
              }),
            );
          }

          let bodyRaw = "";
          try {
            bodyRaw = await req.text();
          } catch {
            return err(400, "Unable to read request body");
          }

          const params = new URLSearchParams(bodyRaw);
          const supplied = params.get("adminToken")?.trim() ?? "";
          if (!supplied || supplied !== adminToken) {
            const nextCount = rateEntry && rateEntry.resetAt > now ? rateEntry.count + 1 : 1;
            adminLoginAttempts.set(source, {
              count: nextCount,
              resetAt: now + adminLoginWindowSeconds,
            });
            auditLog("admin_login_failed", {
              source,
              attempts: nextCount,
              windowSeconds: adminLoginWindowSeconds,
            });
            return withCors(
              new Response(hubAdminLoginHtml("Invalid admin token"), {
                status: 403,
                headers: {
                  "Content-Type": "text/html; charset=utf-8",
                  "Cache-Control": "no-store",
                },
              }),
            );
          }

          adminLoginAttempts.delete(source);
          auditLog("admin_login_success", {
            source,
          });

          return withCors(
            new Response(null, {
              status: 303,
              headers: {
                Location: "/admin",
                "Set-Cookie": adminTokenCookie(supplied, isSecureRequest(req)),
                "Cache-Control": "no-store",
              },
            }),
          );
        },
        "/admin/logout": req => {
          if (req.method === "OPTIONS") return preflight();
          if (req.method !== "POST") return err(405, "Method Not Allowed");
          auditLog("admin_logout", {
            source: clientAddress(req),
          });
          return withCors(
            new Response(null, {
              status: 303,
              headers: {
                Location: "/admin",
                "Set-Cookie": clearAdminTokenCookie(isSecureRequest(req)),
                "Cache-Control": "no-store",
              },
            }),
          );
        },
        "/v1/health": req => {
          if (req.method === "OPTIONS") return preflight();
          if (req.method !== "GET") return err(405, "Method Not Allowed");
          return json({
            ok: true,
            now: Math.floor(Date.now() / 1000),
            service: "tokenspeed-hub",
          });
        },
        "/v1/ingest/buckets": async req => {
          if (req.method === "OPTIONS") return preflight();
          if (req.method !== "POST") return err(405, "Method Not Allowed");

          const headerDevice = req.headers.get("X-TS-Device-ID")?.trim() ?? "";
          const timestamp = req.headers.get("X-TS-Timestamp")?.trim() ?? "";
          const nonce = req.headers.get("X-TS-Nonce")?.trim() ?? "";
          const signature = req.headers.get("X-TS-Signature")?.trim() ?? "";

          if (!headerDevice || !timestamp || !nonce || !signature) {
            return err(401, "Missing auth headers");
          }

          if (allowedDevices && !allowedDevices.has(headerDevice)) {
            return err(403, "Device not allowed");
          }

          const deviceRecord = getHubDevice(db, headerDevice);
          if (enforceRegisteredDevices && !deviceRecord) {
            return err(403, "Device not registered");
          }
          if (deviceRecord && deviceRecord.status !== "active") {
            return err(403, "Device revoked");
          }

          const parsedTimestamp = Number(timestamp);
          if (!Number.isFinite(parsedTimestamp)) return err(401, "Invalid timestamp");
          const now = Math.floor(Date.now() / 1000);
          if (Math.abs(now - parsedTimestamp) > TIMESTAMP_WINDOW_SECONDS) {
            return err(401, "Timestamp outside allowed window");
          }

          cleanupExpiredNonces(db, now);
          if (isNonceUsed(db, headerDevice, nonce)) {
            return err(401, "Nonce already used");
          }

          const parsed = await parseSignedBody(req);
          if (parsed instanceof Response) return parsed;

          if (parsed.payload.deviceId !== headerDevice) {
            return err(401, "Device ID mismatch");
          }

          const expected = signatureFor(parsed.raw, timestamp, nonce, deviceRecord?.signingKey ?? signingKey);
          if (!secureEqualHex(expected, signature)) {
            return err(401, "Invalid signature");
          }

          storeNonce(db, headerDevice, nonce, now + TIMESTAMP_WINDOW_SECONDS * 2);
          upsertHubBuckets(db, headerDevice, parsed.payload.buckets);
          touchHubDeviceSeen(db, headerDevice, now);

          return json({
            accepted: parsed.payload.buckets.length,
            duplicates: 0,
            rejected: 0,
            serverTime: now,
          });
        },
        "/v1/devices/register": async req => {
          if (req.method === "OPTIONS") return preflight();
          if (req.method !== "POST") return err(405, "Method Not Allowed");
          if (!inviteToken) return err(503, "Invite token is not configured on hub");

          const parsedBody = await parseJsonBody(req);
          if (parsedBody instanceof Response) return parsedBody;
          if (!isRegisterPayload(parsedBody)) return err(400, "Invalid register payload");
          if (parsedBody.inviteToken !== inviteToken) return err(403, "Invalid invite token");

          const deviceId = parsedBody.deviceId?.trim() || randomDeviceId();
          const anonUserId = parsedBody.anonUserId?.trim() || deviceId;
          const label = parsedBody.label?.trim() || null;
          const device = registerHubDevice(db, deviceId, label, anonUserId);

          return json({
            deviceId: device.deviceId,
            anonUserId: device.anonUserId,
            signingKey: device.signingKey,
            status: device.status,
          });
        },
        "/v1/devices/bootstrap": async req => {
          if (req.method === "OPTIONS") return preflight();
          if (req.method !== "POST") return err(405, "Method Not Allowed");

          const parsedBody = await parseJsonBody(req);
          if (parsedBody instanceof Response) return parsedBody;
          if (!isBootstrapPayload(parsedBody)) return err(400, "Invalid bootstrap payload");

          const deviceId = parsedBody.deviceId?.trim() || randomDeviceId();
          const anonUserId = parsedBody.anonUserId?.trim() || deviceId;
          const label = parsedBody.label?.trim() || null;
          const device = registerHubDevice(db, deviceId, label, anonUserId);

          return json({
            deviceId: device.deviceId,
            anonUserId: device.anonUserId,
            signingKey: device.signingKey,
            status: device.status,
          });
        },
        "/v1/devices": req => {
          if (req.method === "OPTIONS") return preflight();
          if (req.method !== "GET") return err(405, "Method Not Allowed");
          if (!adminToken) return err(503, "Admin token is not configured on hub");
          const supplied = readAdminToken(req);
          if (!supplied || supplied !== adminToken) return err(403, "Invalid admin token");

          const url = new URL(req.url);
          const { limit } = parseRange(url);
          const statusParam = url.searchParams.get("status")?.trim();
          const status = statusParam === "active" || statusParam === "revoked" ? statusParam : undefined;
          const deviceId = url.searchParams.get("deviceId")?.trim() || undefined;
          const anonUserId = url.searchParams.get("anonUserId")?.trim() || undefined;
          return json(
            listHubDevices(db, limit, { status, deviceId, anonUserId }).map(device => ({
              deviceId: device.deviceId,
              anonUserId: device.anonUserId,
              label: device.label,
              status: device.status,
              createdAt: device.createdAt,
              updatedAt: device.updatedAt,
              lastSeen: device.lastSeen,
              revokedAt: device.revokedAt,
            })),
          );
        },
        "/v1/devices/revoke": async req => {
          if (req.method === "OPTIONS") return preflight();
          if (req.method !== "POST") return err(405, "Method Not Allowed");
          if (!adminToken) return err(503, "Admin token is not configured on hub");
          const supplied = readAdminToken(req);
          if (!supplied || supplied !== adminToken) return err(403, "Invalid admin token");

          const parsedBody = await parseJsonBody(req);
          if (parsedBody instanceof Response) return parsedBody;
          if (!isRevokePayload(parsedBody)) return err(400, "Invalid revoke payload");

          const deviceId = parsedBody.deviceId.trim();
          const ok = revokeHubDevice(db, deviceId);
          if (!ok) return err(404, "Device not found");
          auditLog("device_revoke", {
            source: clientAddress(req),
            deviceId,
          });
          return json({ ok: true, deviceId });
        },
        "/v1/devices/activate": async req => {
          if (req.method === "OPTIONS") return preflight();
          if (req.method !== "POST") return err(405, "Method Not Allowed");
          if (!adminToken) return err(503, "Admin token is not configured on hub");
          const supplied = readAdminToken(req);
          if (!supplied || supplied !== adminToken) return err(403, "Invalid admin token");

          const parsedBody = await parseJsonBody(req);
          if (parsedBody instanceof Response) return parsedBody;
          if (!isRevokePayload(parsedBody)) return err(400, "Invalid activate payload");

          const deviceId = parsedBody.deviceId.trim();
          const ok = activateHubDevice(db, deviceId);
          if (!ok) return err(404, "Device not found");
          auditLog("device_activate", {
            source: clientAddress(req),
            deviceId,
          });
          return json({ ok: true, deviceId });
        },
        "/v1/devices/bulk": async req => {
          if (req.method === "OPTIONS") return preflight();
          if (req.method !== "POST") return err(405, "Method Not Allowed");
          if (!adminToken) return err(503, "Admin token is not configured on hub");
          const supplied = readAdminToken(req);
          if (!supplied || supplied !== adminToken) return err(403, "Invalid admin token");

          const parsedBody = await parseJsonBody(req);
          if (parsedBody instanceof Response) return parsedBody;
          if (!isBulkDevicePayload(parsedBody)) return err(400, "Invalid bulk payload");

          const result = bulkSetHubDevicesStatus(
            db,
            parsedBody.deviceIds,
            parsedBody.action === "revoke" ? "revoked" : "active",
          );

          auditLog("device_bulk_status", {
            source: clientAddress(req),
            action: parsedBody.action,
            requested: parsedBody.deviceIds.length,
            updated: result.updated.length,
            missing: result.missing.length,
          });

          return json({
            ok: true,
            action: parsedBody.action,
            updated: result.updated,
            missing: result.missing,
          });
        },
        "/v1/dashboard/summary": req => {
          if (req.method === "OPTIONS") return preflight();
          if (req.method !== "GET") return err(405, "Method Not Allowed");
          const url = new URL(req.url);
          const range = parseRange(url);
          const filters = parseDashboardFilters(url);
          return json(getHubSummary(db, range.from, range.to, filters));
        },
        "/v1/dashboard/models": req => {
          if (req.method === "OPTIONS") return preflight();
          if (req.method !== "GET") return err(405, "Method Not Allowed");
          const url = new URL(req.url);
          const range = parseRange(url);
          const filters = parseDashboardFilters(url);
          return json(getHubModels(db, range.from, range.to, range.limit, filters));
        },
        "/v1/dashboard/providers": req => {
          if (req.method === "OPTIONS") return preflight();
          if (req.method !== "GET") return err(405, "Method Not Allowed");
          const url = new URL(req.url);
          const range = parseRange(url);
          const filters = parseDashboardFilters(url);
          return json(getHubProviders(db, range.from, range.to, range.limit, filters));
        },
        "/v1/dashboard/projects": req => {
          if (req.method === "OPTIONS") return preflight();
          if (req.method !== "GET") return err(405, "Method Not Allowed");
          const url = new URL(req.url);
          const range = parseRange(url);
          const filters = parseDashboardFilters(url);
          return json(getHubProjects(db, range.from, range.to, range.limit, filters));
        },
        "/v1/dashboard/timeseries": req => {
          if (req.method === "OPTIONS") return preflight();
          if (req.method !== "GET") return err(405, "Method Not Allowed");
          const url = new URL(req.url);
          const range = parseRange(url);
          const metric = parseMetric(url);
          const groupBy = parseGroupBy(url);
          const filters = parseDashboardFilters(url);
          return json(getHubTimeseries(db, metric, groupBy, range.from, range.to, range.limit, filters));
        },
        "/v1/dashboard/export.csv": req => {
          if (req.method === "OPTIONS") return preflight();
          if (req.method !== "GET") return err(405, "Method Not Allowed");
          const url = new URL(req.url);
          const csv = buildDashboardExportCsv(db, url);
          return withCors(
            new Response(csv, {
              headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": "attachment; filename=hub-dashboard-export.csv",
                "Cache-Control": "no-store",
              },
            }),
          );
        },
        "/v1/dashboard/export.json": req => {
          if (req.method === "OPTIONS") return preflight();
          if (req.method !== "GET") return err(405, "Method Not Allowed");
          const url = new URL(req.url);
          const payload = buildDashboardExportJson(db, url);
          return json(payload);
        },
      },
      fetch: () => err(404, "Not Found"),
    });

  const startPort = requestedPort ?? parsePort(process.env.TS_HUB_PORT);
  let server: Bun.Server<unknown>;
  try {
    server = serve(startPort);
  } catch {
    server = serve(0);
  }

  return {
    port: server.port ?? startPort,
    url: server.url.toString(),
    async stop() {
      await server.stop(true);
      if (!options.db) db.close();
    },
  };
}

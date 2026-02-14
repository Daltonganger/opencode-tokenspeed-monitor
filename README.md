# OpenCode TokenSpeed Monitor

TokenSpeed Monitor is an OpenCode plugin that measures token speed per request, stores metrics in SQLite, and exposes data over an HTTP API.

## Features

- Tracks token usage from OpenCode events (`message.updated`, `message.part.updated`, `session.idle`)
- Calculates output TPS and total TPS per completed request
- Persists request/session/model data in local SQLite
- Exposes REST + SSE endpoints for stats and live stream
- Adds in-app commands for status, history, stats, and background mode

## Commands

- `/ts` - toggle monitor on/off
- `/ts-status` - show current status and latest metric
- `/ts-stats` - show aggregated totals and model summary
- `/ts-history` - show recent request history (supports limit)
- `/ts-bg` - start/stop background API mode

## API Endpoints

When background mode is ON (`/ts-bg`), the plugin serves:

- `GET /api/stats`
- `GET /api/stats/models`
- `GET /api/history?limit=10`
- `GET /api/sessions?limit=10`
- `GET /api/live` (SSE stream)

## Installation

1) Build the plugin:

```bash
bun install
bun run build
```

2) Add plugin path to your OpenCode config (`~/.config/opencode/opencode.json`):

```json
{
  "plugin": [
    "/Users/rubenbeuker/.config/opencode/opencode-tokenspeed-monitor"
  ]
}
```

3) Restart OpenCode.

## Configuration

- `TS_BG_PORT` (optional): background API port for `/ts-bg` (default: `3456`)

Example:

```bash
TS_BG_PORT=4567 opencode
```

## Usage

In OpenCode:

```text
/ts
/ts-status
/ts-stats
/ts-history
/ts-bg
```

In terminal (while `/ts-bg` is ON):

```bash
PORT=${TS_BG_PORT:-3456}
curl "http://localhost:${PORT}/api/stats"
curl "http://localhost:${PORT}/api/stats/models"
curl "http://localhost:${PORT}/api/history?limit=10"
curl "http://localhost:${PORT}/api/sessions?limit=10"
curl -N --max-time 8 "http://localhost:${PORT}/api/live"
```

## Development

```bash
bun test
bun run build
```

## Notes

- Database files are written under `data/`.
- `.gitignore` excludes SQLite runtime files and build output.

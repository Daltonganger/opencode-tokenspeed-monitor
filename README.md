# OpenCode TokenSpeed Monitor

TokenSpeed Monitor is an OpenCode plugin that measures token speed per request, stores metrics in SQLite, and exposes data over local and hub HTTP APIs.

- npm: https://www.npmjs.com/package/opencode-tokenspeed-monitor
- GitHub: https://github.com/Daltonganger/opencode-tokenspeed-monitor

## Features

- Tracks token usage from OpenCode events (`message.updated`, `message.part.updated`, `session.idle`)
- Calculates output TPS and total TPS per completed request
- Persists request/session/model/provider/project data in local SQLite
- Exposes local dashboard + REST + SSE endpoints
- Supports anonymous upload queue with signed ingest payloads
- Adds in-app commands for status, history, stats, and background mode

## Commands

- `/ts` - open TokenSpeed local dashboard in browser (`/`)
- `/ts-toggle` - toggle monitor on/off
- `/ts-status` - show current status and latest metric
- `/ts-stats` - show aggregated totals and model summary
- `/ts-history` - show recent request history (supports limit)
- `/ts-bg` - start/stop background API mode
- `/ts-upload` - show upload queue status and hub configuration
- `/ts-upload-flush` - trigger upload queue flush immediately

These slash commands are shipped in the plugin `commands/` directory, so they are available to users after plugin install.

## API Endpoints

When plugin background API is active, the plugin serves:

- `GET /api/stats`
- `GET /api/stats/models`
- `GET /api/stats/providers`
- `GET /api/projects`
- `GET /api/history?limit=10`
- `GET /api/sessions?limit=10`
- `GET /api/live` (SSE stream)
- `GET /api/upload/status`
- `GET /api/upload/queue?limit=20`
- `POST /api/upload/flush`

## Installation

### Option A: Install from npm (short plugin line)

After publishing to npm, add this to your OpenCode config (`~/.config/opencode/opencode.json`):

```json
{
  "plugin": [
    "opencode-tokenspeed-monitor@latest"
  ]
}
```

Then restart OpenCode.

### Option B: Install from GitHub

Add this to your OpenCode config (`~/.config/opencode/opencode.json`):

```json
{
  "plugin": [
    "github:Daltonganger/opencode-tokenspeed-monitor#v0.1.1"
  ]
}
```

Then restart OpenCode.

### Option C: Local development install

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

- `TS_BG_PORT` (optional): local dashboard/API port (default: `3456`)
- `TS_DB_PATH` (optional): explicit local SQLite database path
- `OPENCODE_HOME` (optional): OpenCode home directory; default storage under `~/.local/share/opencode/tokenspeed-monitor/`
- `TS_UPLOAD_ENABLED` (optional): enable upload dispatcher (`1/true/on`)
- `TS_HUB_URL` (optional): hub ingest base URL (example: `https://hub.example.com`)
- `TS_HUB_SIGNING_KEY` (optional): signing key used for hub request signatures
- `TS_HUB_INVITE_TOKEN` (optional): invite token used for automatic device registration
- `TS_HUB_DEVICE_ID` (optional): explicit device identifier override
- `TS_HUB_DEVICE_LABEL` (optional): device label sent during registration
- `TS_UPLOAD_INTERVAL_SEC` (optional): upload dispatcher interval in seconds (default `30`)
- `TS_UPLOAD_BUCKET_SEC` (optional): queue aggregation bucket size in seconds (default `300`)
- `TS_ANON_SALT_PATH` (optional): custom path for local anonymization salt file
- `TS_HUB_PORT` (hub server, optional): hub listen port (default `3476`)
- `TS_HUB_DB_PATH` (hub server, optional): custom hub SQLite path
- `TS_HUB_ADMIN_TOKEN` (hub server, optional): admin token for `/admin` and `/v1/devices*`
- `TS_HUB_ADMIN_LOGIN_WINDOW_SEC` (hub server, optional): failed login window in seconds (default `300`)
- `TS_HUB_ADMIN_LOGIN_MAX_ATTEMPTS` (hub server, optional): max failed login attempts per source IP in the window (default `10`)

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
/ts-upload
/ts-upload-flush
```

In terminal (while `/ts-bg` is ON):

```bash
PORT=${TS_BG_PORT:-3456}
curl "http://localhost:${PORT}/api/stats"
curl "http://localhost:${PORT}/api/stats/models"
curl "http://localhost:${PORT}/api/stats/providers"
curl "http://localhost:${PORT}/api/projects"
curl "http://localhost:${PORT}/api/history?limit=10"
curl "http://localhost:${PORT}/api/sessions?limit=10"
curl "http://localhost:${PORT}/api/upload/status"
curl "http://localhost:${PORT}/api/upload/queue?limit=20"
curl -X POST "http://localhost:${PORT}/api/upload/flush"
curl -N --max-time 8 "http://localhost:${PORT}/api/live"
```

## Development

```bash
bun test
bun run build
```

## Hub server (optional)

Start a minimal signed ingest + dashboard API hub:

```bash
TS_HUB_SIGNING_KEY="legacy-shared-key" TS_HUB_INVITE_TOKEN="register-token" TS_HUB_ADMIN_TOKEN="admin-token" bun run hub:start
```

### Docker / Dockge

This repo includes a ready Dockge stack file: `docker-compose.dockge.yml`.

1. Copy env template and set real secrets:

```bash
cp .env.dockge.example .env
```

2. In Dockge, create a stack using `docker-compose.dockge.yml`.
3. Ensure at least one of `TS_HUB_SIGNING_KEY` or `TS_HUB_INVITE_TOKEN` is set, plus `TS_HUB_ADMIN_TOKEN`.
4. Start the stack.

Local Docker CLI alternative:

```bash
docker compose -f docker-compose.dockge.yml up -d --build
```

Open dashboard in browser:

```text
http://localhost:3476/
```

Open admin page in browser:

```text
http://localhost:3476/admin
```

Note: `/admin` now requires `TS_HUB_ADMIN_TOKEN`. Open the page and submit the token in the login form, or send it via `X-TS-Admin-Token`/`Authorization: Bearer` headers for API calls.

Hub endpoints:

- `GET /v1/health`
- `POST /v1/devices/register`
- `GET /v1/devices` (admin token required)
- `POST /v1/devices/revoke` (admin token required)
- `POST /v1/devices/activate` (admin token required)
- `POST /v1/devices/bulk` (admin token required, action=`revoke|activate`)
- `POST /v1/ingest/buckets`
- `GET /v1/dashboard/summary?from=&to=&providerId=&modelId=&anonProjectId=`
- `GET /v1/dashboard/models?from=&to=&limit=&providerId=&modelId=&anonProjectId=`
- `GET /v1/dashboard/providers?from=&to=&limit=&providerId=&modelId=&anonProjectId=`
- `GET /v1/dashboard/projects?from=&to=&limit=&providerId=&modelId=&anonProjectId=`
- `GET /v1/dashboard/timeseries?metric=tokens|cost|tps&groupBy=hour|day&from=&to=&providerId=&modelId=&anonProjectId=`
- `GET /v1/dashboard/export.csv?from=&to=&providerId=&modelId=&anonProjectId=`
- `GET /v1/dashboard/export.json?from=&to=&providerId=&modelId=&anonProjectId=&groupBy=hour|day`

Deployment guide: `DEPLOYMENT-HUB.md`

Example onboarding + admin calls:

```bash
HUB=http://localhost:3476

curl -X POST "$HUB/v1/devices/register" \
  -H 'Content-Type: application/json' \
  -d '{"deviceId":"dev_local","label":"My Laptop","inviteToken":"register-token"}'

curl "$HUB/v1/devices?limit=20" \
  -H 'X-TS-Admin-Token: admin-token'

curl -X POST "$HUB/v1/devices/revoke" \
  -H 'Authorization: Bearer admin-token' \
  -H 'Content-Type: application/json' \
  -d '{"deviceId":"dev_local"}'
```

## Publish to npm

```bash
npm run release:check
npm login
npm publish --access public
```

Release checklist: `RELEASE.md`

After publish, users can use:

```json
{
  "plugin": [
    "opencode-tokenspeed-monitor@latest"
  ]
}
```

## Notes

- Local database defaults to `~/.local/share/opencode/tokenspeed-monitor/tokenspeed-monitor.sqlite`.
- Legacy `./data/tokenspeed-monitor.sqlite` is auto-migrated when possible.

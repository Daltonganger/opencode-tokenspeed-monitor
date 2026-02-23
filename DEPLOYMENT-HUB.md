# Hub Deployment Checklist

This guide is the shortest safe path to run the central TokenSpeed hub in production.

## 1) Pick a runtime

- Use a Linux VM/container with Bun installed.
- Keep the hub behind HTTPS (reverse proxy or load balancer).
- Mount persistent storage for hub SQLite (`TS_HUB_DB_PATH`).

Docker/Dockge path:

- Use `docker-compose.dockge.yml` for the stack definition.
- Use `.env.dockge.example` as the secret/env template.
- Keep `/data` volume persistent in Dockge.

## 2) Prepare environment

1. Copy `hub.env.example`.
2. Set strong random values for:
   - `TS_HUB_SIGNING_KEY` (if using shared signing mode)
   - `TS_HUB_INVITE_TOKEN` (if using registration flow)
   - `TS_HUB_ADMIN_TOKEN` (required for admin UI/API)
3. Keep `TS_HUB_DB_PATH` on persistent disk.

Minimal required env vars:

- `TS_HUB_ADMIN_TOKEN`
- One of: `TS_HUB_SIGNING_KEY` or `TS_HUB_INVITE_TOKEN`

## 3) Start hub

```bash
bun install
npm run build
bun run hub:start
```

### Automatic remote deploy to 2631US (recommended)

From your local repo:

```bash
npm run deploy:2631us
```

This uses `scripts/deploy-2631us.sh` and performs on `2631US`:

- Clone/pull repo in `/opt/stacks/tokenspeed-hub`
- Checkout/pull `main`
- `docker compose -f docker-compose.dockge.yml up -d --build`
- Health check `http://127.0.0.1:3476/v1/health`

Optional overrides:

```bash
TARGET_HOST=2631US TARGET_DIR=/opt/stacks/tokenspeed-hub BRANCH=main npm run deploy:2631us
```

## 4) Health and smoke checks

```bash
HUB=http://localhost:3476
curl "$HUB/v1/health"
curl "$HUB/v1/dashboard/summary"
curl "$HUB/admin"
```

Expected:

- `/v1/health` returns `{ "ok": true, ... }`
- `/v1/dashboard/summary` returns JSON
- `/admin` returns login page (401) until authenticated

## 5) Reverse proxy requirements

- Force HTTPS.
- Forward `X-Forwarded-Proto` so secure cookie mode works.
- Restrict direct DB/file access on host.

## 6) Backup and retention

- Backup `TS_HUB_DB_PATH` at least daily.
- Keep at least 7 days of backups.
- Validate one restore in a staging environment.

## 7) Rollout validation

- Register one test device.
- Upload one bucket.
- Verify summary/models/providers/projects endpoints.
- Verify export endpoints:
  - `/v1/dashboard/export.csv`
  - `/v1/dashboard/export.json`

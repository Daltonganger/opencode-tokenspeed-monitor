# Handleiding - OpenCode TokenSpeed Monitor

## 1. Doel

Deze plugin meet tokensnelheid per request in OpenCode en slaat metrics lokaal op in SQLite.

- npm: https://www.npmjs.com/package/opencode-tokenspeed-monitor
- GitHub: https://github.com/Daltonganger/opencode-tokenspeed-monitor

## 2. Installeren

### Optie A (kort, via npm)

Na publiceren op npm kun je dit gebruiken in `~/.config/opencode/opencode.json`:

```json
{
  "plugin": [
    "opencode-tokenspeed-monitor@latest"
  ]
}
```

Herstart OpenCode.

### Optie B (via GitHub tag)

Voeg dit toe in `~/.config/opencode/opencode.json`:

```json
{
  "plugin": [
    "github:Daltonganger/opencode-tokenspeed-monitor#v0.1.8"
  ]
}
```

Herstart OpenCode.

### Optie C (lokale development install)

In de pluginmap:

```bash
bun install
bun run build
```

Voeg daarna de plugin toe in `~/.config/opencode/opencode.json`:

```json
{
  "plugin": [
    "/absolute/path/to/opencode-tokenspeed-monitor"
  ]
}
```

Herstart OpenCode.

## 3. Commando's

- `/ts` - TokenSpeed pagina openen in browser (`/api/stats`)
- `/ts-toggle` - monitor aan/uit
- `/ts-status` - actuele status + laatste meting
- `/ts-stats` - totaaloverzicht en modelstatistieken
- `/ts-history` - recente requests
- `/ts-bg` - background API aan/uit
- `/ts-upload` - uploadstatus en hub-configuratie
- `/ts-upload-flush` - uploadqueue direct versturen

Deze slash commands worden meegeleverd via de plugin-map `commands/`, zodat ze beschikbaar zijn na installatie van de plugin.

## 4. Background API

Na `/ts-bg` kun je data ophalen via:

- `GET /api/stats`
- `GET /api/stats/models`
- `GET /api/stats/providers`
- `GET /api/projects`
- `GET /api/history?limit=10`
- `GET /api/sessions?limit=10`
- `GET /api/live` (SSE)
- `GET /api/upload/status`
- `GET /api/upload/queue?limit=20`
- `POST /api/upload/flush`

Voorbeeld:

```bash
PORT=${TS_BG_PORT:-3456}
curl "http://localhost:${PORT}/api/stats"
```

## 5. Configuratie

- `TS_BG_PORT` (optioneel): poort van de background server (default `3456`)
- `TS_DB_PATH` (optioneel): expliciet pad naar de lokale SQLite database
- `TS_UPLOAD_ENABLED` (optioneel): upload dispatcher aan/uit (`1/true/on` of `0/false/off`)
- `TS_HUB_URL` (optioneel): ingest hub URL
- `TS_UPLOAD_INTERVAL_SEC` (optioneel): upload interval in seconden
- `TS_UPLOAD_BUCKET_SEC` (optioneel): bucketgrootte in seconden

## 6. Troubleshooting

- Geen output op `/ts-status`: stuur eerst een request zodat er metrics zijn.
- Poort in gebruik bij `/ts-bg`: plugin wijkt uit naar een vrije poort en logt de gekozen URL.
- Build problemen: run `bun install` opnieuw en daarna `bun run build`.
- Lint of format issues: run `bun run lint:fix` of `bun run format`.

## 7. Ontwikkeling en kwaliteit

```bash
bun run lint
bun run format
bun run test
bun run build
```

- GitHub Actions controleert lint, tests en build op pushes en pull requests.
- Dependabot controleert wekelijks Bun dependencies en GitHub Actions updates.

## 8. Publiceren op npm

```bash
npm run release:check
npm login
npm publish --access public
```

Push daarnaast de bijpassende git tag als je GitHub-installatie via release tags actueel wilt houden.

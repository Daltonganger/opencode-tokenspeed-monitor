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
    "github:Daltonganger/opencode-tokenspeed-monitor#v0.1.1"
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
    "/Users/rubenbeuker/.config/opencode/opencode-tokenspeed-monitor"
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

## 4. Background API

Na `/ts-bg` kun je data ophalen via:

- `GET /api/stats`
- `GET /api/stats/models`
- `GET /api/history?limit=10`
- `GET /api/sessions?limit=10`
- `GET /api/live` (SSE)

Voorbeeld:

```bash
PORT=${TS_BG_PORT:-3456}
curl "http://localhost:${PORT}/api/stats"
```

## 5. Configuratie

- `TS_BG_PORT` (optioneel): poort van de background server (default `3456`)

## 6. Troubleshooting

- Geen output op `/ts-status`: stuur eerst een request zodat er metrics zijn.
- Poort in gebruik bij `/ts-bg`: plugin wijkt uit naar een vrije poort en logt de gekozen URL.
- Build problemen: run `bun install` opnieuw en daarna `bun run build`.

## 7. Publiceren op npm

```bash
npm login
npm publish --access public
```

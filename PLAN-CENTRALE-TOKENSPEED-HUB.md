# Masterplan - Centrale en Anonieme TokenSpeed Hub

## 1) Samenvatting

Dit plan beschrijft hoe `opencode-tokenspeed-monitor` wordt uitgebreid van lokale project-metrics naar een centrale, anonieme multi-project hub met webdashboard.

Belangrijkste doelen:

1. Alle projecten zichtbaar in 1 overzicht (niet per repo apart).
2. Geen vervuiling meer van repo mappen met lokale `data/` artifacts.
3. Data uploaden naar een centrale site op een privacy-first manier.
4. Dashboard op webniveau voor modelvergelijking, trends en live inzicht.
5. Werken op macOS, Linux en Windows met de OpenCode-map als standaardlocatie.

## 2) Probleemdefinitie (huidige situatie)

Huidige plugin gedrag:

- Database staat standaard op relatieve pad: `./data/tokenspeed-monitor.sqlite`.
- Daardoor krijgt elke projectmap een lokale datafolder.
- Dit veroorzaakt ongewenste git-ruis (ondanks ignore-regels) en operationele versnippering.
- Je ziet alleen metrics van de huidige map in plaats van over al je projecten heen.
- `/ts` opent nu vooral API-output in plaats van een volwaardig dashboard.

Gevolg: slecht overzicht, slechte schaalbaarheid, veel handwerk.

## 3) Scope en uitgangspunten

### In scope

- Centrale lokale opslag in OpenCode home/data map per OS.
- Multi-project model in de lokale datastore.
- Anonieme upload pipeline naar een centrale hub.
- Centrale ingest API met toegang op basis van device auth.
- Dashboard dat project-overstijgende statistieken toont.
- Gefaseerde rollout met migratiepad en rollback-opties.

### Out of scope (voor eerste releasegolven)

- Realtime bidirectionele sync van ruwe events.
- Team-level RBAC met meerdere admins.
- Billingfacturen of geavanceerde kostenallocatie per gebruiker.

### Designprincipes

- Privacy first: nooit projectnamen of paden in plain text uploaden.
- Fail-safe: lokale opslag blijft bron van waarheid als internet wegvalt.
- Idempotent ingest: dubbele uploads mogen geen dubbele tellingen geven.
- Simpel te beheren: minimale configuratie, heldere defaults.
- Cross-platform consistentie: zelfde gedrag op alle OSen.

## 4) Doelarchitectuur (hoog niveau)

Architectuur bestaat uit 3 lagen:

1. **Plugin lokaal (collector + local website + local API + queue)**
   - Vangt OpenCode events op.
   - Serveert een lokale website (`/`) met detailinzichten.
   - Biedt een uitleesbare lokale API voor andere projecten/sites.
   - Schrijft lokaal naar centrale SQLite.
   - Maakt geaggregeerde anonieme upload-jobs in een outbox queue.
   - Blijft tools ondersteunen.

2. **Centrale ingest/backend (jouw private hub)**
   - Ontvangt gesigneerde, anonieme payloads.
   - Valideert auth, nonce, timestamp, signature.
   - Slaat geaggregeerde records op in hub datastore.

3. **Centrale site/dashboard**
   - Frontend (liefst via GitHub Pages) voor visualisatie.
   - Leest data via backend API.
   - Laat aggregaties/filtering zien over projecten en modellen.

## 5) Lokale opslagstandaard: OpenCode-map per OS

Doel: nooit meer standaard `./data` in projectroot.

### Resolutiestrategie databestand

Volgorde:

1. `TS_DB_PATH` (expliciet override, hoogste prioriteit).
2. `OPENCODE_HOME` (als beschikbaar) + `tokenspeed-monitor/`.
3. OS-default OpenCode data map.

### Aanbevolen paden

- **macOS**: `~/.local/share/opencode/tokenspeed-monitor/tokenspeed-monitor.sqlite`
- **Linux**:
  - als `XDG_DATA_HOME` gezet: `$XDG_DATA_HOME/opencode/tokenspeed-monitor/tokenspeed-monitor.sqlite`
  - anders: `~/.local/share/opencode/tokenspeed-monitor/tokenspeed-monitor.sqlite`
- **Windows**: `%USERPROFILE%\\.local\\share\\opencode\\tokenspeed-monitor\\tokenspeed-monitor.sqlite`

Noot:

- `~/.config/opencode/` blijft de standaard voor config/plugins.
- `~/.local/share/opencode/` is de opslagmap voor data/logs/sessie-opslag.
- `~/Library/Application Support/...` hoort bij desktop app state, niet bij de standaard CLI storage map.

### Aanvullende lokale bestanden

- `outbox.sqlite` of outbox-tabellen in dezelfde DB voor upload queue.
- Eventueel `state.json` voor device metadata en sync offset.

### Git hygiene

- `data/` volledig negeren als fallback safety-net.
- Runtime bestanden nooit meer in projectmap laten landen tenzij gebruiker expliciet override doet.

## 6) Datamodel v2 (lokaal)

Nieuwe tabellen/kolommen om multi-project en upload te ondersteunen.

### 6.1 Tabel `projects`

Voorstel kolommen:

- `id` (TEXT PK, stable hash)
- `name` (TEXT, lokaal zichtbaar, niet uploaden)
- `root_path` (TEXT, lokaal zichtbaar, niet uploaden)
- `anon_project_id` (TEXT, HMAC output voor upload)
- `created_at` (INTEGER)
- `last_seen` (INTEGER)

### 6.2 Uitbreiding `requests`

- `project_id` (TEXT FK -> projects.id)
- `provider_id` (TEXT, opnemen in aggregatiesleutel naast model)
- index op `(project_id, started_at)`
- index op `(provider_id, model_id, started_at)`

### 6.3 Uitbreiding `sessions`

- `project_id` (TEXT FK -> projects.id)
- index op `(project_id, last_activity)`

### 6.4 Tabel `upload_queue`

Doel: betrouwbare offline-first sync.

Kolommen:

- `id` (TEXT PK)
- `bucket_start` (INTEGER)
- `bucket_end` (INTEGER)
- `payload_json` (TEXT)
- `payload_hash` (TEXT)
- `status` (TEXT: pending/sent/failed/dead)
- `attempt_count` (INTEGER)
- `next_attempt_at` (INTEGER)
- `last_error` (TEXT)
- `created_at` (INTEGER)
- `sent_at` (INTEGER)

### 6.5 Tabel `device_identity`

- `device_id` (TEXT)
- `hub_id` (TEXT)
- `public_key` (TEXT)
- `secret_ref` (TEXT of encrypted secret blob)
- `created_at` (INTEGER)
- `rotated_at` (INTEGER)

## 7) Anonimisering en privacyontwerp

## 7.1 Wat wel geupload wordt

Alleen aggregaties per tijd-bucket, bijvoorbeeld per 5 minuten:

- gehashte project-id (`anon_project_id`)
- provider-id
- model-id
- token totalen (input/output/reasoning/cache)
- kosten totalen
- request count
- tps statistieken (avg/min/max/p50/p95)
- tijdvenster (`bucket_start`, `bucket_end`)

## 7.2 Wat niet geupload wordt

- absolute paden
- projectnaam
- message id/session id in ruwe vorm
- prompt/response inhoud
- user identifier in plain text

## 7.3 Hashingstrategie

- Gebruik `anon_project_id = HMAC_SHA256(local_salt, canonical_project_root)`.
- `local_salt` wordt per device gegenereerd en lokaal opgeslagen.
- Hierdoor is correlatie met echte projectnamen voor derden praktisch onmogelijk.

## 7.4 K-anonimiteit drempel (optioneel)

- Niet uploaden als bucket minder dan `k` requests heeft (bijv. `< 3`).
- Vermindert herleidbaarheid in kleine datasets.

## 8) Centrale upload pipeline

## 8.1 Producer

Bij afronding van request:

1. Schrijf raw metrics lokaal weg.
2. Update bucket-aggregaties.
3. Maak of update queue-item voor die bucket.

## 8.2 Dispatcher

- Draait periodiek (bijv. elke 15-60 sec) of op idle event.
- Pakt `pending` queue-items met `next_attempt_at <= now`.
- Post naar ingest endpoint met signature headers.
- Bij succes: markeer `sent`.
- Bij fout: exponential backoff + jitter.

## 8.3 Idempotentie

- Payload bevat `payload_hash` + `device_id` + `bucket_start/end`.
- Hub behandelt dubbele payloads als upsert.

## 8.4 Fouttolerantie

- Internet weg: queue groeit, niets gaat verloren.
- Hub down: retries met backoff, geen crash van plugin.
- Te veel failures: markeer `dead` en toon waarschuwing in status tool.

## 9) Hub auth en toegangsbeveiliging

Doel: niet elke willekeurige TokenSpeed-client mag naar jouw hub uploaden.

### 9.1 Device onboarding

1. Jij genereert invite token in hub admin.
2. Plugin voert eenmalige register call uit met invite token.
3. Hub geeft `hub_id + device credentials` terug.
4. Plugin bewaart credentials lokaal.

### 9.2 Request signing

Elke upload bevat:

- `X-TS-Device-ID`
- `X-TS-Timestamp`
- `X-TS-Nonce`
- `X-TS-Signature`

Server valideert:

- timestamp binnen venster (bijv. 5 min)
- nonce niet eerder gebruikt (replay preventie)
- signature klopt
- device is actief en niet revoked

### 9.3 Abuse controls

- Rate limiting per device en per IP.
- Payload size limieten.
- Schema validatie met strict mode.
- Device revoke + key rotation.

## 10) Centrale backend en GitHub-keuze

Je voorkeur is "liefst GitHub". Slimme invulling:

### Aanbevolen model

- **Frontend op GitHub Pages** (publiek of private Pages).
- **Ingest/API op serverless backend** (bijv. Cloudflare Workers, Fly.io, Render).
- **Database in backend** (bijv. Postgres/Supabase/Cloudflare D1).

Reden:

- Direct schrijven vanuit plugin naar GitHub repo is ongeschikt (auth, rate-limits, conflicts, security).
- Ingest API is nodig voor signed writes, deduplicatie en validatie.
- GitHub Pages is wel uitstekend voor de statische dashboard UI.

### Alternatief (niet aanbevolen als primary)

- Upload naar GitHub Issues/Artifacts/Commits als transportlaag.
- Alleen nuttig als experiment of fallback, niet als productiepad.

## 11) API contracten (voorstel)

## 11.1 Plugin -> Hub ingest

`POST /v1/ingest/buckets`

Body voorbeeld:

```json
{
  "hubId": "hub_abc123",
  "deviceId": "dev_01",
  "schemaVersion": 1,
  "buckets": [
    {
      "bucketStart": 1739999700,
      "bucketEnd": 1739999999,
      "anonProjectId": "9f...",
      "providerId": "openai",
      "modelId": "gpt-5.3-codex",
      "requestCount": 12,
      "inputTokens": 30000,
      "outputTokens": 15000,
      "reasoningTokens": 5000,
      "cacheReadTokens": 2000,
      "cacheWriteTokens": 800,
      "totalCost": 4.21,
      "avgOutputTps": 62.4,
      "minOutputTps": 11.2,
      "maxOutputTps": 103.9,
      "p95OutputTps": 95.2
    }
  ]
}
```

Response:

```json
{
  "accepted": 1,
  "duplicates": 0,
  "rejected": 0,
  "serverTime": 1740000000
}
```

## 11.2 Dashboard read API

- `GET /v1/dashboard/summary?from=&to=`
- `GET /v1/dashboard/models?from=&to=&project=&provider=`
- `GET /v1/dashboard/providers?from=&to=&project=`
- `GET /v1/dashboard/projects?from=&to=`
- `GET /v1/dashboard/timeseries?metric=tokens|cost|tps&from=&to=&groupBy=hour|day`

## 11.3 Lokale plugin API uitbreiding

- `GET /api/projects`
- `GET /api/stats?projectId=&from=&to=`
- `GET /api/stats/models?projectId=&providerId=&from=&to=`
- `GET /api/stats/providers?projectId=&from=&to=`
- `GET /api/history?projectId=&providerId=&modelId=&limit=`
- `GET /api/live` met extra velden `projectId` en `projectName` (lokaal)

Lokale API moet expliciet geschikt zijn voor externe uitlezing (andere lokale site/project) met stabiele JSON schema's en CORS allowlist.

## 12) Dashboard functioneel ontwerp

Doel: bruikbare centrale site in plaats van losse JSON outputs.

## 12.1 Pagina-indeling

1. **Global Overview**
   - Totale requests, tokens, cost, avg tps.
   - Vergelijking huidige periode vs vorige periode.

2. **Projects**
   - Top projecten op usage/cost.
   - Trend per project.

3. **Models**
   - Model share (requests/tokens/cost) binnen provider-context.
   - Vergelijking provider -> model (bijv. openai/gpt-4.1 vs anthropic/claude-sonnet-4-5).
   - Gemiddelde en p95 output TPS.

4. **Live/Recent**
   - Binnenkomende bucket updates.
   - Recente modelactiviteit.

## 12.2 Filters

- Tijd: 24h / 7d / 30d / custom.
- Provider filter.
- Model filter.
- Project filter (op anon project id of lokaal gelabelde alias in jouw hub).

## 12.3 UX minimum

- Snel laden (<2s op gemiddelde dataset).
- Duidelijke empty states.
- Exportknop CSV.

## 13) Migratieplan vanuit huidige plugin

## 13.1 Data migratie

Bij startup:

1. Resolve nieuw centraal pad.
2. Als nieuwe DB ontbreekt en oude `./data/tokenspeed-monitor.sqlite` bestaat:
   - maak backup
   - kopieer naar centrale locatie
   - voer schema migraties uit
3. Log migratieresultaat in plugin logs.

## 13.2 Backward compatibility

- Oude env vars blijven werken.
- Bestaande tools blijven bestaan (`/ts`, `/ts-status`, `/ts-stats`, `/ts-history`, `/ts-bg`).
- `/ts` gaat dashboard openen (lokale of centrale URL afhankelijk van mode).

## 13.3 Gefaseerde migratie van upload

- Eerst alleen queue bouwen en lokaal vullen.
- Daarna ingest activeren met feature flag.
- Daarna dashboard op centrale data.

## 14) Configuratievoorstel

Nieuwe env/config keys:

- `TS_DB_PATH` - optionele expliciete DB locatie.
- `TS_HUB_URL` - centrale ingest/dashboard API base URL.
- `TS_HUB_INVITE_TOKEN` - eenmalige device onboarding token.
- `TS_UPLOAD_ENABLED` - upload aan/uit.
- `TS_UPLOAD_INTERVAL_SEC` - dispatch interval.
- `TS_UPLOAD_BUCKET_SEC` - bucketgrootte (bijv. 300 sec).
- `TS_ANON_SALT_PATH` - pad voor lokale salt (optioneel override).

## 15) Uitrolplan in fases

## Fase 1 - Lokale website + lokale API (eerst)

Doelen:

- Lokale website op `/` met detailoverzichten (requests, provider, model, TPS, cost).
- Lokale API v1 met stabiele contracten voor externe uitlezing.
- `/ts` opent lokale website in plaats van ruwe JSON output.

Acceptatie:

- Lokale detailwebsite is bruikbaar zonder centrale hub.
- Tweede lokaal project/site kan metrics via API uitlezen.

## Fase 2 - Lokale fundering

Doelen:

- OpenCode-map resolutie op alle OSen.
- DB migratie van project `data/` naar centrale locatie.
- `projects` + `project_id` in lokaal schema.

Acceptatie:

- Geen nieuwe runtime DB in projectroot bij default config.
- Metrics van meerdere projectmappen landen in 1 centrale DB.

## Fase 3 - Upload queue + anon layer

Doelen:

- Aggregatie per bucket.
- Queue tabellen + retry mechaniek.
- HMAC anon project id.

Acceptatie:

- Offline use verliest geen data.
- Upload payload bevat geen gevoelige identifiers.

## Fase 4 - Hub ingest en auth

Doelen:

- Device onboarding.
- Signed ingest endpoint.
- Deduplicatie + rate limiting.

Acceptatie:

- Alleen geautoriseerde devices kunnen uploaden.
- Replay en duplicate payloads worden veilig afgehandeld.

## Fase 5 - Dashboard live

Doelen:

- GitHub Pages frontend.
- Grafieken en filters over centrale data.
- Gebruikbare modelvergelijking.

Acceptatie:

- Je kunt op 1 site alle projecten en modellen vergelijken.

## Fase 6 - Hardening en operations

Doelen:

- Observability (error rate, queue depth, ingest latency).
- Backups en retention policies.
- Export API.

Acceptatie:

- Stabiele productieflow met meetbare SLOs.

## 16) Security en compliance checklist

- [ ] Geen prompts of responses in payload.
- [ ] Geen plain projectnamen/paden in payload.
- [ ] Alle writes gesigneerd.
- [ ] Nonce + timestamp validatie actief.
- [ ] Device revoke werkt direct.
- [ ] Secrets niet hardcoded, veilig opgeslagen.

## 17) Teststrategie

## 17.1 Unit tests

- Path resolver per OS branch.
- Hashing/HMAC functies.
- Bucket aggregator correctness.
- Queue retry policy.

## 17.2 Integratietests

- Migratie van oude lokale DB -> centrale DB.
- End-to-end upload succes en duplicate handling.
- Auth failure scenarios.

## 17.3 E2E/acceptatie

- 2+ projectmappen draaien op 1 machine.
- 1 centrale dashboardpagina toont gecombineerde cijfers.
- Repo blijft schoon van runtime data artifacts.

## 18) Risico's en mitigaties

1. **Corruptie of lock issues in SQLite**
   - Mitigatie: WAL mode, retries, compacte transacties.

2. **Te agressieve upload retries**
   - Mitigatie: exponential backoff + jitter + max attempts.

3. **Onbedoelde deanonymisatie via kleine datasets**
   - Mitigatie: bucket drempel (`k`), afronding en minimale report size.

4. **Hub abuse door gelekte token**
   - Mitigatie: per-device credentials, revoke, rate limits, key rotation.

5. **Complexiteit van split (GitHub Pages + backend)**
   - Mitigatie: strakke API contracten, duidelijke deploy scripts, staged rollout.

## 19) Concreet implementatiebacklog (plugin repo)

Waarschijnlijke aanpassingsgebieden:

- `src/storage/migrations.ts`
  - padresolutie naar OpenCode-map + nieuwe tabellen/kolommen.
- `src/storage/database.ts`
  - project-aware queries en queue-operaties.
- `src/metrics/collector.ts`
  - project context koppelen aan requests.
- `src/server/server.ts`
  - nieuwe project/filter endpoints.
- `src/tools/open.ts`
  - `/ts` naar dashboard URL.
- nieuwe modules:
  - `src/privacy/*` (hashing/anon)
  - `src/upload/*` (queue/dispatcher/client)

## 20) Definitie van "klaar"

Dit traject is pas klaar wanneer:

1. Runtime data default in OpenCode-map staat op macOS/Linux/Windows.
2. Geen standaard runtime DB meer in projectroot.
3. Meerdere projecten samen zichtbaar zijn in 1 dashboard.
4. Uploads zijn anoniem, gesigneerd en alleen voor geautoriseerde devices.
5. Dashboard toont modelvergelijking, trends en filters over centrale data.

## 21) Aanbevolen uitvoerroute (kort)

1. Bouw Fase 1 en 2 eerst in deze plugin (lokale website/API + centrale lokale opslag).
2. Bouw Fase 3 (anon queue) en valideer offline/online gedrag.
3. Zet ingest backend op met auth en idempotentie (Fase 4).
4. Zet GitHub Pages dashboard erop met read API (Fase 5).
5. Meet, harden, en daarna breed uitrollen (Fase 6).

---

Dit document is het uitgebreide basisplan en bevat alle ideeen uit de eerdere brainstorm: centrale opslag, OpenCode-map per OS, anonieme upload, beperkte hub-toegang, en een centrale site voor model- en projectoverzicht.

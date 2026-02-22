# Faseplan - Centrale Anonieme TokenSpeed Hub

Dit is het uitvoerbare faseplan om van lokale projectstatistieken naar 1 centrale, anonieme hub met dashboard te gaan.

## Doel van dit faseplan

- 1 centrale datastore over alle projecten.
- 1 dashboard met tokens, kosten, TPS, model EN provider vergelijkingen.
- Geen repo-vervuiling door lokale runtime data in projectmappen.
- Optionele anonieme upload naar centrale hub (niet verplicht per install).

## Fase 0 - Baseline en voorbereiden

### Doel

Technische basis neerzetten zodat latere migraties veilig en meetbaar zijn.

### Werk

1. Leg huidige status vast (huidige API responses, huidige DB schema, huidige command outputs).
2. Voeg feature flags toe voor nieuwe onderdelen:
   - `TS_UPLOAD_ENABLED`
   - `TS_HUB_URL`
   - `TS_UPLOAD_BUCKET_SEC`
   - `TS_UPLOAD_INTERVAL_SEC`
3. Definieer event/metric schema versionering (`schemaVersion=1`).

### Resultaat

- Meetbaar startpunt.
- Uitrolbare toggles om risico te beperken.

### Acceptatiecriteria

- Huidige gedrag blijft identiek met alle nieuwe flags uit.

## Fase 1 - Lokale website + lokale API (eerst)

### Doel

Direct lokaal alles uitleesbaar maken met detailweergave en een stabiele API voor andere projecten/sites.

### Werk

1. Lokale webpagina serveren op de plugin server (`/`) met:
   - overview kaarten (tokens, cost, TPS, requests)
   - detailtabellen (recent requests, per model, per provider)
   - filters (tijd, project, provider, model)
2. Lokale read API contracten vastleggen en stabiel maken (v1):
   - `GET /api/stats`
   - `GET /api/stats/models`
   - `GET /api/stats/providers`
   - `GET /api/projects`
   - `GET /api/history?projectId=&providerId=&modelId=&limit=`
   - `GET /api/sessions?limit=`
   - `GET /api/live`
3. API geschikt maken voor externe uitlezing:
   - CORS allowlist configuratie voor lokale dashboards/sites
   - consistente JSON schema's (geen breaking responses zonder version bump)
4. `/ts` laten openen naar lokale website (`/`) in plaats van ruwe JSON.

### Resultaat

- Je hebt lokaal direct 1 detailsite en 1 uitleesbare API.

### Acceptatiecriteria

- Lokale website toont detaildata over requests, provider en model.
- Een tweede lokaal project/site kan de API zonder hacks uitlezen.

## Fase 2 - Centrale lokale datastore (OpenCode-map)

### Doel

Runtime data standaard buiten projectroot opslaan voor macOS/Linux/Windows.

### Werk

1. Padresolutie implementeren in volgorde:
   - `TS_DB_PATH`
   - `OPENCODE_HOME` + `tokenspeed-monitor/`
   - default OpenCode storage pad per OS
2. Standaard paden:
   - macOS/Linux: `~/.local/share/opencode/tokenspeed-monitor/tokenspeed-monitor.sqlite`
   - Windows: `%USERPROFILE%\\.local\\share\\opencode\\tokenspeed-monitor\\tokenspeed-monitor.sqlite`
3. Migratie toevoegen van legacy `./data/tokenspeed-monitor.sqlite` naar centrale locatie.
4. Logging toevoegen voor migratie-uitkomst.

### Resultaat

- Nieuwe metrics van meerdere projecten komen in 1 centrale lokale DB.
- Geen nieuwe `./data` runtime bestanden in repositories bij default config.

### Acceptatiecriteria

- Start in 2 verschillende projectmappen schrijft naar dezelfde centrale DB.
- Legacy DB wordt eenmaal veilig overgezet.

## Fase 3 - Datamodel v2 (project + provider + model)

### Doel

Statistieken structureel opslaan met project, provider en model als analyse-dimensies.

### Werk

1. Voeg `projects` tabel toe.
2. Breid `requests` uit met:
   - `project_id`
   - `provider_id`
3. Zorg dat aggregatie sleutelt op minstens:
   - `anon_project_id`
   - `provider_id`
   - `model_id`
   - `bucket_start/bucket_end`
4. Voeg indexen toe op:
   - `(project_id, started_at)`
   - `(provider_id, model_id, started_at)`

### Resultaat

- Je kunt provider- en modelvergelijkingen doen over alle projecten.

### Acceptatiecriteria

- API kan stats filteren op `projectId`, `providerId`, `modelId`.

## Fase 4 - Anonieme upload queue (offline-first)

### Doel

Betrouwbare anonieme verzending zonder dat data verloren gaat.

### Werk

1. Voeg `upload_queue` toe met status/attempt/backoff kolommen.
2. Maak bucket-aggregator (bijv. 5 minuten).
3. Voeg HMAC anonimisering toe:
   - `anon_project_id = HMAC_SHA256(local_salt, canonical_project_root)`
4. Dispatcher bouwen:
   - retries met exponential backoff + jitter
   - idempotentie via payload hash
5. Upload payload bevat alleen aggregaties, geen ruwe inhoud.

### Resultaat

- Upload kan veilig later inhalen bij offline gebruik.

### Acceptatiecriteria

- Geen prompts, paden, message/session IDs in upload payload.
- Queue herstelt correct na netwerkuitval.

## Fase 5 - Hub ingest + beveiliging

### Doel

Alleen geautoriseerde clients mogen naar jouw hub posten.

### Werk

1. Ingest endpoint: `POST /v1/ingest/buckets`.
2. Device onboarding flow met invite token.
3. Signed requests met headers:
   - `X-TS-Device-ID`
   - `X-TS-Timestamp`
   - `X-TS-Nonce`
   - `X-TS-Signature`
4. Server-validatie:
   - timestamp window
   - nonce replay protectie
   - signature check
   - revoked device check
5. Hardening:
   - rate limiting
   - payload size limits
   - schema validatie

### Resultaat

- Open ingest voor "iedereen" kan, maar alleen binnen jouw beleid en anti-abuse grenzen.

### Acceptatiecriteria

- Ongeldige signature/nonce/timestamp wordt geweigerd.
- Geldige devices kunnen direct worden gerevoked.

## Fase 6 - Dashboard live (GitHub Pages + backend API)

### Doel

1 centrale site met cross-project inzicht.

### Werk

1. Frontend hosten op GitHub Pages.
2. Read API endpoints opleveren:
   - `GET /v1/dashboard/summary`
   - `GET /v1/dashboard/projects`
   - `GET /v1/dashboard/providers`
   - `GET /v1/dashboard/models`
   - `GET /v1/dashboard/timeseries`
3. Filters in UI:
   - periode
   - project
   - provider
   - model
4. Kernvisualisaties:
   - totale tokens/cost/TPS
   - provider -> model vergelijking
   - trendlijnen

### Resultaat

- Je ziet al je projecten op 1 plek met provider/model vergelijking.

### Acceptatiecriteria

- Dashboard toont gecombineerde data van meerdere projecten en providers.

## Fase 7 - Hardening, operations en governance

### Doel

Productiegeschiktheid en onderhoudbaarheid.

### Werk

1. Observability:
   - ingest latency
   - queue depth
   - upload success rate
2. Data lifecycle:
   - retention policy
   - backup/restore tests
3. Privacy controls:
   - expliciete opt-in/opt-out flagged behavior
4. Incident playbook:
   - token revoke
   - key rotation

### Resultaat

- Veilige, stabiele, beheerbare centrale hub.

### Acceptatiecriteria

- SLO's gedefinieerd en gehaald in proefperiode.

## Fasevolgorde (aanbevolen uitvoering)

1. Fase 0 -> 1 -> 2 -> 3 in plugin repo.
2. Fase 4 afronden en lokaal valideren met testhub.
3. Fase 5 backend security hard maken.
4. Fase 6 dashboard publiek maken.
5. Fase 7 operationeel afronden.

## Definition of Done per fase

Een fase is pas "done" als:

- scope van die fase volledig is opgeleverd;
- acceptatiecriteria aantoonbaar gehaald zijn;
- regressies op bestaande plugin-functionaliteit ontbreken.

## Einddoel (controle)

Doelbeeld behaald wanneer:

1. Er 1 centrale datastore is over alle projecten.
2. Er 1 dashboard is voor tokens, kosten, TPS, provider en modelvergelijking.
3. Er geen standaard repo-vervuiling meer ontstaat door runtime data.

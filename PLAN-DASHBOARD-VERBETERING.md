# TokenSpeed Dashboard Verbeteringsplan

## Context en doel

Dit document bevat het volledige plan om het huidige TokenSpeed dashboard te verbeteren naar een visueel sterke, dynamische en schaalbare webapplicatie met grafieken, realtime updates en detailpagina's.

Doel:
- Van basic HTML-tabellen naar een moderne, interactieve dashboard-ervaring
- Betere UX op desktop en mobiel
- Heldere architectuur voor onderhoudbaarheid en performance

## Gewenst eindresultaat

- Supermooie, appealing dashboard UI
- Interactieve grafieken voor tokens, kosten en TPS
- Realtime updates via SSE
- Dark/light mode
- Responsive design
- Detailpagina's voor requests, modellen, providers en projecten

## Geadviseerde architectuur

### Frontend stack

- Framework: Vue 3 + TypeScript
- Build tool: Vite
- State management: Pinia
- Chart library: ApexCharts
- Styling: Tailwind CSS
- Icons: Lucide Icons

### Backend (behouden)

- Bun + TypeScript
- SQLite
- REST API endpoints (bestaand)
- SSE voor live updates (bestaand)

### Waarom deze keuze

- Vue 3 + Pinia geeft snelle ontwikkeling en duidelijke state-architectuur
- ApexCharts biedt sterke interactieve timeseries en moderne visuals
- Tailwind versnelt consistente componentbouw met dark mode support
- Backend hoeft niet herschreven te worden; focus op UI/UX en data-presentatie

## Visual direction

## Kleurenpalet

### Dark mode

- Achtergrond: #020617
- Panelen: semi-transparant donker met blur (glass effect)
- Tekst primair: licht (slate-50)
- Tekst secundair: gedempt (slate-400)
- Accent: blauw/indigo gradient

### Light mode

- Achtergrond: #F8FAFC
- Panelen: wit met subtiele schaduw
- Tekst primair: donker (slate-900)
- Tekst secundair: slate-500
- Accent: helder blauw/indigo

### Datakleuren

- TPS/success: groen
- Kosten: amber/oranje
- Input tokens: violet
- Output tokens: blauw
- Reasoning/cache: fuchsia

## Typography

- Headings: Space Grotesk (of vergelijkbaar display font)
- Body/UI: Inter of Geist
- Numerieke data: JetBrains Mono of Geist Mono

## Layout en informatiehierarchie

1. Topbar (sticky)
   - Titel + live indicator
   - Date range controls (24h, 7d, 30d, custom)
   - Filters + export + theme toggle
2. KPI-rij
   - Requests
   - Tokens
   - Cost
   - Avg TPS
3. Main zone
   - Grote timeseries chart
   - Live activity feed
4. Breakdown zone
   - Donut (model usage)
   - Bar chart (providers)
   - Cost breakdown (treemap of stacked chart)
5. Datatabellen
   - Top models/providers/projects met visuele databar-indicatoren

## Charts en visualisaties

### 1) Timeseries hoofdchart

- Type: area/spline
- Metrics: tokens, cost, TPS
- Features: zoom, tooltip, toggles, gradient fill

### 2) Model usage

- Type: donut chart
- Doel: verhouding request volume per model

### 3) Provider comparison

- Type: horizontale bar chart
- Doel: vergelijken op requests, tokens, kosten, TPS

### 4) Cost breakdown

- Type: treemap of stacked bars
- Doel: inzicht in project/user/provider kostenverdeling

### 5) KPI sparklines

- Type: mini line/area
- Doel: snelle trendindicatie in KPI cards

## UX-verbeteringen

- Date range picker met presets en custom range
- Auto-refresh indicator
- Loading states met skeletons
- Error handling met toast notifications
- Empty states met duidelijke reset actie
- Smooth micro-interactions:
  - fade-in op load
  - subtiele pulse bij realtime updates
  - count-up animatie voor KPI getallen
  - hover lift op interactieve cards/buttons

## Realtime en state aanpak

### SSE best practices

- Expliciete event types (bijv. metrics.tick, request.created)
- Event id + Last-Event-ID voor herstel
- Exponential backoff + jitter bij reconnect
- Heartbeat events voor verbindingsstatus
- Client-side batching om render-load te beperken

### Store structuur (Pinia)

- entities: requests, models, providers, projects
- timeseries: buffers per metric/resolutie
- ui: filters, geselecteerde items, date range, theme
- connection: SSE status, retries, last event

## Performance strategie

- Server-side aggregatie voor grotere tijdvensters
- Downsampling bij veel datapoints
- Sliding windows voor live charts
- Throttled chart redraws
- Lazy-load zware componenten/charts
- Optioneel web workers voor zware berekeningen

## Responsive plan

- Mobile (<640px): single column, compacte filters, swipe/tab views
- Tablet (640-1024px): 2 kolommen, charts onder elkaar
- Desktop (>=1024px): volledige gridlayout
- Grote schermen: bredere content met extra witruimte

## Detailpagina's (uitbreiding)

### Request detail

- Tijd, model, provider, duration, TPS
- Input/output/reasoning/cache tokens
- Cost breakdown
- Session/project context

### Model detail

- Historische performance
- Cost efficiency
- TPS distributie
- Trend over tijd

### Provider detail

- Kosten en volume trends
- Betrouwbaarheid/performance signalen
- Vergelijking met andere providers

### Project detail

- Usage en kosten per project
- Activiteit timeline
- Model/provider mix

## Gefaseerde implementatie

## Fase 1 - Foundation

- Frontend loshalen uit inline HTML in server
- Nieuwe Vite frontend opzetten
- Tailwind + thema tokens configureren
- Basislayout + routing + API integratie

## Fase 2 - Realtime dataflow

- SSE client + reconnect beleid
- Centrale store + selectors/computed
- Live updates veilig en performant verwerken

## Fase 3 - Charts

- Timeseries chart + donut + provider bars + cost breakdown
- KPI sparklines

## Fase 4 - UX polish

- Date presets/custom picker
- Skeletons/toasts/empty states
- Animaties en micro-interactions

## Fase 5 - Performance + responsive hardening

- Optimalisaties bij grote datasets
- Mobiele UX finetuning
- Productiecontrole en QA

## Technische uitbreidingen (API en data)

Mogelijke extra endpoints:
- GET /api/v2/stats/summary
- GET /api/v2/timeseries
- GET /api/v2/models/:id/history
- GET /api/v2/providers/:id/metrics
- GET /api/v2/projects/:id/breakdown

Database-optimalisaties:
- Extra indexen op tijd/model/provider
- Optionele pre-aggregatie tabellen voor snelle chart queries

## Kwaliteitsdoelen

- Snelle first load
- Vloeiende interacties
- Stabiele realtime updates
- Volledig bruikbaar op mobiel en desktop
- Toegankelijke contrasten en heldere states

## Samenvatting

Dit plan levert een complete evolutie van het huidige dashboard naar een moderne data-app met:
- sterke visuele uitstraling
- realtime inzicht
- schaalbare architectuur
- duidelijke detailpagina's
- goede onderhoudbaarheid op lange termijn

## Implementatiestatus (2026-02-23)

Uitgevoerd in deze iteratie:
- `tokenspeed-logo.png` geconverteerd naar `tokenspeed-logo.webp`
- Nieuwe logo-asset route toegevoegd op zowel local server als hub server
- Logo geïntegreerd op alle webpagina's:
  - local dashboard
  - hub dashboard
  - hub admin
  - hub admin login
- Local dashboard volledig vernieuwd met:
  - moderne glass/neon look
  - dark/light mode toggle
  - range controls
  - interactieve grafieken (Chart.js)
  - live activity feed
  - detailpaneel voor requests
  - toast meldingen
- Hub dashboard volledig vernieuwd met:
  - moderne command center layout
  - dark/light mode toggle
  - range presets + group by
  - interactieve grafieken (Chart.js)
  - gecombineerde data-overzichten
  - export links met filterquery sync
- Hub admin en login visueel vernieuwd met consistent design en logo
- Packaging bijgewerkt zodat `tokenspeed-logo.webp` wordt meegenomen in npm files

Validatie:
- Tests: `npm test` geslaagd (17/17)
- Build: `npm run build` gaf een TypeScript omgeving/lib issue (`lib.esnext.full.d.ts` ontbreekt in huidige omgeving)

## UI Polish pass (2026-02-23)

Extra verfijningen uitgevoerd na de eerste implementatie:
- Zachtere, neutralere panel borders en verbeterde contrast-tokens in dark/light mode
- Diepere glassmorphism (`backdrop-filter` verhoogd) en rustiger schaduwbeeld
- Strakkere spacing in cards/panels voor betere hiërarchie
- Verbeterde typography voor KPI-getallen (`line-height` en `letter-spacing` tuning)
- Knoppen/selects verfijnd met subtielere achtergronden en consistente hover states
- Focus-visible states toegevoegd voor keyboard accessibility
- Selects voorzien van custom chevron styling (appearance none)
- Pulse-animaties subtieler gemaakt
- Scrollbars gestyled in live/table containers
- Hover states toegevoegd op tabelrijen
- Mobiele topbar/controls verder verbeterd voor smalle schermen
- Reduced motion support toegevoegd (`prefers-reduced-motion`)
- Live activity items keyboard-bedienbaar gemaakt (`role`, `tabindex`, Enter/Space handlers)

Validatie na polish:
- Tests: `npm test` geslaagd (17/17)

## Hotfix filterbreedte (2026-02-23)

Specifieke UI-fix uitgevoerd voor te brede velden in de hub dashboard filterbalk:
- `.filters` omgezet van vaste grid naar compacte flex-wrap layout
- Smalle vaste breedte voor unix velden (`input[type=number]`)
- Middelbreedte voor tekstfilters (`input[type=text]`)
- Knoppen als compacte auto-size elementen
- Mobiele fallback toegevoegd: filterrij stacked en full-width onder 600px

Validatie:
- Tests: `npm test` geslaagd (17/17)

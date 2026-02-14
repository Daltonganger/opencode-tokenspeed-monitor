# OpenCode TokenSpeed Monitor

OpenCode plugin to monitor token speed per request, store metrics in SQLite, and expose stats over an HTTP API.

## Planned Commands

- `/ts` - toggle monitor on/off
- `/ts-status` - show latest metrics
- `/ts-stats` - show session totals and averages
- `/ts-history` - show recent requests
- `/ts-bg` - run background collection with API access

## Planned Scope (v1)

- Accurate token tracking from OpenCode events
- Local SQLite persistence
- HTTP endpoints for stats/history/live stream
- Toast and log output per completed request

# Release and Publish Flow

Use this sequence for every npm release.

## 1) Pre-flight

- Ensure local changes are intentional.
- Ensure `README.md` reflects any new endpoint or env var.
- Ensure version in `package.json` is correct.

## 2) Validation

Run one command:

```bash
npm run release:check
```

This runs:

- tests (`bun test src/**/*.test.ts`)
- build (`npm run build`)
- package dry-run (`npm run pack:check`)

## 3) Publish

```bash
npm login
npm publish --access public
```

## 4) Post-publish smoke test

1. In a clean OpenCode setup, install:

```json
{
  "plugin": ["opencode-tokenspeed-monitor@latest"]
}
```

2. Restart OpenCode.
3. Run `/ts`, `/ts-status`, `/ts-bg`.
4. Confirm local API responds.

## 5) Optional hub smoke test

If hub changes were included, also verify:

- `GET /v1/health`
- `GET /v1/dashboard/summary`
- `/admin` login works with `TS_HUB_ADMIN_TOKEN`

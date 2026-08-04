---
name: e2e
description: Setup and run Playwright magic-link E2E tests against the local Supabase auth appliance
user_invocable: true
---

# /e2e — E2E Testing

## Database boundary

This skill owns the GoTrue + Edge Function + Mailpit magic-link environment only. DB-backed agent
pytest suites use `TEST_DATABASE_URL`, `TEST_DB=docker|neon`, or the offline Docker default; they do
not consume this Supabase instance. Until Neon Auth replaces the local auth flow, `supabase start`
is an auth appliance, not the integration-test database.

## Setup (first time or after DB changes)

```bash
make e2e-setup
```

This runs `scripts/e2e-setup.sh` which:
1. Starts Supabase (--exclude vector,analytics)
2. Seeds test data (18 anime, 43 spots from `apps/agent/agent/tests/fixtures/seed.sql`)
3. Serves Edge Function (`send-auth-email` with SMTP to Mailpit)
4. Installs `e2e/` npm deps

Frontend must be running separately:
```bash
cd frontend && npm run dev -- -p 3001
```

Frontend `.env.local` must point to local Supabase:
```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH
```

## Run

| Command | What | Time |
|---------|------|------|
| `make e2e` | All 34 tests | ~16s |
| `make e2e-public` | 12 tests (no email) | ~4s |
| `cd e2e && npx playwright test --headed --workers=1` | Watch in browser | ~20s |

## Tests (34)

| File | # | Covers |
|------|---|--------|
| `web-404.spec.ts` | 3 | Home/undefined route hydration, branded 404 |
| `web-chat-anonymous.spec.ts` | 6 | Anonymous chat round-trip, rate-limit wait copy, quota breaker → login, challenge retry, daily-quota lock |
| `web-chat-error-states.spec.ts` | 9 | D1–D6/D8/D9 error cards (recognition, zero spots, short route, interruption, timeout, validation, session expiry, scene-image 404) |
| `web-chat-save-login-wall.spec.ts` | 6 | Save intent, magic-link login wall, deferred replay across tabs |
| `web-chat-selection.spec.ts` | 2 | Multi-spot selection tray, inline recompute retry |
| `web-map-spike.spec.ts` | 4 | Tile paint budget, 204/404/500 tile outage rendering |
| `web-maplibre-canary.spec.ts` | 2 | MapLibre v5 happy path, setup-failure fallback |
| `web-splash.spec.ts` | 2 | Day/night splash render + clear

## Locale Email Tests

The Edge Function (`send-auth-email`) sends locale-specific emails:
- `locale: "en"` → "Seichijunrei — Login link" + "Log in"
- `locale: "ja"` → "聖地巡礼 — ログインリンク" + "ログインする"
- `locale: "zh"` → "聖地巡礼 — 登录链接" + "点击登录"

Tests set browser locale via `browser.newContext({ locale })` and verify Mailpit email content.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Anime not found on Guide page | `docker exec -i supabase_db_seichijunrei-agent psql -U postgres < apps/agent/agent/tests/fixtures/seed.sql` |
| Email not arriving in Mailpit | Check Edge Function: `curl http://localhost:54321/functions/v1/send-auth-email` |
| SMTP connection refused | config.toml needs `[inbucket] smtp_port = 54325` |
| Login link expired | Edge Function SITE_URL wrong. Pass `SITE_URL=http://localhost:3001` |
| Tests flaky | Use `--workers=1` (auth tests need serial SMTP) |
| Docker snippets permission | `mkdir -p supabase/snippets && chmod 755 supabase/snippets` |
| Supabase CLI too old | Need v2.98.1+ for auth hook support. `brew upgrade supabase` |

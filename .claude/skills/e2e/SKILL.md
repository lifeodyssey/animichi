---
name: e2e
description: Setup and run Playwright E2E tests against local Supabase
user_invocable: true
---

# /e2e — E2E Testing

## Setup (first time or after DB changes)

```bash
make e2e-setup
```

This runs `scripts/e2e-setup.sh` which:
1. Starts Supabase (--exclude vector,analytics)
2. Seeds test data (18 anime, 43 spots from `backend/tests/fixtures/seed.sql`)
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
| `make e2e` | All 18 tests | ~16s |
| `make e2e-public` | 12 tests (no email) | ~4s |
| `cd e2e && npx playwright test --headed --workers=1` | Watch in browser | ~20s |

## Tests (18)

| File | # | Covers |
|------|---|--------|
| `public-pages.spec.ts` | 3 | Landing, Guide load, CTA button |
| `middleware-redirect.spec.ts` | 4 | /chat→/login, /settings→/login, query preserved, public passthrough |
| `login-modal.spec.ts` | 5 | Landing modal, ?login=true, Guide CTA modal, hint text, backdrop close |
| `auth-flow-local.spec.ts` | 6 | Email arrival, magic link login, en/ja/zh locale email content |

## Locale Email Tests

The Edge Function (`send-auth-email`) sends locale-specific emails:
- `locale: "en"` → "Seichijunrei — Login link" + "Log in"
- `locale: "ja"` → "聖地巡礼 — ログインリンク" + "ログインする"
- `locale: "zh"` → "聖地巡礼 — 登录链接" + "点击登录"

Tests set browser locale via `browser.newContext({ locale })` and verify Mailpit email content.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Anime not found on Guide page | `docker exec -i supabase_db_seichijunrei-agent psql -U postgres < backend/tests/fixtures/seed.sql` |
| Email not arriving in Mailpit | Check Edge Function: `curl http://localhost:54321/functions/v1/send-auth-email` |
| SMTP connection refused | config.toml needs `[inbucket] smtp_port = 54325` |
| Login link expired | Edge Function SITE_URL wrong. Pass `SITE_URL=http://localhost:3001` |
| Tests flaky | Use `--workers=1` (auth tests need serial SMTP) |
| Docker snippets permission | `mkdir -p supabase/snippets && chmod 755 supabase/snippets` |
| Supabase CLI too old | Need v2.98.1+ for auth hook support. `brew upgrade supabase` |

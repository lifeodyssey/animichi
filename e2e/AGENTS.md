# e2e — AGENTS.md

Playwright browser coverage for the legacy frontend plus the isolated `apps/web` cutover surface.
The suite exercises public pages, auth redirects, Mailpit magic links, and the new app's 404.
Root guide: `../AGENTS.md`.

## Commands (from repo root)

- `make dev-local` — start the backend, legacy frontend, Supabase, email function, and Mailpit.
- `make e2e-setup` — reset/seed local Supabase, serve the email function, and install E2E deps.
- `make e2e` — run the complete Playwright suite.
- From `e2e/`: `pnpm test` · `pnpm run test:headed` · `pnpm run test:public` ·
  `pnpm run test:auth` · `pnpm run test:web`.

## Conventions

- Start `make dev-local` first, then run setup/tests. The setup script does not launch the backend.
- `E2E_BASE_URL` targets the legacy frontend (default `:3001`);
  `E2E_WEB_BASE_URL` targets `apps/web` (default `:3000`).
- Keep browser assertions user-visible and locale-aware; failure screenshots are automatic.

## Key files + entrypoints

- `playwright.config.ts` — Chromium project, origins, timeouts, trace/screenshot policy.
- `fixtures/email.ts` — Mailpit/mails.dev polling and magic-link extraction.
- `auth-flow-local.spec.ts` — serial local email login path.
- `public-pages.spec.ts` · `middleware-redirect.spec.ts` · `login-modal.spec.ts` — legacy surface.
- `web-404.spec.ts` — `apps/web` branded-not-found contract.
- `../scripts/e2e-setup.sh` — local Supabase/Mailpit preparation.

## Pitfalls

- Auth E2E depends on Mailpit at `http://localhost:54324`; stale mail can invalidate assumptions,
  so fixtures filter by recipient and send time.
- `pnpm run test:auth` currently targets missing `auth-flow.spec.ts`; the checked-in suite is
  `auth-flow-local.spec.ts`. Treat the script as stale until a non-doc change repairs the manifest.
- Before running, inspect `http://localhost:8080/healthz` and confirm `git_branch` is the intended
  checkout. The endpoint exposes the runtime's actual branch and commit.
- Do not collapse the two base URLs until the S0.7 cutover is complete.

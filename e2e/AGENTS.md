# e2e — AGENTS.md

Playwright browser coverage for `apps/web`, the only browser surface left after issue #537
retired the legacy `frontend/` package. The suite exercises the branded 404 and the chat flows.
Root guide: `../AGENTS.md`.

## Commands (from repo root)

- `make dev-local` — start the backend, web app, Supabase, email function, and Mailpit.
- `make e2e-setup` — reset/seed local Supabase, serve the email function, and install E2E deps.
- `make e2e` — run the complete Playwright suite.
- From `e2e/`: `pnpm test` · `pnpm run test:headed` · `pnpm run test:web`.

## Conventions

- Start `make dev-local` first, then run setup/tests. The setup script does not launch the backend.
- `E2E_WEB_BASE_URL` targets `apps/web` (default `:3000`, CI wrangler `:8799`).
- Keep browser assertions user-visible and locale-aware; failure screenshots are automatic.

## Key files + entrypoints

- `playwright.config.ts` — Chromium project, origins, timeouts, trace/screenshot policy.
- `web-404.spec.ts` — `apps/web` branded-not-found contract.
- `web-chat-*.spec.ts` — `apps/web` chat anonymous / error-state / selection / login-wall flows.
- `../scripts/e2e-setup.sh` — local Supabase/Mailpit preparation.

## Pitfalls

- There is no magic-link E2E right now: #537 deleted `auth-flow-local.spec.ts` along with the
  legacy login page it drove, and `fixtures/email.ts` with it. Recover that fixture from git
  history when Neon Auth (#312) gives `apps/web` a login route worth testing.
- Before running, inspect `http://localhost:8080/healthz` and confirm `git_branch` is the intended
  checkout. The endpoint exposes the runtime's actual branch and commit.

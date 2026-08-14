# supabase/ — Historical archive (NOT live architecture)

> **STATUS: HISTORICAL — retired by the Neon-only hard cut (#1000 / #992 wave).**
> This directory is kept for **historical context only** and is **no longer
> applied, deployed, or validated** by any CI, deployment, or runtime path.

Animichi has completed the Neon-only cutover. Auth is **Neon Auth (Better Auth,
integrated in `apps/web`)** and the data plane is **Neon Postgres (Atlas
migrations under `migrations/neon/`)**.

Everything under `supabase/` predates that cutover:

- `migrations/` — legacy auth-only (and early data-plane) SQL migrations that
  once lived in the Supabase Postgres. They are **history**, not an apply
  surface; `migrations/neon/` is the single live migration authority.
- `functions/send-auth-email/` — the retired Supabase Edge Function that sent
  magic-link auth emails; superseded by Neon Auth email flows.
- `config.toml` — Supabase local CLI configuration; no longer required for
  local development (`make dev-local` uses Neon; `make local-login` is Neon
  Auth magic link, AUTH-2 #950).
- `templates/magic-link.html` — retired magic-link email template.

## Content ownership

- The data-plane tables whose migrations historically lived here are now owned
  by `migrations/neon/` and the table-ownership map in
  `migrations/AGENTS.md`.
- Do **not** add new migrations or functions to this directory.

## Why it is kept

Per `docs/DOCS_POLICY.md`, historical records remain available as historical
context (issue #1000 AC5). Keeping the original `supabase/` tree (rather than
renaming or hard-deleting it) preserves that context and keeps a small number
of committed tests that read specific historical migrations
(`apps/agent/src/animichi/tests/unit/test_phase1c_route_persistence.py`) green.

For the current live architecture, see `docs/ARCHITECTURE.md` (Neon Auth +
Neon Postgres only).

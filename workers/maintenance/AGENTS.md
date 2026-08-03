# workers/maintenance — AGENTS.md

Scheduled-only TypeScript Cloudflare Worker for agent-domain Neon retention. It owns no public HTTP
surface and must not absorb catalog- or user-domain work. Root guide: `../../AGENTS.md`.

## Commands

- `pnpm test` / `pnpm run test:worker` — mocked database and clock tests with coverage.
- `pnpm run typecheck` — TypeScript 7.0.2.
- `pnpm run lint:oxlint` — strict type-aware oxlint with warnings denied.
- `pnpm run dev` — local scheduled-handler development; never deploy locally.

## Runtime rules

- `AGENT_DATABASE_URL` is a required secret in default, staging, and production config. Never put a
  DSN in `[vars]`; local development uses `.dev.vars`.
- Preserve the SQL predicates and UTC cutoff behavior cited from the Python sources in
  `src/purge.ts`. The anonymous-session purge must remain per-session and FK-race-isolated.
- Keep both cron strings byte-identical across `src/index.ts` and every `wrangler.toml` environment.
- Queries use `@neondatabase/serverless` over Neon HTTP; schema changes remain Atlas-owned in `db/`.

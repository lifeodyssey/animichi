<div align="center">

# 聖地巡礼 Animichi

**AI-powered pilgrimage search and route planning for anime sacred sites**

[![CI](https://github.com/lifeodyssey/animichi/actions/workflows/pr-verification.yml/badge.svg?branch=main)](https://github.com/lifeodyssey/animichi/actions/workflows/pr-verification.yml?query=branch%3Amain)
[![TanStack Start](https://img.shields.io/badge/TanStack_Start-SSR-FF4154.svg)](https://tanstack.com/start)
[![Cloudflare Workers](https://img.shields.io/badge/deploy-Cloudflare_Workers-f38020.svg?logo=cloudflare)](https://developers.cloudflare.com/workers/)
[![Neon](https://img.shields.io/badge/Neon-Postgres-30cf9e.svg?logo=neon)](https://neon.tech)
[![GitHub last commit](https://img.shields.io/github/last-commit/lifeodyssey/animichi)](https://github.com/lifeodyssey/animichi/commits/main)
[![GitHub stars](https://img.shields.io/github/stars/lifeodyssey/animichi?style=flat)](https://github.com/lifeodyssey/animichi)

[**Try it live**](https://seichijunrei.zhenjia.org) | [Architecture](docs/ARCHITECTURE.md) | [Deployment](docs/ops/deployment.md)

[English](README.md) | [日本語](README.ja.md) | [中文](README.zh.md)

</div>

---

Tell the agent an anime title or a location in natural language. It finds real-world pilgrimage spots, shows them on a map, and plans a walking route — all in one conversational turn.

## How It Works

```
User text  →  native Pi agent (workers/edge/src/agent/)
                 ├── resolve_anime  → catalog Worker title resolve; Bangumi ingest on miss
                 ├── search_bangumi → catalog points for resolved bangumi_id
                 ├── search_nearby  → catalog geo retrieval (PostGIS on Neon)
                 ├── plan_route     → catalog route ordering
                 └── web_search / translate → attributed research / title translation
              → answer + tool call records
```

A single agent handles planning and tool dispatch. Selected-point routes bypass the agent entirely.

`resolve_anime` is self-evolving: on first query for an unknown title it fetches metadata from Bangumi.tv, upserts it into the database, and all future queries hit the local DB.

## Features

- **Conversational search** — ask in Japanese, English, or Chinese; the agent handles intent
- **Self-evolving anime catalog** — DB-first with Bangumi.tv API write-through on miss
- **Geo retrieval** — find pilgrimage spots near any coordinate or station name
- **Route planning** — nearest-neighbor ordering with optional user-selected points
- **Generative UI** — three-column layout with chat panel + interactive result panel
- **Edge auth** — Neon Auth (Better Auth) JWT (magic-link) enforced at Cloudflare Worker against the branch JWKS
- **Eval harness** — 50+ plan-quality cases across 3 locales (`packages/eval`)

## Quick Start

```bash
# Install dependencies
pnpm install

# Run the web app locally
make dev-local

# Run every package's lint, typecheck and tests
make check-full
```

## Database Migrations

Neon schema changes are declared in `packages/pi-session-neon/src/contract.prisma` and versioned
as one Prisma 8 chain under `packages/pi-session-neon/migrations/`. Its emitted artifacts must be
regenerated in the same change. No Worker keeps a schema of its own: the contract that chain
generates is the only map of this data plane (#1633). `supabase/` is an archived historical
Supabase migration tree (issue #1000); it is not applied and is not a source for new Neon tables.

```bash
make db-new NAME=x     # scaffold a migration in the chain
make db-lint           # artifact integrity and a connected graph
make db-status         # the migration path and what is pending
```

There is no local apply target: the migrator Worker holds the only database credential, and CD is
the only thing that applies a migration.

See [`docs/ops/migrations.md`](docs/ops/migrations.md) for the boundary, CI gates, and deploy
order. Apply migrations in a dedicated deploy step, not at application startup.

## Environment

**Required (edge Worker / local serve):**
| Variable | Purpose |
|---|---|
| `AGENT_SVC_DATABASE_URL` | Neon agent_svc role DSN — the required agent data-plane connection (#912), bound on the edge Worker and read by the native agent tier |
| `MIMO_API_KEY` | Primary model provider key |

**Worker edge:** `NEON_AUTH_JWKS_URL` (the edge's ONLY identity source — AUTH-2 #950; verifies
Neon Auth EdDSA JWTs against the branch JWKS; production stays unset/fails closed until its branch
is provisioned). Catalog/users/jobs also need their Neon DSNs — see [`docs/ops/deployment.md`](docs/ops/deployment.md).

**Web (`apps/web`):** `VITE_NEON_AUTH_BASE_URL` — the Better Auth client origin (login UI + JWT
exchange); `VITE_TURNSTILE_SITE_KEY`, `VITE_SHOWCASE_MODE` — see [`apps/web/.env.example`](apps/web/.env.example).

**Optional:** `SERVICE_HOST`, `SERVICE_PORT`, `OBSERVABILITY_*`, `DEFAULT_AGENT_MODEL`

See [`.env.example`](.env.example) for defaults.

## Example Usage

**HTTP (authenticated):**
```bash
curl -N -X POST https://seichijunrei.zhenjia.org/v1/chat \
  -H 'Authorization: Bearer <neon_auth_jwt>' \
  -H 'Content-Type: application/json' \
  -H 'x-locale: ja' \
  -d '{"messages":[{"role":"user","parts":[{"type":"text","text":"吹響の聖地"}]}]}'
```

## Repository Map

- `workers/catalog/` — Cloudflare Worker: anime catalog API + data platform (TypeScript)
- `workers/users/` — Cloudflare Worker: user-domain data service (`/v1/users/*`)
- `packages/contract/` — shared oRPC/zod contract (catalog ↔ agent ↔ users)
- `apps/web/` — TanStack Start SSR web app (**the only browser surface**)
- `workers/edge/` — Cloudflare Worker entrypoint for auth and `/v1` routing
- `supabase/` — legacy compatibility migrations and Supabase project assets (auth retired to Neon, AUTH-2 #950)
- `docs/` — architecture, ops runbooks, iteration artifacts, and implementation plans
- `Makefile`, `package.json` — root tooling entrypoints; `workers/edge/wrangler.toml` (edge Worker config) lives beside its code

## Docs

- [Architecture](docs/ARCHITECTURE.md) — full system design reference
- [Deployment](docs/ops/deployment.md) — Cloudflare Workers deploy guide
- [Migrations](docs/ops/migrations.md) — the Prisma chain's authority and what may not apply it
- [Ops docs](docs/ops/README.md) — operational runbooks and environment procedures
- [Iteration artifacts](docs/iterations/README.md) — task plans, progress logs, and findings by iteration
- [Implementation plans (archive)](docs/archive/plans/) — historical execution plans (flat `plans/` no longer accepts new files)
- [Design specs](docs/specs/) — active product/architecture specifications
- [Agent guide](AGENTS.md) — monorepo layout, commands, and cross-stack guardrails

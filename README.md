<div align="center">

# 聖地巡礼 Animichi

**AI-powered pilgrimage search and route planning for anime sacred sites**

[![CI](https://github.com/lifeodyssey/animichi/actions/workflows/pr-verification.yml/badge.svg?branch=main)](https://github.com/lifeodyssey/animichi/actions/workflows/pr-verification.yml?query=branch%3Amain)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-3776ab.svg)](https://www.python.org)
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
User text  →  PydanticAI Agent (animichi_agent)
                 ├── resolve_anime  → catalog Worker title resolve; Bangumi ingest on miss
                 ├── search_bangumi → catalog points for resolved bangumi_id
                 ├── search_nearby  → catalog geo retrieval (PostGIS on Neon)
                 ├── plan_route     → catalog route ordering
                 └── web_search / translate → attributed research / title translation
              → AgentResult (typed output + tool call records)
```

A single PydanticAI agent handles planning and tool dispatch. Tools use `ModelRetry` guards to reject invalid parameters, and an `output_validator` rejects fabricated responses. Selected-point routes bypass the agent entirely.

`resolve_anime` is self-evolving: on first query for an unknown title it fetches metadata from Bangumi.tv, upserts it into the database, and all future queries hit the local DB.

## Features

- **Conversational search** — ask in Japanese, English, or Chinese; the agent handles intent
- **Self-evolving anime catalog** — DB-first with Bangumi.tv API write-through on miss
- **Geo retrieval** — find pilgrimage spots near any coordinate or station name
- **Route planning** — nearest-neighbor ordering with optional user-selected points
- **Generative UI** — three-column layout with chat panel + interactive result panel
- **Edge auth** — Neon Auth (Better Auth) JWT (magic-link) enforced at Cloudflare Worker against the branch JWKS
- **Eval harness** — 50+ plan-quality cases across 3 locales via pydantic_evals

## Quick Start

```bash
# Install Python dependencies
uv sync --extra dev

# Run the service locally
make serve

# Run tests
make test              # unit tests
make test-integration  # stable acceptance tests
make test-all          # unit + integration
make test-eval         # model-backed evals (needs LLM access)
make check             # lint + typecheck + test
```

## Database Migrations

Neon catalog and user schema changes are versioned in `migrations/neon/` and applied by the
pinned Atlas CLI. `migrations/neon/atlas.sum` is generated metadata and must be regenerated in
the same change. Drizzle schemas in the Workers are runtime query/type metadata only; they do
not generate or apply migrations. `supabase/` is an archived historical Supabase migration
tree (issue #1000); it is not applied and is not a source for new Neon tables.

```bash
make db-list           # list checked-in Atlas migrations
make db-hash           # regenerate migrations/neon/atlas.sum
make db-validate       # verify the checksum and SQL structure
make db-push-dry       # dry-run against NEON_DATABASE_URL
make db-push           # apply against NEON_DATABASE_URL
```

See [`docs/ops/migrations.md`](docs/ops/migrations.md) for the boundary, CI gates, and deploy
order. Apply migrations in a dedicated deploy step, not at application startup.

## Environment

**Required (agent container / local serve):**
| Variable | Purpose |
|---|---|
| `AGENT_SVC_DATABASE_URL` | Neon agent_svc role DSN (asyncpg) — the required agent-container data-plane connection (#912). The legacy `SUPABASE_DB_URL` name is still provisioned as the transitional container-DSN name pending the #855 prod cutover |
| `MIMO_API_KEY` | Primary model provider key |
| `DEEPSEEK_API_KEY` | Required by edge container-env for agent boot (forwarded into the container) |

**Worker edge:** `NEON_AUTH_JWKS_URL` (the edge's ONLY identity source — AUTH-2 #950; verifies
Neon Auth EdDSA JWTs against the branch JWKS; production stays unset/fails closed until its branch
is provisioned). Catalog/users/jobs also need their Neon DSNs — see [`docs/ops/deployment.md`](docs/ops/deployment.md).

**Web (`apps/web`):** `VITE_NEON_AUTH_BASE_URL` — the Better Auth client origin (login UI + JWT
exchange); `VITE_TURNSTILE_SITE_KEY`, `VITE_SHOWCASE_MODE` — see [`apps/web/.env.example`](apps/web/.env.example).

**Optional:** `SERVICE_HOST`, `SERVICE_PORT`, `OBSERVABILITY_*`, `DEFAULT_AGENT_MODEL`

See [`apps/agent/src/animichi/config/settings.py`](apps/agent/src/animichi/config/settings.py) for full reference and [`.env.example`](.env.example) for defaults.

## Example Usage

**Python (direct):**
```python
import os

from animichi.agents.animichi_runner import run_animichi_agent
from animichi.infrastructure.persistence.database import create_database_lifecycle
from animichi.infrastructure.persistence.repositories.composite import PersistenceRepos
from animichi.clients.catalog_client import CatalogClient

async def main() -> None:
    # One session factory per app: the Neon agent_svc DSN (AGENT_SVC_DATABASE_URL)
    # plus its async_sessionmaker, owned by DatabaseLifecycle.
    lifecycle = create_database_lifecycle(os.environ["AGENT_SVC_DATABASE_URL"])
    try:
        repos = PersistenceRepos.build(lifecycle.sessionmaker)   # SQLModel repos over one Neon session
        catalog = CatalogClient(base_url="https://catalog.example")
        result = await run_animichi_agent(
            text="吹響ユーフォニアムの聖地", db=repos, locale="ja", catalog=catalog
        )
        print(result.output)
    finally:
        await lifecycle.close()
```

**HTTP (authenticated):**
```bash
curl -X POST https://seichijunrei.zhenjia.org/v1/runtime \
  -H 'Authorization: Bearer <neon_auth_jwt>' \
  -H 'Content-Type: application/json' \
  -d '{"text":"吹響の聖地","locale":"ja"}'
```

## Repository Map

- `apps/agent/` — Python runtime: agents, interfaces, infrastructure, tests, and tools
- `workers/catalog/` — Cloudflare Worker: anime catalog API + data platform (TypeScript)
- `workers/users/` — Cloudflare Worker: user-domain data service (`/v1/users/*`)
- `packages/contract/` — shared oRPC/zod contract (catalog ↔ agent ↔ users)
- `apps/web/` — TanStack Start SSR web app (**the only browser surface**)
- `workers/edge/` — Cloudflare Worker entrypoint for auth and `/v1` routing
- `migrations/neon/` — Atlas migrations and generated checksum for the Neon data plane
- `supabase/` — legacy compatibility migrations and Supabase project assets (auth retired to Neon, AUTH-2 #950)
- `docs/` — architecture, ops runbooks, iteration artifacts, and implementation plans
- `Makefile`, `package.json` — root tooling entrypoints; `apps/agent/Dockerfile` (container image) and `workers/edge/wrangler.toml` (edge Worker config) live beside their code

## Docs

- [Architecture](docs/ARCHITECTURE.md) — full system design reference
- [Deployment](docs/ops/deployment.md) — Cloudflare Workers + Containers deploy guide
- [Migrations](docs/ops/migrations.md) — Atlas authority and Drizzle query/type boundary
- [Ops docs](docs/ops/README.md) — operational runbooks and environment procedures
- [Iteration artifacts](docs/iterations/README.md) — task plans, progress logs, and findings by iteration
- [Implementation plans (archive)](docs/archive/plans/) — historical execution plans (flat `plans/` no longer accepts new files)
- [Design specs](docs/specs/) — active product/architecture specifications
- [Agent guide](AGENTS.md) — monorepo layout, commands, and cross-stack guardrails

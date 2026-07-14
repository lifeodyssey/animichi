# apps/agent — AGENTS.md

Python PydanticAI agent, FastAPI, deployed as a Cloudflare container. **Read-only consumer of the
catalog** — it never calls external anime APIs in the request path and never writes catalog data
(the catalog Worker owns ingestion). Root guide: `../../AGENTS.md`.

## Commands (run from repo root; the make targets `cd apps/agent`)

- `make test` (pytest `--asyncio-mode=auto`) · `make test-integration` · `make typecheck` (mypy strict) ·
  `make lint` (ruff). Pre-commit runs ruff + mypy on every commit.
- Directly: `cd apps/agent && uv run pytest agent/tests/unit/`. Seed data: `agent/tests/fixtures/seed.sql`.
- In a worktree, format with `uv tool run ruff format` (not `uv run …`).

## Runtime call-path

User text → `RuntimeAPI.handle()` → `run_animichi_agent()` → `animichi_agent.run()` → tools →
`AgentResult` → `agent_result_to_response()` → `PublicAPIResponse`. `selected_point_ids` bypasses the
agent via `execute_selected_route()`.

- Entry: `agent/interfaces/fastapi_service.py` → `public_api.py` → `agents/animichi_runner.py`.
- Shared types: `agent/agents/models.py`, `agent/agents/agent_result.py`.

## Tools (`agents/animichi_tools.py` — `@agent.tool` registrations with `ModelRetry` guards)

| Tool | Description |
|---|---|
| `resolve_anime` | API-first title→bangumi_id; DB cache; write-through |
| `search_bangumi` | Retriever → points by bangumi_id |
| `search_nearby` | Geo retrieval by location + radius |
| `plan_route` | Nearest-neighbor route ordering |
| `greet_user` | Ephemeral greeting/identity response |
| `answer_question` | QA pass-through |
| `clarify` | Disambiguation when the query is ambiguous |

## Trust boundary

- Single PydanticAI agent (`animichi_agent`) with typed output; the selected-route path bypasses it.
- `ModelRetry` guards reject invalid LLM parameters; `output_validator` rejects fabricated output.
- The container trusts auth headers forwarded by the edge worker (`worker/`); it does not re-authenticate.
- Injection defense (SD-19): tool/envelope text is **untrusted** — never show an upstream `message` to
  users, embed it in prompts, or store it on `str()`. User-facing text comes from `agents/error_messages.py`.

## Type safety

See `.claude/rules/python-types.md` (auto-loads for `*.py` here) + `docs/typing-rules.md`.

## Catalog client (hand-mirrored contract — do NOT codegen)

`agent/clients/catalog_client.py` mirrors `packages/contract` by hand with sentinel defaults
(`episode=-1`, `name_cn=""`, `distance_m=-1.0`). Error mirror: `agent/clients/catalog_errors.py`;
user messages: `agent/agents/error_messages.py`. Adding an error code → follow the checklist in
`packages/contract/README.md` (all three mirrors).

## External APIs (the agent reads the catalog; ingestion is the catalog Worker's job)

Anitabi (`api.anitabi.cn`) + Bangumi (`api.bgm.tv`) share Bangumi.tv subject IDs as our primary keys
(`eps=1` → movie, `eps>1` → TV). Full reference: `docs/api-reference/`.

## HTTP + observability conventions (F7/F8)

- **httpx only** — aiohttp is retired (F7). **One shared `httpx.AsyncClient` per client**, created
  lazily and closed via the FastAPI lifespan `aclose()` (`agent/interfaces/fastapi_service.py`) — never per-request.
  Leave `trust_env` at httpx's default (`True`) so proxy/CA env vars are respected.
- **Status-based retry** — classify by **status code, never by URL/substring**: 5xx, transport errors,
  and transient 4xx (408/429) retry with backoff; other 4xx raise immediately (`agent/clients/catalog_client.py`).
- **Observability = logfire only** (F8). Never hand-roll OpenTelemetry or add `opentelemetry-api|sdk`
  directly (logfire pins its own). Go through `agent/infrastructure/observability/runtime.py`
  (`runtime_span` / `http_span`, `record_*`); `setup_logfire` calls
  `logfire.configure(send_to_logfire="if-token-present")`, which no-ops without `LOGFIRE_TOKEN`.
  Test spans via `logfire.testing.capfire`.
- **Typed DB** — asyncpg with the `asyncpg-stubs` dev dep; no untyped pool/record access.

## Test environment reality

- Integration/eval suites that import `pg_container` (`agent/tests/conftest_db.py`) need a
  **Docker-compatible runtime** (Docker / Colima on Mac) and use **testcontainers PostGIS**
  (`postgis/postgis:16-3.4`). `SUPABASE_DB_URL` / `supabase start` alone is NOT sufficient for those
  suites. Unit tests need no Docker.

## TDD: invoke `/backend-tdd` before writing Python.

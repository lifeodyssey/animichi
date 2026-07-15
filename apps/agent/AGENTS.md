# apps/agent — AGENTS.md

Python PydanticAI agent, FastAPI, deployed as a Cloudflare container. **Read-only consumer of the
catalog** — it never calls external anime APIs in the request path and never writes catalog data
(the catalog Worker owns ingestion). Root guide: `../../AGENTS.md`.

## Commands (run from repo root; the make targets `cd apps/agent`)

- `make test` (pytest `--asyncio-mode=auto`) · `make test-integration` · `make typecheck` (mypy strict) ·
  `make lint` (ruff). Pre-commit runs ruff + mypy on every commit.
- `make test-eval` — official model-backed runner plus translation eval. The pytest eval entry is a
  transition alias sharing the same report/gate path, not the primary interface.
- Directly: `cd apps/agent && uv run pytest agent/tests/unit/`. Seed data: `agent/tests/fixtures/seed.sql`.
- In a worktree, format with `uv tool run ruff format` (not `uv run …`).

## Runtime call-path

User text → `RuntimeAPI.handle()` → `run_animichi_agent()` → `animichi_agent.run()` → tools →
`AgentResult` → `agent_result_to_response()` → `PublicAPIResponse`. `selected_point_ids` bypasses the
agent via `execute_selected_route()`.

- Entry: `agent/interfaces/fastapi_service.py` → `public_api.py` → `agents/animichi_runner.py`.
- Agent constructor: `build_animichi_agent()`; PydanticAI name: `animichi`.
- Shared types: `agent/agents/models.py`, `agent/agents/agent_result.py`.

## PydanticAI 2.9.1 composition

- Tools are constructor-injected from typed `TOOLS` lists in `animichi_tools.py` / `web_tools.py`.
  Registration no longer depends on import order.
- Modern hooks: `before_model_request` idempotently injects session/locale context;
  `on.run_error` records telemetry and re-raises.
- `web_search` + `translate_anime_title` are deferred tools selected by keyword `ToolSearch`.
- `ANIMICHI_MODERN_COMPOSITION=0` is the one-switch rollback to eager tools/dynamic instructions.
- ManagedPrompt is default-off and needs all four gates: modern composition,
  `ANIMICHI_MANAGED_PROMPT=1`, `LOGFIRE_TOKEN`, and `LOGFIRE_API_KEY`; otherwise local instructions win.

## Tools (`agents/animichi_tools.py` — typed `TOOLS` list with `ModelRetry` guards)

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

- Unit tests are hermetic: the autouse fixture sets `pydantic_ai.models.ALLOW_MODEL_REQUESTS=False`
  and installs test models/keys. `.env` is not needed for `make test`; it is needed for live evals.
- `MIMO_API_KEY` is selected by `_resolve_api_key()` in `agents/base.py` only for
  `xiaomimimo.com` model endpoints; do not reuse a generic key by accident.
- Official eval entry: `agent/tests/eval/run_agent_eval.py`. It streams one status line per case,
  persists reports, creates/enforces statistical baselines, and exits nonzero on gate regression or
  all-error runs. Never refresh a baseline merely to pass a gate.
- Integration/eval suites that import `pg_container` (`agent/tests/conftest_db.py`) need a
  **Docker-compatible runtime** (Docker / Colima on Mac) and use **testcontainers PostGIS**
  (`postgis/postgis:16-3.4`). `SUPABASE_DB_URL` / `supabase start` alone is NOT sufficient for those
  suites. Unit tests need no Docker.

## TDD: invoke `/backend-tdd` before writing Python.

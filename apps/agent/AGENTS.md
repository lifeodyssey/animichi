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
`AgentResult` → `agent_result_to_response()` → `PublicAPIResponse`. Point and candidate selections
bypass the model through `execute_selected_route()`, `execute_multi_selection()`, or
`execute_place_selection()`.

- Entry: `agent/interfaces/fastapi_service.py` → `public_api.py` → `agents/animichi_runner.py`.
- Shared types: `agent/agents/models.py`, `agent/agents/agent_result.py`.

## Tools and outputs

Four catalog data tools live in `agents/animichi_tools.py`; two web-facing tools live in
`agents/web_tools.py`. Catalog tools return discriminated outcomes and record current-turn
provenance. They never ingest data or call anime APIs directly.

| Tool | Description |
|---|---|
| `resolve_anime` | Resolve a title through the catalog Worker into a typed match/clarify outcome |
| `search_bangumi` | Fetch published points for an explicit `bangumi_id` |
| `search_nearby` | Resolve a place and fetch published nearby points through the catalog Worker |
| `plan_route` | Ask the catalog Worker to route one explicit search-result reference |
| `web_search` | Attributed web research for QA and title enrichment only |
| `translate_anime_title` | Resolve or translate an anime title without adding pilgrimage data |

The model emits exactly one of five typed outputs: `ClarifyResponseModel`, `SearchResponseModel`,
`RouteResponseModel`, `GreetingResponseModel`, or `QAResponseModel`. The runner alone may produce
`PartialResponseModel` and `BlockedResponseModel`; neither is part of the model `output_type`.

## Trust boundary

- Single PydanticAI agent (`animichi_agent`) with five typed model outputs; deterministic selection
  paths bypass it.
- Pydantic tool schemas constrain model arguments; `output_validator` rejects fabricated output or
  provenance that was not produced by the current turn.
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

## Eval: cost, run recipe, and the post-redesign baseline (2026-07-17)

**Model + cost.** The eval model is MiMo `mimo-v2.5` (`openai:mimo-v2.5@https://api.xiaomimimo.com/v1`,
credential `MIMO_API_KEY`; thinking param OFF — pinned in `config/model_aliases.py`).
MiMo pay-as-you-go (permanent rate since 2026-05-27): **$1 / M input, $3 / M output, $0.20 / M cached input**.

Measured full run (655 cases, trajectory tier, ~21 min): **6.40 M input + 0.31 M output tokens, 2,341 requests**
→ **≈ $3–7 per full run** ($7.3 worst-case with zero cache credit; ~$3 at the observed ~85–90 % cache-hit rate).
A 50-case subset ≈ **$0.3–0.6**. Pre-redesign the same run cost ~8–10× (request thrash: 27–50 requests/case).
Run it freely at milestones; don't hoard it.

**Run recipe.**
```bash
cd apps/agent && uv run python -m agent.tests.eval.run_agent_eval \
  --eval-model "openai:mimo-v2.5@https://api.xiaomimimo.com/v1"   # full 655
EVAL_MAX_CASES=50 uv run python -m agent.tests.eval.run_agent_eval ...  # capped = report-only, no baseline/gate
```
Direct thrash gates (req≤12 / tool≤6 / repeat=0 / p95≤6) are **report-only** until `DIRECT_GATE_ENFORCE=1`
(owner calibrates first). Capped runs never read/write baselines.

**Post-redesign full-655 numbers (2026-07-17, the re-baseline candidate — NOT yet the committed baseline;
the owner signs off per the redesign spec §7):**

| Metric | Old baseline (n=643, pre-redesign) | Full 655 (post-redesign) |
|---|---|---|
| request p95 / case | 27–50 (thrash) | **7** |
| tool_recall | 0.800 | 0.855 |
| tool_f1 | 0.763 | 0.817 |
| route_order_correct | 0.768 | 0.798 |
| locale_match | 0.540 | 0.739 |
| step_efficiency | 0.811 | 0.802 |
| nonempty_results | 0.846 | 0.769 * |

\* the nonempty evaluator was rewritten in the re-baseline (reads the produced route's `source_ref`) —
not apples-to-apples with the old contract; 15/655 errored cases (~2.3 %) also drag it. The `*_official`
N2 metrics (tool_correctness 0.522, trajectory_match 0.694, max_tool_calls 0.769, argument_correctness 0.641)
have no pre-redesign baseline. Per-case results land in `agent/tests/eval/results/`.

## TDD: invoke `/backend-tdd` before writing Python.

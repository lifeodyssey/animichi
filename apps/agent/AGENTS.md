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
`AgentResult` → `agent_result_to_response()` → `PublicAPIResponse`. Point and candidate selections
bypass the model through `execute_selected_route()`, `execute_multi_selection()`, or
`execute_place_selection()`.

- Entry: `agent/interfaces/fastapi_service.py` → `public_api.py` → `agents/animichi_runner.py`.
- Agent constructor: `build_animichi_agent()`; PydanticAI name: `animichi`.
- Shared types: `agent/agents/models.py`, `agent/agents/agent_result.py`.

## PydanticAI 2.9.1 composition

- Tools are constructor-injected from typed `TOOLS` lists in `animichi_tools.py` / `web_tools.py`.
  Registration no longer depends on import order.
- The `on.run_error` hook records telemetry and re-raises. Session/locale state is serialized by
  `trusted_session_context()` instead of the pre-redesign `before_model_request` hook.
- `web_search` + `translate_anime_title` are regular constructor-injected tools; the pre-redesign
  keyword `ToolSearch` deferral and `ANIMICHI_MODERN_COMPOSITION` rollback switch are retired.
- ManagedPrompt is default-off and needs all three gates: `ANIMICHI_MANAGED_PROMPT=1`,
  `LOGFIRE_TOKEN`, and `LOGFIRE_API_KEY`; otherwise local instructions win.

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
  Leave `trust_env` at httpx's default (`True`) for this **shared lifespan client** so proxy/CA env
  vars are respected. **This does not apply to BYOK/egress-guarded clients** (#284 Task 1/T13):
  those must be built via `egress_transport.build_guarded_async_client`, which sets
  `trust_env=False` and no `mounts`/proxy on purpose — a proxy env var would silently defeat the
  connect-time IP pinning that closes the DNS-rebinding/TOCTOU window (T4) and the redirect-bypass
  window (T5). **T12 note:** the guarded factory is the *only* sanctioned way to build an
  outbound HTTP client for a user-influenceable destination (BYOK `base_url`, and any future
  user-controlled egress) — any new outbound call site that constructs its own `httpx.AsyncClient`
  instead of going through the factory recreates the SSRF/T13 bypass this convention exists to
  close. See `docs/ops/cloudflare-hardening.md` §6 for why this code-review convention, not a
  container network policy, is the actual enforcement point for T12.
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
- DB-backed pytest suites select one arm in this order: `TEST_DATABASE_URL` (BYO), explicit
  `TEST_DB=docker|neon`, then the offline Docker default. The offline arm needs Docker/Colima, the
  cached `animichi-test-postgres` image, and Atlas 0.30.0; `TEST_DB=neon` additionally needs
  `NEON_API_KEY` + `NEON_PROJECT_ID`. BYO mutation requires `TEST_DB_ALLOW_MUTATION=1` and rejects
  protected Neon lineage. The standalone full-stack eval runner accepts `TEST_DATABASE_URL` only.
- `supabase start` is reserved for GoTrue-coupled magic-link E2E and auth development; it does not
  provision the agent integration-test database. Unit tests need neither Docker nor network.

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
Direct thrash gates (req≤12 / tool≤10 / repeat=0 / p95≤8 — `agent/tests/eval/direct_gates.py`) are
**report-only** until `DIRECT_GATE_ENFORCE=1` (owner calibrates first). Capped runs never read/write baselines.

**CI tiering (SD-30, #228/#227).** `EVAL_SMOKE=1` turns a capped run from report-only into an
enforced L0 gate: zero-errored cases + the deterministic direct thrash gates (unconditionally,
independent of `DIRECT_GATE_ENFORCE`) — it still never reads or writes the baseline. CI wires this
as `agent-eval-smoke` in `ci.yml` (`EVAL_SMOKE=1 EVAL_MAX_CASES=80`, required on PRs that touch
`agents/**` or `config/model_aliases.py`). The uncapped L1 suite — owning the statistical baseline
via `finish_cli_report`/`gate.py` — runs nightly + on `workflow_dispatch` only, in the standalone
`agent-eval-nightly.yml` (never on PRs, so its cron cadence doesn't ride along with the PR/push
matrix in `ci.yml`).

**Post-redesign full-655 numbers (2026-07-17, the re-baseline candidate — NOT yet the committed baseline;
the owner signs off per the redesign spec §7):**

| Metric | Full 655 pre-switch calibration |
|---|---|
| request p95 / case | **7** |
| argument_correctness | 0.641 |
| tool_correctness | 0.522 |
| trajectory_match | 0.694 |
| max_tool_calls | 0.769 |
| data_keys_present | 0.769 |
| locale_match | 0.739 |
| nonempty_results | 0.769 * |
| step_efficiency | 0.802 |

\* the nonempty evaluator was rewritten in the re-baseline (reads the produced route's `source_ref`) —
not apples-to-apples with the old contract; 15/655 errored cases (~2.3 %) also drag it. The table is
calibration-only: the official-first switch changes metric semantics and requires a fresh uncapped
baseline. Per-case results land in `agent/tests/eval/results/`.

## TDD: invoke `/backend-tdd` before writing Python.

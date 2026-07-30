# Architecture

> **Visual companion:** [architecture-diagrams.md](./architecture-diagrams.md) — 5 agent-scoped Mermaid diagrams: the agent and its direct dependencies, one turn end to end, the typed tool-outcome contract, the model layer, session state & multi-turn selection.


## Overview

```
User text → RuntimeAPI.handle() → run_animichi_agent() → animichi_agent.run()
  → catalog/web tools → AgentResult (typed output + steps + SessionState)
  → agent_result_to_response() → PublicAPIResponse

For deterministic selections:
  User selection → execute_selected_route() → AgentResult → PublicAPIResponse
  Clarify choice → execute_multi_selection() / execute_place_selection()
    → AgentResult → PublicAPIResponse
```

Entry path: `HTTP service → RuntimeAPI → run_animichi_agent() → animichi_agent.run()`

No hardcoded anime list. DB is source of truth.

## Request Modes — `interfaces/schemas.py`

`PublicAPIRequest` accepts exactly one runtime mode per turn: user `text`, direct
`selected_point_ids`, or `selected_candidate_ids` paired with a `clarification_id`. Candidate and
point selections are deterministic server paths and do not invoke the model.

## AgentResult — `agents/agent_result.py`

```python
@dataclass
class StepRecord:
    tool: str
    success: bool
    params: dict[str, object]
    data: dict[str, object] | None
    provenance: StepProvenance | None
    error: str | None = None

@dataclass
class AgentResult:
    output: AgentResultOutput
    steps: list[StepRecord]
    session_state: SessionState
```

Carries the typed terminal, every tool/server step, the authoritative typed session registry, and
current-turn provenance used by response projection and persistence.

## Pilgrimage Agent — `agents/animichi_agent.py`

- PydanticAI `Agent` whose `output_type` contains exactly `ClarifyResponseModel`,
  `SearchResponseModel`, `RouteResponseModel`, `GreetingResponseModel`, and `QAResponseModel`
- System prompt describes available tools; no hardcoded anime IDs
- `output_validator` rejects responses not backed by the current turn's typed provenance
- For any anime query: the agent calls `resolve_anime` first, then downstream tools
- `PartialResponseModel` and `BlockedResponseModel` are server-only runner terminals and are not
  model output types

## Tools — `agents/animichi_tools.py` + `agents/web_tools.py`

- Four catalog tools are registered from `animichi_tools.py`; two web tools come from `web_tools.py`
- Pydantic tool schemas constrain model-supplied parameters
- Tools access typed runtime dependencies via `RunContext`

### Tool registrations

| Tool | Notes |
|---|---|
| `resolve_anime` | Resolve a title through the catalog Worker and stage identity/clarification state |
| `search_bangumi` | Query catalog points for the resolved `bangumi_id` |
| `search_nearby` | Query catalog points by place name or caller coordinates |
| `plan_route` | Ask the catalog Worker to route an explicit search-result reference |
| `web_search` | Attributed web research for QA/title enrichment, never pilgrimage discovery |
| `translate_anime_title` | Catalog-backed or tool-less title translation |

## Runner — `agents/animichi_runner.py`

- `run_animichi_agent(...)` — runs the agent and collects typed steps/state into `AgentResult`
- Converts usage exhaustion to `PartialResponseModel` and enabled input-guard refusals to
  `BlockedResponseModel`
- Single entry point for the runtime API

## Selected Route — `agents/selected_route.py`

- `execute_selected_route(...)` — direct selected-point route execution without invoking the model
- `execute_multi_selection(...)` and `execute_place_selection(...)` consume validated clarify cards
  without invoking the model
- Returns `AgentResult` for consistency with the main path

## Retrieval — `agents/catalog_tools.py`

The four catalog data tools call the catalog Worker through `CatalogClientProtocol`. The agent has
no local retriever, handler registry, SQL route planner, or direct Anitabi/Bangumi request path.

## Public API — `interfaces/public_api.py`

- Stable request/response facade over `run_animichi_agent()` / `execute_selected_route()`
- Adds `ui: UIDescriptor` field to response
- Writes to `request_log` after every response (best-effort, never raises)
- Session persistence + route history

## HTTP Service — `interfaces/fastapi_service.py`

FastAPI. Main endpoints: `GET /healthz`, `POST /v1/runtime`, `POST /v1/runtime/stream` (SSE), `POST /v1/feedback`, `GET /v1/conversations`, `PATCH /v1/conversations/{id}`, `GET /v1/routes`, `GET /v1/bangumi/popular`, `GET /v1/bangumi/nearby`. Auth is NOT enforced here — it is enforced upstream in the CF Worker.

## Response Contract

```typescript
interface UIDescriptor {
  component: string   // e.g. "PilgrimageGrid"
  props: Record<string, unknown>
}

interface PublicAPIError {
  code: string
  message: string
  details: Record<string, unknown>
}

interface PublicAPIResponse {
  success: boolean
  status: string
  intent: string
  session_id: string | null
  message: string
  data: Record<string, unknown>
  session: Record<string, unknown>
  route_history: Array<Record<string, unknown>>
  errors: PublicAPIError[]
  ui?: UIDescriptor
  debug?: Record<string, unknown>
}
```

## Catalog Ownership

The agent is a read-only catalog consumer. `resolve_anime`, pilgrimage search, geocoding, and route
planning all go through the catalog Worker. Catalog ingest/enrichment/publish jobs own Anitabi and
Bangumi access and decide which works are available; the runtime request path never grows the
catalog on demand.

## Auth Layer — `worker/app.ts` + `worker/auth.ts`

The CF Worker establishes an identity before proxying to the container. It always strips
client-supplied `X-User-Id` / `X-User-Type` and re-injects the worker-verified values, so the
container can trust those headers unconditionally.

- `Authorization: Bearer <jwt>` → verified against the issuer JWKS (`jose`) → `X-User-Type: human`
- `Authorization: Bearer sk_<hex>` → SHA-256 hash → lookup `api_keys` table → `X-User-Type: agent`
- No credentials, on the anonymous allowlist → `X-User-Type: anonymous` (see below)
- No credentials, anywhere else → 401
- `/healthz`, the public catalog/`/v1` allowlist, and static assets bypass auth entirely

API keys: stored as SHA-256 hash in `api_keys` table. Raw key shown once at creation.

### Anonymous access (X5, implemented in S1.8 / issue #274)

X5 previously described this as forward-looking; it is now the implemented state. `/v1/chat` is
open to callers with no session:

- **Identity** — the edge mints a random id, HMAC-signs it with `ANON_ID_SECRET`, and returns it as
  an opaque HttpOnly `aid` cookie. The container sees it as `X-User-Id: anon_<hex>` with
  `X-User-Type: anonymous`. A brand-new visitor is issued one on the spot; there is no
  minimum-history threshold. A forged or wrongly-signed cookie is discarded, not trusted.
- **Opt-in** — anonymous access stays off unless both `ANON_ACCESS_ENABLED=true` and
  `ANON_ID_SECRET` are set; otherwise `/v1/chat` keeps its 401.
- **Rate limiting** — `worker/rateLimiter.ts` applies a per-identity fixed window
  (`ANON_RATE_LIMIT` / `ANON_RATE_LIMIT_WINDOW_SECONDS`) backed by the `EDGE_GUARD` Durable
  Object, one shard per identity. Exceeding it returns a 429 the client renders as in-character
  "少し待ってね" copy.
- **Daily-budget circuit breaker (X4)** — every runtime turn banks its `RunUsage` into the
  `daily_usage` table, partitioned by scope (`anon` / `user` / `byok`). The **container ingress**
  is the authoritative tier: it compares today's `anon` spend with `ANON_DAILY_COST_BUDGET_USD`
  and rejects with 403 `anon_budget_exhausted`, which the client renders as login guidance.
  Logged-in traffic is never gated. The edge caches that verdict in a same-UTC-day latch so
  subsequent anonymous requests short-circuit without a container round-trip; the latch expires
  at the day boundary. The edge never reads `daily_usage` itself.
- **Per-identity daily message quota (S1.10, issue #282)** — a fairness/UX mechanism, not a
  security defense line: the container ingress atomically increments a durable
  `anon_daily_message_count` row keyed `(usage_date, anon_id)` and rejects with 403
  `anon_quota_exhausted` (+ `quota_resets_at`, the next UTC midnight) once that one identity's own
  `ANON_DAILY_MESSAGE_QUOTA` is spent, so a single visitor's free usage stays reasonable while the
  shared budget above stays open for everyone else. `0` or unset disables it. Runs only after the
  budget breaker above allows the turn — the global dollar ceiling is the more severe, systemic
  concern and wins ties over one visitor's own message ceiling. Logged-in traffic is never gated.

## Web App

The browser surface is `apps/web/` (TanStack Start, deployed as its own Cloudflare Worker).
Its layout, routing, design tokens, and auth wiring are documented in `apps/web/AGENTS.md` —
that package is the source of truth, not this file.

Issue #537 deleted the legacy `frontend/` Next.js package and the root Worker's OpenNext
fallback with it. The root Worker (`worker/app.ts`) is now an API gateway only: `/v1/*`,
`/v1/users/*`, `/healthz`, `/img/*`, one allowlisted public catalog read, and a JSON
`404 not_found` for everything else. It serves no HTML.

## Eval Infrastructure

| Path | Purpose |
|---|---|
| `supabase/migrations/20260402124000_operational_tables.sql` | Logs every request: plan_steps, intent, latency_ms |
| `tests/eval/datasets/plan_quality_v1.json` | 50+ cases × 3 locales |
| `tests/eval/test_plan_quality.py` | pydantic_evals harness; uses animichi_agent; Iter 3 gate: ≥ baseline + 10pp |
| `tools/eval_scorer.py` | Batch LLM judge; writes `plan_quality_score` back to DB |
| `tools/eval_feedback_miner.py` | Mines `feedback(rating='bad')` → LLM prompt suggestions |
| `clients/python/seichijunrei_client.py` | Sync/async Python client for agent/CLI use |

## Design Rules

- One agent: `animichi_agent` (PydanticAI) with typed output and `output_validator`
- Tools registered via `@agent.tool` with `ModelRetry` guards for parameter validation
- Selected-route path bypasses the agent entirely (`execute_selected_route`)
- Retrieval is structured-first — no semantic/vector search
- DB is source of truth for anime catalog — no hardcoded lists
- Auth is enforced at the CF Worker edge — container is not auth-aware

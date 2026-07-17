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

## Auth Layer — `worker/worker.js`

CF Worker validates credentials before proxying to the container:

- `Authorization: Bearer <supabase_jwt>` → call `SUPABASE_URL/auth/v1/user`
- `Authorization: Bearer sk_<hex>` → SHA-256 hash → lookup `api_keys` table
- Sets `X-User-Id` + `X-User-Type` on forwarded request
- `/healthz` and static assets bypass auth

API keys: stored as SHA-256 hash in `api_keys` table. Raw key shown once at creation.

## Frontend Auth — `frontend/components/auth/AuthGate.tsx` + `frontend/app/auth/callback/page.tsx`

Both frontend Supabase clients use `flowType: 'implicit'`. This is intentional:

- Magic links redirect to `/auth/callback/#access_token=...` (hash fragment)
- `getSession()` on the callback page extracts the session from the hash automatically
- Works regardless of which browser opens the magic link (no `code_verifier` in localStorage required)

PKCE (`flowType: 'pkce'`) was the previous default but failed cross-browser: the verifier stored in browser A is not available when the email link opens in browser B.

## Frontend Architecture

### Three-Column Layout

```
┌─────────┬──────────────────┬──────────────────────┐
│ Sidebar │ Chat Panel 360px │ Result Panel flex-1  │
│ 240px   │                  │                      │
│ History │ user messages    │ GenerativeUIRenderer │
│ New     │ bot: text only   │ (active result)      │
│         │ + ◈ anchor cards │                      │
│         │ [input]          │ empty: faint map bg  │
└─────────┴──────────────────┴──────────────────────┘
```

`◈` anchor click sets `activeMessageId` in AppShell → drives `ResultPanel`. On mobile: opens `ConversationDrawer` (vaul bottom sheet) or `ResultSheet`.

### Generative UI Registry

```typescript
// frontend/components/generative/registry.ts
export const COMPONENT_REGISTRY: Record<string, ComponentRenderer> = {
  PilgrimageGrid:     ...,  // search results grid
  NearbyMap:          ...,  // geo-based nearby map
  RouteVisualization: ...,  // route display
  RoutePlannerWizard: ...,  // route planning wizard
  GeneralAnswer:      ...,  // QA text response
  Clarification:      ...,  // disambiguation UI
}
```

Adding a new component: register in `COMPONENT_REGISTRY` only. No routing changes.

### Locale Detection

Locale is detected client-side from `localStorage` (key `locale`) via `lib/i18n.ts detectLocale()`. Supported values: `ja`, `zh`, `en` (default: `ja`). There is no URL-based locale routing (no `app/[lang]/` path segments).

Design tokens: see `frontend/AGENTS.md`.

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
- Frontend component additions require only a registry entry
- Auth is enforced at the CF Worker edge — container is not auth-aware

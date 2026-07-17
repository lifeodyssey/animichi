# Agent Architecture Diagrams

Visual companion to [ARCHITECTURE.md](./ARCHITECTURE.md), scoped to the **agent
service** (`apps/agent`), drawn against the post-redesign state of PR #349.
Every edge and label below is verified against the code at HEAD.

- [1. The agent and its direct dependencies](#1-the-agent-and-its-direct-dependencies)
- [2. One turn end to end](#2-one-turn-end-to-end)
- [3. The typed tool-outcome contract](#3-the-typed-tool-outcome-contract)
- [4. Model layer](#4-model-layer)
- [5. Session state and multi-turn selection](#5-session-state-and-multi-turn-selection)

---

## 1. The agent and its direct dependencies

The agent is a FastAPI app in a Cloudflare Container. Auth lives at the edge
Worker; the container trusts the forwarded `X-User-Id`.

```mermaid
flowchart TD
    EDGE["Cloudflare Worker - worker/entry.ts<br/>strips Authorization, injects X-User-Id<br/>routes /v1 to the container"]

    subgraph AGENT["Agent service - apps/agent"]
        API["FastAPI 0.139 + uvicorn, Python 3.13<br/>lifespan owns the catalog client and<br/>one shared model httpx client"]
        RUNTIME["RuntimeAPI - public_api.py<br/>dispatch, translation gate, persistence"]
        RUNNER["run_animichi_agent - animichi_runner.py<br/>injection preflight, usage limits,<br/>partial and blocked terminals"]
        PAI["animichi agent - pydantic-ai 2.9.1<br/>6 tools, 5 typed outputs, output validator"]
    end

    CAT["Catalog Worker - workers/catalog<br/>typed oRPC contract - packages/contract<br/>resolve, pointsByWorkId, route, geocode"]
    PG[("Supabase Postgres + PostGIS<br/>sessions, messages, routes + route_anime<br/>via asyncpg")]
    LLM["MiMo mimo-v2.5 - prod primary<br/>OpenAI SDK, header X-App-Client<br/>DeepSeek fallback dormant"]
    DDG["DuckDuckGo - web_search tool<br/>output wrapped as untrusted"]
    OBS["Logfire<br/>service animichi-runtime,<br/>environment = app_env"]

    EDGE -->|"POST /v1/runtime, /v1/runtime/stream, /v1/chat"| API
    API --> RUNTIME --> RUNNER --> PAI
    PAI -->|"oRPC over HTTP"| CAT
    RUNTIME -->|asyncpg| PG
    PAI --> LLM
    PAI --> DDG
    AGENT --> OBS
```

Endpoints (`interfaces/routes/`): `POST /v1/runtime` (JSON), `POST
/v1/runtime/stream` (SSE step events), `POST /v1/chat` (Vercel AI protocol
adapter over the same RuntimeAPI), plus read-only conversations/routes/bangumi
routes and `/healthz`.

---

## 2. One turn end to end

Dispatch order and the graceful terminals, exactly as `public_api.py` and
`animichi_runner.py` implement them.

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant API as RuntimeAPI
    participant R as Runner
    participant A as Agent model loop
    participant T as Tools
    participant RB as ResponseBuilder
    participant DB as Persistence

    C->>API: text, locale, session_id, optional selection fields
    API->>API: hydrate SessionState from the envelope key
    alt selected_point_ids present
        API->>API: execute_selected_route - no model
    else selected_candidate_ids present
        API->>API: dispatch by pending reason - no model<br/>anime_ambiguity to execute_multi_selection<br/>place_ambiguity to execute_place_selection
    else normal turn
        API->>R: run_animichi_agent
        R->>R: injection preflight - always logged,<br/>blocks only when ANIMICHI_INPUT_GUARD=1
        alt blocked
            R-->>API: BlockedResponseModel - zero model tokens
        else clean
            R->>A: agent.run with trusted context
            loop typed outcome loop - median 2 tool calls
                A->>T: tool call
                T-->>A: discriminated outcome - row_count plus ref,<br/>rows go to the SessionState registry
            end
            A-->>R: ONE typed output - allows_text is False
            R->>R: validate_output - anti-fabrication,<br/>clarify transition table, current-turn refs
            Note over R: UsageLimitExceeded becomes PartialResponseModel
        end
        R-->>API: AgentResult - output, intent, session_state,<br/>steps with TurnProvenance, usage
    end
    API->>RB: agent_result_to_response
    RB->>RB: project data.results and data.route from<br/>THIS turn provenance only - never registry recency
    API->>DB: envelope snapshot, messages, route + route_anime
    API-->>C: 200 for success AND graceful terminals -<br/>clarify, partial, blocked, empty, too_large.<br/>400 invalid_selection. 500 only for real faults.
```

---

## 3. The typed tool-outcome contract

The thrash fix: tools return **discriminated outcomes** computed in the data
layer; the model only branches on them. The routing edges below quote the
agent's actual instruction table (`animichi_agent.py`, `_INSTRUCTIONS`).
`str` is not in the output union, so a run cannot end in prose.

```mermaid
flowchart LR
    subgraph TOOLS["Tools - pydantic-ai Tool with timeouts"]
        RA["resolve_anime"]
        SB["search_bangumi"]
        SN["search_nearby"]
        PR["plan_route"]
        WS["web_search - QA prose only,<br/>wrapped untrusted, source tiers"]
        TT["translate_anime_title -<br/>catalog title_cn, tool-less LLM"]
    end

    subgraph OUTCOMES["Discriminated outcomes - tool_outcomes.py"]
        RES["Resolve: resolved,<br/>needs_disambiguation,<br/>not_found, upstream_unavailable"]
        SEA["Search: ok with partial flag,<br/>empty with partial flag,<br/>upstream_unavailable"]
        NEA["Nearby: ok, empty,<br/>place_ambiguity, place_unresolved,<br/>missing_location"]
        ROU["Route: ok, empty,<br/>stale_ref, pending_sync"]
    end

    subgraph OUT["Model outputs - exactly 5, no str"]
        SR["search_response"]
        RR["route_response"]
        CR["clarify_response - terminal,<br/>must echo the exact pending<br/>candidate set"]
        GR["greeting_response"]
        QR["qa_response"]
    end

    subgraph SRV["Server-only outputs - model can never emit"]
        PART["PartialResponseModel -<br/>usage limit reached"]
        BLK["BlockedResponseModel -<br/>injection preflight"]
    end

    RA --> RES
    SB --> SEA
    SN --> NEA
    PR --> ROU

    RES -->|resolved| SB
    RES -->|needs_disambiguation, not_found| CR
    RES -->|upstream_unavailable| QR
    SEA -->|ok| SR
    SEA -->|"empty - partial true means still syncing,<br/>never assert no points exist"| SR
    SEA -->|upstream_unavailable| QR
    NEA -->|"ok, empty"| SR
    NEA -->|"place_ambiguity, place_unresolved,<br/>missing_location"| CR
    ROU -->|ok| RR
    ROU -->|"stale_ref - re-run the search"| SB
    ROU -->|"pending_sync - catalog still syncing"| SR
```

The validator enforces the contract from the other side: a `search_response`
or `route_response` is rejected unless THIS turn recorded a matching Produced
step; a `clarify_response` must match the pending reason and candidate ids
exactly. `route empty` has no instructed output route - the validator simply
refuses a `route_response` for it.

---

## 4. Model layer

Verified values from `config/settings.py`, `config/model_aliases.py`,
`agents/base.py`.

```mermaid
flowchart TD
    REQ["caller model string"] --> GATE{"resolve_model_alias<br/>fullmatch a-z 0-9 _ - BEFORE lookup"}
    GATE -->|unknown or URL-like| ERR["400 ModelAliasError"]
    GATE -->|default| DEF["get_default_model"]
    GATE -->|mimo or deepseek| REG["MODEL_ALIASES registry -<br/>immutable, validated at import,<br/>duplicate effective models rejected"]

    DEF --> PRIM["PRIMARY openai mimo-v2.5<br/>base_url api.xiaomimimo.com/v1<br/>credential MIMO_API_KEY via get_settings<br/>thinking param OFF, max_retries 0"]
    DEF -.->|"fallback_agent_model is empty -<br/>MiMo-only, DeepSeek dormant"| FBK["FallbackModel mimo then deepseek -<br/>re-enable is one env line"]

    subgraph TRANSPORT["Transport"]
        CL["one shared httpx AsyncClient<br/>trust_env true, owned by the FastAPI<br/>lifespan - including the model=None path"]
        HD["default header<br/>X-App-Client animichi Prod, Staging or Dev"]
        TM["model_attempt_timeout 45s under<br/>agent_deadline 100s -<br/>validator enforces two attempts fit"]
    end

    PRIM --> CL
    REG --> CL
    CL --> HD
    CL --> TM
```

Credential routing is one policy: `xiaomimimo.com` uses `MIMO_API_KEY`,
`deepseek.com` uses `DEEPSEEK_API_KEY`, anything else uses
`OPENAI_COMPAT_API_KEY` - all read through `get_settings()`.
`validate_required_env` hard-fails at startup on whatever the resolved
default and fallback actually need.

---

## 5. Session state and multi-turn selection

```mermaid
flowchart TD
    subgraph TURN["During a turn"]
        REGY["SessionState registry<br/>search_results maps ResultRef to rows and partial flag<br/>routes maps RouteRef to ordered points<br/>LRU-tracked, evictable refs"]
        PEND["PendingClarification<br/>reason, candidate_ids,<br/>ordered_candidates, revision"]
        PROV["TurnProvenance from steps -<br/>Produced or Rejected, Search or Route -<br/>what THIS turn actually did"]
    end

    PROJ["response_builder projects data.results<br/>and data.route from provenance refs only -<br/>a prior turn ref can never leak"]
    REGY --> PROJ
    PROV --> PROJ

    subgraph SAVE["Persisted per turn"]
        ENV["session envelope - ONE key<br/>session_state_v2 full snapshot,<br/>interactions stay pure history"]
        MSGS["messages - user and assistant,<br/>including clarify, partial and blocked turns"]
        RTBL["routes table + route_anime join table"]
    end

    REGY --> ENV
    PROJ --> MSGS
    PROJ --> RTBL

    subgraph NEXTTURN["Next request"]
        HYD["hydrate - envelope first,<br/>legacy interaction scan as fallback"]
        Q1{"selected_point_ids?"}
        Q2{"selected_candidate_ids<br/>plus clarification_id?"}
        SELR["execute_selected_route - no model"]
        DISP["dispatch by pending reason - no model<br/>anime_ambiguity to execute_multi_selection<br/>place_ambiguity to execute_place_selection"]
        NORM["normal agent turn"]
    end

    ENV --> HYD --> Q1
    Q1 -->|yes| SELR
    Q1 -->|no| Q2
    Q2 -->|"yes - revision must match"| DISP
    Q2 -->|no| NORM

    DISP --> TERM["multi-selection terminals - selection.py<br/>merged route on success -<br/>empty, error, partial, too_large otherwise -<br/>typed, never a crash, pending preserved<br/>on non-success"]
```

Multi-selection semantics (`selection.py`): fetch all selected works in
parallel, merge and dedupe by point id in selection order; any partial source
short-circuits to a `partial` terminal **before** the route call (preview
point ids are never routed); over 500 points or over 50 clusters returns
`too_large` without calling the route endpoint; all-empty keeps the pending
clarification so the user can pick again.

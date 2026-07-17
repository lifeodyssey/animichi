# Architecture Diagrams

Visual companion to [ARCHITECTURE.md](./ARCHITECTURE.md), drawn against the post-redesign
state of PR #349 (typed-outcome contract, MiMo-only prod model, demand-driven ingest).
Each diagram lists the concrete technology used by every part.

- [1. System topology](#1-system-topology-deployment-view)
- [2. Request lifecycle](#2-request-lifecycle-post-v1runtime)
- [3. The typed tool/outcome contract](#3-the-typed-tooloutcome-contract-the-thrash-fix)
- [4. Model layer](#4-model-layer-aliases-credentials-failover)
- [5. Session state & persistence](#5-session-state--persistence-multi-turn)
- [6. Catalog tiered read + demand-driven ingest](#6-catalog-tiered-read--demand-driven-ingest)
- [7. Eval & quality gates](#7-eval--quality-gates)

---

## 1. System topology (deployment view)

Everything enters through one Cloudflare Worker; the agent is a FastAPI app in a
Cloudflare Container; data services are split per service.

```mermaid
flowchart TD
    U["User / Browser"] --> EDGE

    subgraph CF["Cloudflare edge"]
        EDGE["worker/entry.ts<br/>(Hono router)<br/>auth: strips Authorization,<br/>injects X-User-Id"]
        FE["OpenNext frontend<br/>(Next.js SSR)"]
        CAT["Catalog Worker<br/>workers/catalog<br/>(Hono + oRPC contract)"]
        USR["Users Worker<br/>workers/users"]
    end

    subgraph CONTAINER["Cloudflare Container"]
        AGENT["Agent service<br/>FastAPI 0.139 / uvicorn / Python 3.13<br/>pydantic-ai 2.9.1 + pydantic 2.13<br/>structlog + logfire"]
    end

    subgraph DATA["Data"]
        SUPA[("Supabase Postgres + PostGIS<br/>agent data + catalog data<br/>(until hyperdrive)")]
        NEON[("Neon Postgres<br/>users data +<br/>preview branch-per-PR")]
    end

    subgraph EXT["External APIs"]
        MIMO["MiMo mimo-v2.5<br/>api.xiaomimimo.com<br/>PROD PRIMARY"]
        DS["DeepSeek v4-flash<br/>fallback (dormant,<br/>one-line re-enable)"]
        ANITABI["Anitabi<br/>pilgrimage points"]
        BGM["Bangumi API<br/>anime metadata"]
        DDG["DuckDuckGo<br/>web_search tool"]
    end

    OBS["Logfire<br/>service=animichi-runtime<br/>environment=app_env"]

    EDGE -->|"/v1/* → container<br/>(X-User-Id trusted)"| AGENT
    EDGE -->|"static + pages"| FE
    EDGE -->|"/v1/users/*"| USR
    AGENT -->|"oRPC typed contract<br/>packages/contract"| CAT
    AGENT -->|asyncpg| SUPA
    CAT -->|"drizzle +<br/>@neondatabase/serverless"| SUPA
    USR --> NEON
    CAT --> ANITABI
    CAT --> BGM
    AGENT -->|"OpenAI SDK<br/>X-App-Client: animichi Prod"| MIMO
    AGENT -.->|"FallbackModel<br/>(when re-enabled)"| DS
    AGENT --> DDG
    AGENT --> OBS
```

Key facts: the container trusts `X-User-Id` because the edge Worker owns auth;
`CONTAINER_REQUIRED_KEYS = [DEEPSEEK_API_KEY, MIMO_API_KEY, SUPABASE_DB_URL]` and a
deploy-consistency unit test asserts every required key is forwarded **and**
provisioned by `deploy.yml`.

---

## 2. Request lifecycle (`POST /v1/runtime`)

The happy path of one agent turn, including the guardrail preflight and the
graceful terminals.

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant W as CF Worker (Hono)
    participant API as RuntimeAPI<br/>(public_api.py)
    participant R as run_animichi_agent<br/>(animichi_runner.py)
    participant A as animichi agent<br/>(pydantic-ai, MiMo)
    participant T as Tools<br/>(catalog_tools / web_tools)
    participant CW as Catalog Worker
    participant RB as response_builder
    participant P as persistence

    C->>W: POST /v1/runtime {text, locale, session_id}
    W->>API: + X-User-Id (Authorization stripped)
    API->>API: restore SessionState (envelope session_state_v2)
    API->>R: dispatch (selection requests bypass the agent entirely)
    R->>R: injection PREFLIGHT: detect_prompt_injection(text)<br/>always logged; blocks (zero tokens) only if ANIMICHI_INPUT_GUARD=1
    R->>A: agent.run(trusted context + text)<br/>usage_limits, model_settings
    loop typed-outcome loop (median 2 tool calls)
        A->>T: tool call (resolve_anime / search_bangumi / ...)
        T->>CW: oRPC (resolve / pointsByWorkId / route / geocode)
        CW-->>T: rows / candidates / route
        T-->>A: DISCRIMINATED OUTCOME (never raw rows —<br/>row_count + result_ref; rows go to SessionState registry)
    end
    A-->>R: ONE typed output (allows_text=False —<br/>plain prose is impossible)
    R->>R: validate_output: anti-fabrication +<br/>clarify transition table + current-turn provenance
    Note over R: UsageLimitExceeded → PartialResponseModel (server-only)<br/>blocked preflight → BlockedResponseModel (server-only)
    R-->>API: AgentResult {output, intent, session_state,<br/>steps + TurnProvenance, usage}
    API->>RB: agent_result_to_response
    RB->>RB: project data.results / data.route from<br/>THIS TURN's provenance only (never registry recency)
    API->>P: persist (envelope snapshot, messages,<br/>route + route_anime join table)
    API-->>W: PublicAPIResponse
    W-->>C: 200 (success AND graceful terminals:<br/>clarify / partial / blocked / empty / too_large)<br/>400 invalid_selection · 500 only for real faults
```

---

## 3. The typed tool/outcome contract (the thrash fix)

The model never judges ambiguity and cannot loop: every tool returns a
**discriminated outcome** computed in the data layer, and the model's only job is
to pick one of five typed outputs. `str` is **not** in the output union
(`allows_text=False`), so a run cannot end in prose.

```mermaid
flowchart LR
    subgraph TOOLS["6 tools (pydantic-ai Tool, timeouts)"]
        RA["resolve_anime"]
        SB["search_bangumi"]
        SN["search_nearby"]
        PR["plan_route"]
        WS["web_search<br/>(QA-only, wrapped untrusted)"]
        TT["translate_anime_title<br/>(catalog title_cn / tool-less LLM)"]
    end

    subgraph OUT["Discriminated outcomes (tool_outcomes.py)"]
        RO["ResolveResolved ·<br/>ResolveAmbiguous ·<br/>ResolveNotFound ·<br/>ResolveUpstreamDown"]
        SO["SearchOk(partial) ·<br/>SearchEmpty(partial) ·<br/>SearchUpstreamDown"]
        NO["NearbyOk · NearbyEmpty ·<br/>NearbyPlaceAmbiguous ·<br/>NearbyPlaceUnresolved ·<br/>NearbyMissingLocation"]
        RTO["RouteOk · RouteEmpty ·<br/>RouteStaleRef ·<br/>RoutePendingSync"]
    end

    subgraph MODEL["Model output — RuntimeOutput union (exactly 5, no str)"]
        SR["SearchResponseModel"]
        RR["RouteResponseModel"]
        CR["ClarifyResponseModel<br/>(terminal — validated against<br/>PendingClarification, no retry loop)"]
        GR["GreetingResponseModel"]
        QR["QAResponseModel"]
    end

    subgraph SERVER["Server-only outputs (AgentResultOutput, model can NEVER emit)"]
        PART["PartialResponseModel<br/>(UsageLimitExceeded → graceful)"]
        BLK["BlockedResponseModel<br/>(injection preflight, zero tokens)"]
    end

    RA --> RO
    SB --> SO
    SN --> NO
    PR --> RTO
    RO -->|resolved| SB
    RO -->|ambiguous / not_found| CR
    SO --> SR
    NO -->|ok / empty| SR
    NO -->|place ambiguity /<br/>unresolved / missing| CR
    RTO -->|ok| RR
    RTO -->|empty / stale /<br/>pending_sync| SR

    V["output validator<br/>anti-fabrication: a Search/Route output requires a<br/>CURRENT-TURN Produced step; clarify must echo the<br/>exact pending candidate set"]
    MODEL --- V
```

Guardrails around this contract:

```mermaid
flowchart TD
    IN["user text"] --> PRE["runner preflight<br/>detect_prompt_injection (12 EN/JA/ZH patterns)"]
    PRE -->|"always"| LOG["log signal<br/>input_guardrail_injection_detected"]
    PRE -->|"hit + ANIMICHI_INPUT_GUARD=1<br/>(default OFF)"| BLK2["BlockedResponseModel<br/>zero model tokens"]
    PRE -->|clean or guard off| RUN["agent.run"]
    RUN --> WT["web tool returns wrapped:<br/>sanitize_untrusted + source tiers +<br/>instruction-is-data preamble"]
```

---

## 4. Model layer (aliases, credentials, failover)

```mermaid
flowchart TD
    REQ["request model param<br/>(caller string)"] --> GATE{"resolve_model_alias<br/>fullmatch [a-z0-9_-]+ BEFORE lookup<br/>unknown/URL → 400 ModelAliasError"}
    GATE -->|"default"| DEF["get_default_model()"]
    GATE -->|"mimo / deepseek"| ALIAS["MODEL_ALIASES registry<br/>(immutable, import-time validated,<br/>duplicate-effective-model rejected)"]

    DEF --> PRIME["PRIMARY: openai:mimo-v2.5<br/>@ api.xiaomimimo.com/v1<br/>cred: MIMO_API_KEY (via get_settings)<br/>thinking param: OFF (unverified perf tradeoff)<br/>max_retries=0"]
    DEF -.->|"fallback_agent_model=''<br/>(MiMo-only; DeepSeek dormant:<br/>402 no balance)"| FB["FallbackModel[mimo, deepseek]<br/>re-enable = one env line"]

    subgraph HTTP["Transport"]
        CLIENT["ONE shared httpx.AsyncClient<br/>trust_env=True, owned by FastAPI lifespan<br/>(model=None hot path included)"]
        HDR["default_headers:<br/>X-App-Client: animichi Prod|Staging|Dev"]
        TMO["model_attempt_timeout=45s<br/>&lt; agent_deadline=100s (validator-enforced:<br/>2 attempts + margin fit the wall)"]
    end

    PRIME --> CLIENT
    ALIAS --> CLIENT
    CLIENT --- HDR
    CLIENT --- TMO
```

Credential routing is a single policy: `xiaomimimo.com → MIMO_API_KEY`,
`deepseek.com → DEEPSEEK_API_KEY`, else `OPENAI_COMPAT_API_KEY` — all read through
`get_settings()`, never `os.environ` directly. `validate_required_env` hard-fails
at startup on any credential the resolved default/fallback actually needs.

---

## 5. Session state & persistence (multi-turn)

```mermaid
flowchart TD
    subgraph TURN["During a turn (RuntimeDeps.tool_state.session)"]
        REG["SessionState registry<br/>search_results: ResultRef → SearchPayloadState (rows, partial)<br/>routes: RouteRef → RoutePayloadState<br/>LRU-capped (8 refs)"]
        PEND["PendingClarification<br/>{reason, candidate_ids,<br/>ordered_candidates, revision}"]
        PROV["TurnProvenance (from steps)<br/>Produced/Rejected Search · Route<br/>= what THIS turn actually did"]
    end

    RB2["response_builder projects<br/>data.results / data.route from<br/>provenance refs ONLY<br/>(a stale registry ref can never leak)"]
    REG --> RB2
    PROV --> RB2

    subgraph PERSIST["Persisted per turn"]
        ENV["session envelope (ONE key)<br/>session_state_v2 = full snapshot<br/>(interactions carry pure history)"]
        MSG["messages (user + assistant —<br/>incl. clarify, partial, blocked turns)"]
        RT["routes + route_anime join table<br/>(normalized, FK CASCADE)"]
    end

    REG --> ENV
    RB2 --> MSG
    RB2 --> RT

    subgraph NEXT["Next turn"]
        HYD["envelope-first hydration<br/>(legacy fallback: scan interactions)"]
        SEL{"request carries<br/>selected_candidate_ids +<br/>clarification_id?"}
        DISPATCH["dispatch BY pending reason:<br/>anime_ambiguity → execute_multi_selection (T1–T7)<br/>place_ambiguity → execute_place_selection<br/>selected_point_ids → execute_selected_route<br/>— ALL bypass the model (deterministic)"]
    end

    ENV --> HYD
    HYD --> SEL
    SEL -->|yes + revision match| DISPATCH
    SEL -->|no| AGENTRUN["normal agent turn"]
```

The multi-selection terminal matrix: T1 single, T2 merge+dedup by point id,
T3 partial-failure merge, T4 all-empty (pending preserved), T5 all-failed,
T6 too-large (500 points / 50 clusters — typed, no route call),
T7 partial-sync (any preview source → results without routing).

---

## 6. Catalog tiered read + demand-driven ingest

`pointsByWorkId` — how an un-catalogued work gets data on first demand without
stampedes or unroutable rows.

```mermaid
flowchart TD
    Q["pointsByWorkId(work_id ^\d+$)"] --> PUB{"published rows?"}
    PUB -->|yes| HIT["return rows (partial absent)"]
    PUB -->|no| GUARD{"ingestGuard (ingest_jobs table)"}
    GUARD -->|in_progress| EP1["rows: [] + partial:true<br/>(no upstream call)"]
    GUARD -->|recently_attempted<br/>(failure &lt; 1h)| EP2["rows: [] + partial:true"]
    GUARD -->|"empty (not_found, 7d)<br/>ingest ran: upstream has nothing"| EP3["rows: [] (definitive)"]
    GUARD -->|ready| CLAIM{"claimIngest — atomic singleflight<br/>INSERT..ON CONFLICT..WHERE<br/>(running TTL 15min, stale reclaim)"}
    CLAIM -->|lost| EP1
    CLAIM -->|acquired| REREAD{"re-read published<br/>(TOCTOU heal)"}
    REREAD -->|rows now exist| DONE["markDone → return rows"]
    REREAD -->|still none| PREV["L1 preview by id<br/>(fetchAnitabiLite — winner only:<br/>N cold requests = 1 Anitabi call)"]
    PREV --> BG["waitUntil(ingestWork) —<br/>full fetch + enrich + publish<br/>(sync fallback in tests)"]
    BG --> RESP["return preview rows + partial:true"]

    RESP -.->|"agent side"| SAFE["SearchOk(partial=true) —<br/>plan_route on a partial ref →<br/>RoutePendingSync (preview IDs are<br/>NEVER sent to the route endpoint)"]
```

404 from Anitabi during ingest = `not_found` (7-day park), not a transient
failure — most works without an Anitabi page stop costing upstream calls.

---

## 7. Eval & quality gates

```mermaid
flowchart LR
    subgraph EVAL["Eval harness (pydantic-evals runner)"]
        DS2["655 cases<br/>agent_eval_v3 + runtime_journey<br/>+ D3 selection fixtures"]
        TRAJ["trajectory tier:<br/>NullDatabase + MockCatalogClient<br/>only the MODEL is real (MiMo default)"]
        MET["metrics: tool_recall/f1, route_order,<br/>locale, nonempty(source_ref),<br/>step_efficiency + official N2 set"]
    end

    subgraph GATES["Red-line gates"]
        DIRECT["direct thrash gates<br/>requests≤12 · tool_calls≤6 ·<br/>repeat=0 · p95≤6<br/>(model-initiated steps only)"]
        MODE{"DIRECT_GATE_ENFORCE"}
        REPORT["default OFF: report-only<br/>(baseline can be established)"]
        BLOCK2["=1 after owner calibration:<br/>merge-blocking"]
        ERR["error-rate gate + bootstrap CI<br/>vs the owner-signed baseline"]
    end

    subgraph UNIT["Per-commit gates"]
        AG["agent: ruff + mypy strict (106 files)<br/>+ pytest ≥82% (1080 tests)"]
        CATG["catalog: oxlint + tsgolint +<br/>vitest workerd (231)"]
        DEPLOYT["deploy-consistency test:<br/>worker required keys ⊆<br/>deploy.yml provisioned secrets"]
    end

    DS2 --> TRAJ --> MET --> DIRECT --> MODE
    MODE --> REPORT
    MODE --> BLOCK2
    MET --> ERR
```

Result of the redesign on the full 655-case set: request p95 **7** (was 27–50
pre-redesign), tool_f1 0.763 → 0.817, locale 0.540 → 0.739.

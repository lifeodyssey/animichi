# Refactor Backlog (from standards audit + two-round wheels review)

> Sources: `2026-07-06-audit-standards.md`, `2026-07-06-review-wheels-opus.md`, `2026-07-06-review-wheels-fable.md` (round-2 disputes adopted). Governed by X16 (refactoring mandate + 3 disciplines). Status per item; scheduled items reference their story/card.

## Scheduled into stories (iter-0)

| Item | Content | Landing |
|---|---|---|
| F1 | `workers/catalog/src/router.ts` → `implement(catalogContract)`: kills manual type-lockstep drift class + free zod validation on public inputs (X11/SD-2 literal landing) | **S0.10** (patch agent adding) |
| Hygiene batch | F2 remove zombie `pydantic-ai-guardrails` dep · F3 move `reverse-geocoder` out of prod deps (−70MB image) · F4 delete dead LogContext/LogTimer (~80 ln) · F5 `asyncpg-stubs` replacing importlib hack (~80 ln) · F6 adopt official `pydantic_ai.common_tools.duckduckgo` (~30 ln; SD-19 delimiter wraps outside) · delete 4 unreferenced eval datasets (276KB: agent_eval_v2 / plan_quality_v1 / agent_eval_smoke / frontend_flows_v1 — SD-30⑦) · resolve 2 stale TODOs (persistence.py:124,232) | **S0.10** |
| Dual-route unification | selected_route bypass switches from Python `route_optimizer.py` to `deps.catalog` (same surgery as SD-3① cross-DB fix); ×1.3 detour coefficient lands in `route.ts` (TS side); `route_optimizer.py` (315 ln) retired. Algorithm (greedy NN + union-find) unchanged per wheels round-2 ruling | **S1.7 + S1.5** (patch agent updating) |

## Debt cards (schedule iteration 1-2, coordinator assigns)

| Card | Content | Size | Note |
|---|---|---|---|
| **F7 aiohttp stack retirement** | translation.py → httpx (or via catalog per X12); anitabi/bangumi clients demoted to scripts-local; delete base.py(433)+cache.py(338)+cache_mixin(70)+clients/retry.py(105)+anitabi.py(295) ≈ **−1,200 ln**. Also fixes: Bangumi outbound trace invisibility (SD-21 violation) + retry.py substring-match bug (dies with the stack) + cache.py (opus A5 absorbed) | story | Align with iteration-1 translation work |
| **F8 OTel convergence** | observability/ hand-rolled OTel (658 ln, double-tracked with logfire, coverage-omitted) → logfire.metric_counter/span; keep thin runtime.py wrapper | story | Verify no external OTLP consumer first |
| CatalogClient connection pool | `_post_json` creates a new httpx.AsyncClient per request → shared instance | boy-scout | When touching catalog_client.py |
| clustering.ts 8× eslint-disable | Replace non-null assertions with index-guard helpers (zero-suppression discipline) | boy-scout | When touching clustering.ts |
| Python contract codegen | catalog_client.py hand-written pydantic mirror → datamodel-code-generator from emitted openapi.json (kills triple-definition drift) | story, low-prio | After F1 lands |

## P2 structural debt (dedicated cards, align with Wave-3 agent→Worker rewrite; do NOT boy-scout)

- `dict[str,object]` typed-payload pass: 226 occ / 50 files (tool-return layer; pairs with S7.8 tool_state split)
- ID `NewType` pass: 111 bare-str id params → NewType in agents/models.py / domain
- God file/function/class splits: 9 files >300 ln, 258 functions >10 ln, 4 classes >250 ln — boy-scout when editing, no dedicated sweep

## Rejected (for the record)

- ST_ClusterDBSCAN replacing union-find (wheels round-2: geography SRID pipeline cost, in-memory flow, parity cost > gain, SD-28 base)
- drizzle-orm removal (SD-1 migration chain depends on schema.ts; runtime rule = no NEW query-builder usage)
- cache.py cachetools swap (dies with F7 anyway)

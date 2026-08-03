# Seichijunrei — Task Plan

Comprehensive plan from full project review (2026-04-05).
Source: /office-hours + /plan-eng-review + /plan-design-review + /health + /cso + /qa + /investigate

---

## Active: feat/smart-route-planner (PR to main)

### Iter 1: Backend — route_optimizer + route_export + models
- [ ] `backend/agents/route_optimizer.py` (NEW): cluster_by_location, nearest_neighbor_sort, compute_dwell, build_timed_itinerary, validate_coordinates, haversine_distance
- [ ] `backend/agents/route_export.py` (NEW): build_google_maps_url, build_ics_calendar
- [ ] `backend/agents/models.py`: add TimedStop, TransitLeg, TimedItinerary, LocationCluster
- [ ] `backend/agents/executor_agent.py`: update _execute_plan_route + _execute_plan_selected

### Iter 2: Backend tests — full coverage
- [ ] `backend/tests/unit/test_route_optimizer.py` (NEW): property tests + golden cases + edge cases
- [ ] `backend/tests/unit/test_route_export.py` (NEW): URL format, .ics format, UTF-8

### Iter 3: Frontend — RoutePlannerWizard
- [ ] `frontend/components/generative/RoutePlannerWizard.tsx` (NEW): map hero + collapsible spot drawer + timeline + export
- [ ] `frontend/components/generative/registry.ts`: register wizard
- [ ] `frontend/lib/types.ts`: add TypeScript interfaces
- [ ] Mobile: vaul bottom sheet for timeline

### Iter 4: Integration + polish
- [ ] RouteVisualization.tsx backward compat
- [ ] Entrance animation (slide-up-fade)
- [ ] Re-optimization fade + spinner UX

### Iter 5: PR
- [ ] `make check` passes
- [ ] QA smoke test via scripts/qa_auth.py
- [ ] Create PR, CI passes

---

## Bundled fixes (same PR)

From /cso security audit:
- [ ] CORS: replace `*` with configurable origin in http_service.py:288
- [ ] Dockerfile: add `USER appuser` directive

From /qa:
- [x] DB: conversations + user_memory tables applied to production
- [x] .gitignore: add .env.test and .gstack/

---

## Backlog (separate PRs, after route planner ships)

### P2 — UX improvements
- [ ] Mobile responsive on auth page (landing page doesn't stack on narrow screens)
- [ ] Landing page headline: consider Japanese instead of "Anime Pilgrimage, The Journey"
- [ ] Remove "Internal beta · 2026" footer or replace with warmer text

### P2 — Testing infrastructure
- [ ] Encapsulate QA flow into `scripts/qa_smoke.sh` (magic link → login → test queries → screenshots)
- [ ] Add geocoding.py unit tests (24% coverage)

### P3 — Phase A.5 upgrades (post-validation)
- [ ] Google Maps Directions API for real walking times (replace Haversine when insufficient)
- [ ] Apple Maps export URL (`maps://` scheme for iOS)

### P3 — Phase B features (after real usage feedback)
- [ ] OR-Tools integration for TSP with time windows
- [ ] Sun position calculation (latitude + date → optimal photo timing)
- [ ] Multi-day trip support
- [ ] Transit API (Japan GTFS or Jorudan)
- [ ] Route variant comparison (2-3 alternatives)
- [ ] Last-train constraint

### P4 — Future
- [ ] Photo overlay / camera tool (native app, Phase 2)
- [ ] Agent API for B2B (Ctrip integration)
- [ ] Observability: enable OTel exporters in production

---

## Architecture reference

```
User: "響け 宇治 半日"
       │
       ▼
ReActPlannerAgent (LLM)
       │ → ExecutionPlan { steps: [resolve_anime, search_bangumi, plan_route] }
       ▼
ExecutorAgent._execute_plan_route()
       │
       ├── validate_coordinates(rows) → filter out (0,0)
       ├── cluster_by_location(rows, 50m) → LocationCluster[]
       ├── compute_dwell(cluster.photo_count, pacing) per cluster
       ├── nearest_neighbor_sort(clusters, origin)
       ├── build_timed_itinerary(clusters, start_datetime, pacing)
       ├── build_google_maps_url(itinerary.stops)
       ├── build_ics_calendar(itinerary)
       └── Return { ordered_points (compat), timed_itinerary (new), exports }
       ▼
Frontend: registry.ts → RoutePlannerWizard.tsx
       │
       ├── Map (hero, Leaflet)
       ├── Timeline sidebar (240px)
       ├── Spot drawer (shadcn Sheet, collapsible)
       └── Export buttons (Google Maps, Calendar)
```


---

# ARCHIVED BACKLOG — 原根目录 TODOS.md(2026-06-23 后未更新,iter6 A6 并入,#640)

# TODOS

Tracked work items for Seichijunrei. Each entry includes context so someone
picking it up in 3 months understands the motivation.

---

## Provider Resilience

### Cross-Provider Fallback
**Priority:** P1

Current fallback: `gpt-5.4@Univibe → gpt-5.4@Univibe` (same provider).
When Univibe goes down, both primary and fallback fail.

Should be cross-provider: primary → fallback on different provider.
E.g., `gpt-5.4@Univibe → deepseek-v4-pro@DeepSeek` or vice versa.

- [ ] Change `FALLBACK_AGENT_MODEL` to use a different provider than primary
- [ ] Catch `ModelHTTPError(502)` in `_execute_pipeline` and return friendly
      "AI service temporarily unavailable" instead of generic pipeline error
- [ ] Test with provider A down, verify auto-fallback to provider B

**Why:** Univibe 502 "网络有点慢" caused repeated E2E failures. Both models on
same provider = no resilience.

---

## Route Planning

### Route Planner Agent — Full Version (Phase 3)
**Priority:** P2
**Spec:** `docs/superpowers/specs/archive/2026-04-28-route-planning-v2.md`

Current state: `route_area_splitter.py` has a minimal agent with 2 tools
(`calculate_distance`, `cluster_points`). It works but relies on LLM world
knowledge for station names and transit info.

Full version needs:
- [ ] Station data source — Overpass API (OSM) or Japanese station CSV dataset
- [ ] `find_nearest_station` tool — given lat/lng, return nearest train station
- [ ] `get_transit_info` tool — Google Directions API or web_search for transit
- [ ] Frontend multi-area route display — tabs or collapsible sections per area
- [ ] Transit legs rendering — different color/style for walk vs transit segments

**Why:** Users described real pilgrimage pattern as "train to area → walk spots →
train to next area." Station-aware routing would make the route actually useful
for trip planning, not just a list of spots.

**Depends on:** Phase 2 (LLM area splitting) ✅ done

### `execute_selected_route` — keep or remove?
**Priority:** P3

User can manually select points from the grid and route them directly (no LLM).
Open question from eng review: is this UX pattern needed once LLM area splitting
exists? Adding 20-40s LLM latency to user-initiated route planning is the tradeoff.

**Needs:** Design review (`/plan-design-review`)

---

## Eval

### Eval V4 Redesign
**Priority:** P1
**Spec:** `docs/superpowers/specs/archive/2026-04-27-series-aware-resolve-design.md` section "Eval V4 Redesign"

Current eval has critical scoring bugs:
- [ ] Error guard: count `report.failures` (task crashes vanish from scoring)
- [ ] Baseline: record and verify `evaluated_count`
- [ ] `retry_task` for transient API errors
- [ ] Evaluators return `bool` assertions (IntentMatch, ToolExecution)
- [ ] Partial credit for IntentMatch (related intent = 0.5)
- [ ] LLM Judge evaluator (response quality)
- [ ] Capability vs regression eval split
- [ ] pass@k consistency measurement
- [ ] Case-specific evaluators (per-case LLMJudge rubrics)
- [ ] Transcript review workflow

**Why:** GPT-5.5 via Univibe scored "100%" on 617 cases but actually only ran 2
(both `selected_route` cases that don't use LLM). The other 615 crashed and were
silently excluded from scoring.

### Route Planner Eval
**Priority:** P2
**Spec:** `docs/superpowers/specs/archive/2026-04-28-route-planning-v2.md` section "Eval strategy"

- [ ] New dataset `route_planner_eval.json` (~20 cases)
- [ ] `AreaSplitQuality` evaluator (score)
- [ ] `StepTrace` evaluator (diagnostic score)
- [ ] `RouteQualityJudge` LLM evaluator
- [ ] Extend 93 existing plan_route cases with `expected_data_keys: ["areas"]`

---

## Agent Features

### Series-Aware Resolve
**Priority:** P2
**Spec:** `docs/superpowers/specs/archive/2026-04-27-series-aware-resolve-design.md`

Bangumi API returns S1/S2/S3/movie for popular anime → agent over-clarifies.
Use Anitabi geo data to decide merge vs clarify:
- [ ] Anitabi gateway: `get_bangumi_info()`
- [ ] Haversine distance between candidates
- [ ] Merge mode (<15km) → search all IDs, group by work
- [ ] Clarify with context (>15km) → rich cards with cover+city+map
- [ ] Frontend: PilgrimageGrid grouped display, tab bar

### ResponseLocale Fix
**Priority:** P2

Eval shows 59.7% ResponseLocale — agent often replies in wrong language.
- [ ] Add output_validator language check → ModelRetry if wrong locale

---

## Frontend

### Cover Image Empty src
**Priority:** P3

React warning: "An empty string was passed to the src attribute." Cover URLs
from Bangumi API sometimes return `""` instead of `null`.
- [ ] `CandidateCard` / `PilgrimageGrid`: render `null` instead of `""` for src

### Locale Detection
**Priority:** P3

Frontend sends `locale: "en"` even when user types Chinese. `detect_language`
in `public_api.py` works server-side but frontend hardcodes locale from browser.
- [ ] Frontend: detect input language or use server-side detection result

---

## Infrastructure

### Logfire Plugin — Shell Token
**Priority:** P3

`logfire-session-capture` plugin needs `LOGFIRE_TOKEN` in shell environment.
Currently in `.env` but not in `~/.zshrc`.
- [ ] User needs to run: `echo 'export LOGFIRE_TOKEN="..."' >> ~/.zshrc`

### Translation Bugs
**Priority:** P2
**Memory:** `project_translation_bugs.md`

Translation eval 72.6% — 3 bug patterns:
- [ ] Bangumi API returns sequel/spinoff instead of main work (13 cases)
- [ ] Place names treated as anime titles (3 cases)
- [ ] Update translation_v1.json expected values for community names (6 cases)

### Area Splitter Performance
**Priority:** P1

Route planner sub-agent calls `calculate_distance` 15+ times for 76 points via
LLM tool calls — each call is an LLM roundtrip (~2s). 76 points × multiple
distance checks = 90s timeout.

Options:
- [ ] Pre-compute pairwise distances for distant points and pass as context (no tool calls)
- [ ] Use algorithmic clustering (DBSCAN/hierarchical) as primary, LLM only for naming areas
- [ ] Limit calculate_distance to sampled point pairs (e.g., centroids only)
- [ ] Increase agent timeout for route planning specifically

**Why:** E2E test showed plan_route correctly triggered but area_splitter timed out.

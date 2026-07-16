# Animichi Agent Redesign — Kill the Thrash, Land pydantic-ai 2.9.1 Best Practice

- **Status:** Draft v2.3
- **Date:** 2026-07-16
- **Branch of record:** `feat/pydantic-native-n1`
- **Source of truth:** the reconciled 6-batch dual-review audit (`audit-findings-accumulator.md`, B0–B5 + cross-cutting patterns + UI-protocol note); the v1→v2 dual SPEC review (sonnet + Codex xhigh, both *needs-revision-TARGETED* — foundation SOUND); and the **v2→v2.1 dual RE-REVIEW** (Codex xhigh *needs-revision*; sonnet *ready-to-implement for Phase 0 + 1a, one gate before Phase 1c*) — both agree the core architecture is SOUND and all **8 v1 blockers are substantively closed**, so v2.1 is a TARGETED, phase-layered touch-up, NOT a re-architecture; and the **v2.2→v2.3 focused dual review of the three owner decisions** (sonnet + Codex xhigh, 2026-07-16, both *needs-revision-TARGETED* — both CONFIRM the three decisions are structurally sound and cleanly integrated; the findings fill in the NEW multi-select machinery's failure/eval/persistence contracts, all closed in v2.3). Every defect below is file:line-grounded; cited files were re-opened to pin exact target schemas (catalog `search.ts`, `sources.ts`, `schema.ts`, `parse.ts`, `enrich.ts`; `tool_state.py`, `runtime_models.py`, `agent_result.py`, `response_builder.py`, `chat.py`, `selected_route.py`, `evaluators.py`, `tool_runtime.py`, `session_facade.py`, `persistence.py`, `base.py`, `settings.py`, `schemas.py`; v2.3 re-pinned: catalog `search.ts:130` `pointsByWorkId`, `router.ts:55` `MAX_ROUTE_POINT_IDS=500`, `lib/route.ts:54`/`api/route.ts:76` `MAX_ITINERARY_CLUSTERS=50`, `persistence.py:270-340` + `repositories/routes.py:18` + `supabase/migrations/20260402120000_remote_schema.sql:121-132`, `evaluators.py:43-76/141-148/203+`, `eval_harness.py:234/279`).
- **Scope:** agent runtime (`apps/agent`) + catalog worker contract (`workers/catalog`, TypeScript). No frontend code is reviewed here — the generative-UI section (§5) *defines* a wire contract for the not-yet-started `apps/web` rebuild to implement.
- **Revision log:** see the bottom sections "Revision log (v2)", "Revision log (v2.1)", "Revision log (v2.2)", and "Revision log (v2.3)" — every change is mapped to the review finding or owner decision it closes. **v2.2 folds in the THREE owner decisions of 2026-07-16:** (1) RE-BASELINE the eval (drop frozen-baseline preservation), (2) LOOSE deterministic MISS-path clarify (several name-similar candidates → clarify), (3) MULTI-SELECT clarify consumed by a deterministic server handler (`execute_multi_selection`, NOT CodeMode). **v2.3 closes the v2.2→v2.3 focused dual review of those decisions** (multi-select terminal matrix; reason-keyed selection dispatch + `execute_place_selection`; eval-harness D3-awareness; route persistence via a normalized `route_anime` join table — owner decision 2026-07-16; over-clarify informativeness guards; request-mode exclusivity) under the owner's global principle: **no historical baggage — the cleanest design wins every decision.**

## 1. TL;DR

A full MiMo eval surfaced pathological thrashing: trivial single-anime queries loop **27–50 model requests** and hit the usage limit. The root cause is a broken **tool contract**, not a discovery or capability gap: `resolve_anime` hands the model a *false* ambiguity signal (`"candidates" is ALWAYS present`, an impossible "single id + multiple candidates" state) then offloads a fragile subjective judgment ("is the query short/vague?"), and `clarify` amplifies it with a `ModelRetry`-as-control-flow loop plus a hardcoded `action_required` loop-breaker. This redesign rewrites every layer to pydantic-ai 2.9.1 official best practice while keeping the agent **agentic**: the model branches on a *clean typed `outcome`* computed in the data layer — no hardcoded loop-breakers, no query-length heuristics.

The v1 spec's diagnosis was independently verified accurate by both SPEC reviewers; v2 closes the 8 reconciled implementability gaps: (1) a **deterministic** catalog resolver (dedup-by-work_id so franchises don't recreate false ambiguity); (2) a **ref-keyed session result registry** holding full payloads (the single-slot v1 design made `plan_route(search_result_ref)` meaningless); (3) **complete clarify validation** (reason+cardinality, reject-when-no-pending, reason-on-the-outcome so the model never guesses); (4) a **server-owned RuntimeStage map** on `AgentResult` (the pydantic-ai output object does NOT carry the output-tool name, so top-level intent cannot be read off `output`) + the atomic consumer migration + a clarify-**selection** request contract; (5) direct thrash **red-line gates** (final stage alone is insufficient — an agent can loop 40× then emit the right stage) — *v2 paired these with frozen-baseline preservation via a synthetic `clarify` step; that preservation half is **superseded in v2.2** by the owner's re-baseline decision (§7)*; (6) a **re-phase** with a SECURITY **Phase 0** and one clearly-fenced atomic switch; (7) a source cap on the **model-facing return only** (never `build_search_payload`, which feeds route rows + UI); (8) a **cache-neutral** dynamic-instruction path.

v2.1 folds in the phase-layered re-review fixes without moving the architecture: **Phase 0** gets the exact model-alias allowlist (§4g); **Phase 1a** corrects the MISS-path Bangumi subject field names against the real parser (§4a); **Phase 1c** gets a normative TOTAL clarify transition table (§4b/§4c/§4e), the two omitted `AgentResult` producers (`selected_route.py` + `/v1/chat`) in the atomic migration, the frozen-baseline data_keys compatibility projection (§7; **dropped in v2.2** — superseded by the re-baseline decision), and the `clarification_id` type fix; **Phase 1d** gets a distinct `PartialResponseModel` (§4h) and concrete thrash-gate thresholds (§7). Per the sonnet re-review, **Phase 0 + 1a are implementable immediately** after the two small fixes; the medium fixes serve 1c/1d, which land later.

v2.2 folds in **three owner decisions (2026-07-16)** — SPEC changes only, no architecture move: (1) **RE-BASELINE the eval.** Frozen-baseline byte-identical preservation is dropped ("没必要兼容 / 直接做到最好的方案"): build the cleanest design; after Phase 1c lands, run the full eval and present the NEW-vs-OLD comparison to the owner, who confirms the new baseline **as a whole** (no per-case `expected_stage` sign-off). This deletes the `_available_data_keys` compatibility projection and the baseline-preserving synthetic `clarify` step, **simplifying 1c**; the direct thrash red-line gates stay (§7/§8). (2) **LOOSE clarify.** The §4a MISS path changes from "normalized-name EXACT match ≥2" to a deterministic **name-similar** rule (normalized-substring containment in either direction over `name`/`name_cn`, capped at 6, relevance order): several similar candidates → clarify — e.g. "凉宫" shows the several 凉宫ハルヒ works to pick from instead of silently resolving to the top hit. The HIT (alias-index) path stays precise; Phase 1a's already-built resolver implements the old TIGHT rule and MUST be amended before 1c wires it (§6). (3) **MULTI-SELECT clarify.** The selection contract becomes `selected_candidate_ids: list[str]` (+ `clarification_id`); a NEW deterministic server handler `execute_multi_selection` — analogous to `execute_selected_route`, bypassing the agent, explicitly **NOT CodeMode** — fetches all selected works in parallel via `pointsByWorkId`, merges + dedups by stable point id, and routes over the merged set (§4c/§4e/§5), bundled into Phase 1c.

Two items are **SECURITY** and are pulled forward to **Phase 0**: the translation sub-agent's unsanitized web path (§4i / S1) and the model-string credential-routing bypass (§4g / M1).

## 2. Problem statement + root cause (the thrash chain)

### Observed
15 previously-passing MiMo eval cases regressed; trivial single-anime queries issue 27–50 model requests and trip `UsageLimits`, surfacing as an unhandled 500 (`public_api.py:317`). The `UsageLimits` magic numbers (`MAIN_REQUEST_LIMIT=25`, `+2` headroom, `animichi_runner.py:25-27`) were themselves fitted to the pathological loop.

### The thrash chain (each link file-grounded)
1. **Catalog cannot return "all matching works."** `search()` resolves an alias to exactly **one** highest-priority `work_id` (`workers/catalog/src/api/search.ts:117`, `firstWorkId` = `ORDER BY priority DESC LIMIT 1` at :286-293). There is no candidate list and **no points-by-work-id endpoint** — so `search_bangumi` throws the resolved id away and re-runs a free-text `search`. The entire "candidates / ambiguity" premise is fiction at the data layer (cross-cutting pattern #8).
2. **`resolve_anime` fabricates ambiguity.** Its docstring (`animichi_tools.py:57-67`) claims `"candidates" is ALWAYS present`, invents an impossible "single `bangumi_id` returned but candidates has multiple entries" state, and instructs the model to **judge query length** ("short/vague → clarify"). This is a subjective judgment offloaded to the model — the #1 anti-pattern (cross-cutting #2).
3. **`clarify` is a control-flow loop, not a tool.** It is `ModelRetry`-driven, does DB reads/writes despite being "ephemeral," re-types titles losing stable ids, carries a `list[str] | None` with *contradictory* `ModelRetry` text (`animichi_tools.py:300-308`), and its state writes `action_required="return clarify_response"` (`tool_runtime.py:183`; `tool_state.py:146`) — a hardcoded loop-breaker the owner rejects. Function tool + output type = a wasted round-trip each turn (cross-cutting #3).
4. **The instructions mirror the bad heuristic verbatim** (`animichi_agent.py:107-121`): "if the user's query is vague/short … call clarify() then IMMEDIATELY return … STOP and wait." The prompt *teaches* the thrash.
5. **Output models force the model to reproduce authoritative data** (`runtime_models.py`): `SearchResponseModel.data` is a ~3.6 KB nested schema the wire then **discards** in favor of `tool_state` (`response_builder.py:57-76`). The model re-transcribes rows/coords/ids every turn — token waste + fabrication risk — for zero value.
6. **Multi-turn session state is broken.** `_seed_tool_state` ignores the `current_bangumi_id`/`current_anime_title` the session facade already computes (`session_facade.py:262-263`, `build_context_block` block keys; dropped at `animichi_runner.py:58-73`) → identity is not carried across turns; `pending_clarify` is **sticky** (`_merge_clarify_state` ORs history: `return resolve_candidates, pending_clarify or pending`, `session_facade.py:165`, with no clear transition) → the clarify flag latches forever, re-triggering clarify loops.
7. **A security hole in the translation sub-agent** (`translation.py:113-121`, :175) bypasses the untrusted-content invariant and does not share the usage budget.

**Net:** false ambiguity signal → subjective judgment → clarify loop → sticky pending flag → re-clarify, all inside a request budget fitted to the loop. Fixing any single link is insufficient; §4 rewrites the whole chain.

## 3. Guiding principles (the cross-cutting patterns)

These govern every layer. Each is stated as a rule the redesign must satisfy.

1. **Typed outcomes, never `ModelRetry` for control flow.** Domain outcomes (`resolved`, `needs_disambiguation`, `not_found`, `empty`, `place_ambiguity`, `place_unresolved`, `missing_location`) are a structured **discriminated `outcome`/`status`** field the model *branches on*. `ModelRetry` is reserved for correctable model **argument** mistakes only.
2. **Compute decisions in the data layer; give the model a crisp branch.** The catalog/resolver/gazetteer computes `outcome` AND the `clarification_reason` that accompanies it; the model routes on it. Never ask the model a fragile subjective question ("is this short/vague?") and never make the model *guess* which reason a clarification is for.
3. **Collapse function-tool/output-tool duplication.** `greet_user` / `general_qa` / `clarify` are echo double-hops. Remove the function tools; the model emits the output type directly. Move any SSE "thinking" step to a run hook / native event stream / runner-synthesized step.
4. **Stable IDs over re-typed titles/prose.** Candidate identity flows as `bangumi_id` / gazetteer `id` from the resolver/geocoder, never as model-re-typed titles. **`candidate_ids` is the SOLE ID the model is permitted to echo** (§4d resolves the "echo vs never-transcribe" tension).
5. **No dead params.** Every tool parameter reaches the catalog or is removed (`search_bangumi.episode/force_refresh`, `plan_route.origin/pacing/start_time`).
6. **Accurate, fumble-proof contracts.** No contradictory `ModelRetry` text; constrain types (`pacing → Literal[...]`); give `plan_route` an explicit `Tool(description=)` (its generated description is malformed XML today); snapshot-test the generated `ToolDefinition`; discriminated-union tool outcomes make impossible states unrepresentable.
7. **Compact returns to the model; full payload in the typed session registry / SSE.** The model sees a one-line summary + stable ids/refs; the app builds the full wire response from the typed `SessionState` registry (§4e). The cap is on the **model-facing return only**, never on the stored payload (§4f).
8. **Root cause spans catalog + agent.** The full fix needs a catalog **deterministic outcome-based resolver** + a **points-by-work-id** endpoint, plus the agent-side contract changes.
9. **`web_search` is attributed prose only.** Web results NEVER merge into catalog search/route payloads and NEVER create pilgrimage points; `web_search` feeds QA/attributed prose only, behind the untrusted-content wrapping.
10. **Skills are NOT needed.** The current capability stack is right for a handful of tools / one job. Thrash is a *contract* problem, not a *discovery* problem. Do not add `SKILL.md` bundles.

## 4. Redesign by layer

Each subsection: **Current defect** (file:line) → **Target design** (concrete, implementation-ready) → **Why it is the pydantic-ai best practice**.

### 4a. Catalog contract — DETERMINISTIC outcome-based resolver + points-by-work-id (TypeScript, `workers/catalog`)

**Current defect.** `search(db, {query, origin})` resolves an alias to ONE `work_id` (`search.ts:117`; `firstWorkId` `ORDER BY priority DESC LIMIT 1`, :286-293) and returns `SearchResult { rows, synced_at, partial? }` (:104-109). There is no candidate list and no way to fetch a known work's points by id — `search_bangumi` is forced to re-run a free-text search. `fetchBangumiSearch` (`sources.ts:149-157`) returns only the FIRST subject id (`bestSubjectId`, :163-169), so the MISS path cannot express "multiple plausible subjects." The "candidates/ambiguity" contract has no data-layer backing (audit #8, B0). **v1 gap (both reviews, P1-1):** dropping `LIMIT 1` *without* dedup-by-work_id would count multiple alias rows / sources of ONE anime as multiple candidates → it would **recreate** false ambiguity one layer down; "confidence bar" and candidate ordering were undefined; year/format/season not mapped to storage.

**Target design — the deterministic algorithm.** Add two catalog endpoints (oRPC contract in `packages/contract` + handlers in `workers/catalog/src/api`). The resolver **computes the outcome in TS deterministically** — this is where cross-cutting #2 lives. All constants below are *initial* values; changing them is an owner-sign-off eval event (§7).

```ts
// NEW: resolve endpoint — discriminated outcome; the model never judges ambiguity.
type ResolveOutcome =
  | { outcome: "resolved";             match: AnimeCandidate }
  | { outcome: "needs_disambiguation"; reason: "anime_ambiguity"; candidates: AnimeCandidate[] } // 2..MAX
  | { outcome: "not_found";            reason: "anime_not_found" }
  | { outcome: "upstream_unavailable"; provider: "bangumi" | "anitabi" };  // retryable, NOT not_found

interface AnimeCandidate {
  bangumi_id: string;   // STABLE id (Bangumi subject id == work_id) — the dedup key
  title: string;        // authoritative title (trusted display)
  title_cn?: string;
  cover_url?: string;
  year?: number;        // enrichment: parseInt(air_date-or-date .slice(0,4)) — see field-name note below
  points_count?: number;// enrichment: derived COUNT(points.id) — see owner note below
}
// NOTE: `format`/`season`/`city` are DROPPED from the candidate — the `bangumi`
// table (schema.ts:34-47) has NO format/season column; adding them is a schema
// migration, not additive, and is DEFERRED. Honest discriminators are the ones
// storage actually holds: title/title_cn/cover_url + year (from date/air_date) + points_count.

// NEW: points-by-work-id — the alias-HIT path exposed directly, no free-text re-search.
function pointsByWorkId(work_id: string): Promise<SearchResult>;  // { rows, synced_at, partial? }
```

**Resolution vs coverage are SEPARATE axes.** `resolve` answers "which work does this phrase mean" (`resolved`/`needs_disambiguation`/`not_found`/`upstream_unavailable`). Coverage — whether that work has catalog points — is answered *later* by `pointsByWorkId`/`search`. A resolved work with zero points is `resolved` + a downstream `empty`, **never** `not_found`.

**HIT path (alias index), deterministic:**
```sql
SELECT work_id, MAX(priority) AS priority
FROM aliases WHERE alias_normalized = $1
GROUP BY work_id;                      -- GROUP BY = DEDUP by work_id (closes the franchise bug)
```
Let `works` = the deduped rows.
- `works.length === 0` → MISS path.
- `works.length === 1` → `resolved(work_id)`.
- `works.length >= 2`: let `maxP = max(priority)`, `top = works.filter(w => w.priority === maxP)`.
  - `top.length === 1` → `resolved(top[0])` — a strictly-dominant canonical work (this preserves today's behavior: today `LIMIT 1` always resolves the single top-priority work).
  - `top.length >= 2` → `needs_disambiguation`, candidates = the tied-top works ordered by the **ranking tuple** `(priority DESC, points_count DESC NULLS LAST, bangumi_id ASC)`, capped at `MAX_CANDIDATES = 6`.

  **Tie = ambiguity — and the HIT path stays PRECISE.** The `priority` column is the tie-breaker; genuine ambiguity is a *tie at the top rank* among distinct works that actually share the normalized alias row. The v2.2 loosening (owner Decision 2) lives **exclusively on the MISS/Bangumi path below** — an exact alias hit is a curated mapping, so the HIT path keeps the exact-tie rule. **Precondition to note (informational, §7):** whether real ambiguous franchises actually share `alias_normalized` rows at equal priority — if they never do, the HIT path never clarifies and the MISS-path name-similar rule (below) is the sole disambiguation source.

**MISS path (no alias row):** extend the Bangumi adapter to return N subjects (fixes the "returns only first result" gap). **The subject shape MUST match the REAL Bangumi v0 payload the shared parser already reads (P2-6 / sonnet P3-c):**
```ts
// NEW: fetchBangumiSubjects(keyword, {limit: BANGUMI_FETCH_N = 8}) -> BangumiSubject[]
//   REUSE the shared subject parser (parse.ts) — do NOT invent a new inline shape.
//   Real Bangumi v0 subject fields (parse.ts:101,105):
//     - cover:    images.{large,common,medium,small,grid}  via coverFromImages(subject.images)  (NOT `image`)
//     - air date: pickStr(subject, ["date","air_date"])  — `date` with fallback `air_date`       (NOT `air_date` only)
//   BangumiSubject = { id, name, name_cn?, date?, air_date?, images?: {large?,common?,...} }
//     in Bangumi relevance order. Parse cover via coverFromImages(), year via the date/air_date pick.
// fetchBangumiSearch stays as the thin wrapper the ingest preview path uses:
//   fetchBangumiSearch = (q) => fetchBangumiSubjects(q, {limit:1}).then(s => s[0]?.id ?? null)
```
Let `subjects = fetchBangumiSubjects(query)` (Bangumi relevance order) and `q = normalizeAlias(query)`. **v2.2 (owner Decision 2) — the MISS-path ambiguity rule is LOOSE name-similarity, not exact match.** Compute the deterministic candidate set:

```ts
// The fuzzy predicate is EXACTLY this — normalized-substring containment in EITHER
// direction, over BOTH name and name_cn, BOUNDED by deterministic informativeness
// guards (v2.3). No scoring, no model judgment.
const MIN_QUERY_LEN = 2;      // normalized chars; below → exact-equality match only
const MIN_SIMILAR_LEN = 2;    // reverse containment needs a matched name >= 2 normalized chars
const MAX_REVERSE_RATIO = 3;  // reverse containment needs q.length <= 3 * name.length

const matchesName = (n: string): boolean => {
  if (n.length === 0) return false;
  if (n === q) return true;                        // exact equality ALWAYS counts (any length)
  if (q.length < MIN_QUERY_LEN) return false;      // 1-char query: exact only — n.includes(q)
                                                   //   would match half the fetched set
  if (n.includes(q)) return true;                  // forward: the name contains the query ("凉宫")
  return q.includes(n)                             // reverse: the query contains the name —
      && n.length >= MIN_SIMILAR_LEN               //   short titles ("K"/"C") never match this way
      && q.length <= n.length * MAX_REVERSE_RATIO; //   a long sentence cannot swallow "86"
};
const isSimilar = (s: BangumiSubject): boolean =>
  matchesName(normalizeAlias(s.name))
  || (s.name_cn ? matchesName(normalizeAlias(s.name_cn)) : false);
// Degenerate-query guard: if q === "" after normalization, similar = [] (head-pick below) —
// containment against an empty string would otherwise match everything.
const similar = q === "" ? [] : subjects.filter(isSimilar).slice(0, MAX_CANDIDATES); // = 6, relevance order preserved
```

**Informativeness guards (v2.3 — deterministic; closes the over-clarify findings).** Two degenerate inputs the bare containment rule would spuriously clarify on: (a) a **1-char query** (`q="k"`) forward-matches (`n.includes(q)`) a large share of any fetched set → guarded by `MIN_QUERY_LEN`: queries under 2 normalized chars match by **exact normalized equality only** — the anime "K" is still found by typing "K", but "k" never substring-clarifies across unrelated titles; (b) a **long model-extracted phrase** reverse-matches (`q.includes(n)`) short titles ("K"/"C"/"86") that Bangumi relevance-ranks into the fetched set → guarded by `MIN_SIMILAR_LEN` (the matched NAME must be ≥2 normalized chars) AND `MAX_REVERSE_RATIO` (the query may exceed the matched name by at most 3× — a sentence cannot swallow "86"). A token-boundary alternative was considered and REJECTED: CJK has no token boundaries, so the length-ratio bound is the deterministic cross-locale guard. **"凉宫" is preserved:** a 2-char query forward-contained in the 凉宫ハルヒ titles — `MIN_QUERY_LEN` passes (=2) and forward containment carries no ratio bound. All three constants are eval-tunable alongside `MAX_CANDIDATES`/`BANGUMI_FETCH_N` (§7).

- `subjects.length === 0` → `not_found`.
- `similar.length >= 2` → `needs_disambiguation` (candidates = `similar`, capped at `MAX_CANDIDATES = 6`, in Bangumi relevance order, enriched from the parsed subject fields). Example: "凉宫" → the several 凉宫ハルヒ works are shown to pick from instead of silently resolving to the top hit.
- `similar.length === 1` → `resolved(similar[0])` (the unique similar subject — NOT blindly `subjects[0]`).
- `similar.length === 0` → `resolved(subjects[0])` — today's `bestSubjectId` relevance head-pick is preserved for queries that resemble none of the returned names. It then flows to the existing tiered preview/ingest (`resolvePreview`/`missResult`, :129-151), returning `partial:true` (L1 preview) or a downstream `empty` (Bangumi resolved but Anitabi 404/empty).

**Why the loose rule is still thrash-safe.** The historical thrash came from **model judgment + `ModelRetry` looping** (the "short/vague" heuristic and the clarify retry loop), NOT from clarify frequency. This rule keeps both killers out: (a) it is **DETERMINISTIC** — the catalog computes the candidate set with the predicate above; the model never judges similarity; (b) clarify remains a **ONE-STEP TERMINAL output** (§4c) with no `ModelRetry` loop — a clarify turn is one request, then the run ends. A higher clarify *rate* is intended product behavior, not thrash. The v2/v2.1 caveat that "anything looser would explode the clarify partition" was a **frozen-baseline preservation argument and is now MOOT** — the owner chose to re-baseline (Decision 1, §7). The predicate and `MAX_CANDIDATES`/`BANGUMI_FETCH_N` are **eval-tunable constants**: changing them is an eval event diffed against the NEW baseline (§7).

**Enrichment query** (for `needs_disambiguation` candidates already in the catalog). `year` and `points_count` come from storage; **`points_count` OWNER (P2-6):** the enrichment UPSERT does **NOT** maintain a `points_count` column (`enrich.ts:71-82` writes only `id,title,title_cn,cover_url,summary,rating,eps_count,air_date`; `enrichWork` returns `pointCount` but never persists it). So `points_count` as a ranking discriminator would be **unowned**. **Decision: derive it in the resolver query** (no schema migration, no enrich change) — `COUNT(points.id)` grouped by `bangumi_id`:
```sql
SELECT b.id, b.title, b.title_cn, b.cover_url, b.air_date,
       COUNT(p.id) AS points_count            -- DERIVED here; not a bangumi column
FROM bangumi b LEFT JOIN points p ON p.bangumi_id = b.id
WHERE b.id = ANY($1)
GROUP BY b.id, b.title, b.title_cn, b.cover_url, b.air_date;
```
Map `year = pickYear(b.air_date)` (`b.air_date` is `pickStr(subject,["date","air_date"])` at ingest, so it already carries the real value); `points_count = COUNT(points.id)`. MISS-path candidates not yet in `bangumi` are enriched from the parsed Bangumi subject fields (name→title, `images.{…}`→cover_url via `coverFromImages`, `date`/`air_date`→year), `points_count` omitted (0/NULLS LAST). *(Alternative owner choice: add a `points_count` column maintained during `upsertBangumi` — deferred; the COUNT derivation is the recommended default because it needs no migration and no enrich rewrite.)*

**`upstream_unavailable`.** `resolveWorkId` already maps Bangumi 5xx/network to a typed retryable `UPSTREAM_UNAVAILABLE` (`search.ts:218-225`); `pointsByWorkId` reuses `hitResult`/`selectPoints` keyed by `work_id`. The resolver surfaces `upstream_unavailable` as its own outcome (agent → graceful "try again," §4h), distinct from `not_found` and `empty`.

**Required unit tests (TS worker suite):**
- Duplicate alias rows for ONE work → `resolved` (NOT ambiguous). -> unit
- One work reachable via multiple *source* alias rows → `resolved`. -> unit
- Two distinct works tied at top priority → `needs_disambiguation`, 2 candidates, ordered by the ranking tuple. -> unit
- Strictly-dominant top priority among 3 works → `resolved` (not clarify). -> unit
- Over-limit tie (> 6 tied works) → capped at `MAX_CANDIDATES`, stable order. -> unit
- MISS, 0 subjects → `not_found`. -> unit
- MISS, "凉宫"-style query with ≥2 name-similar subjects (normalized-substring containment in either direction, matching via `name` or `name_cn`) → `needs_disambiguation`, candidates in Bangumi relevance order (v2.2 loose rule). -> unit
- MISS, exactly 1 name-similar subject (not the relevance head) → `resolved(similar[0])`, NOT `subjects[0]`. -> unit
- MISS, 0 name-similar subjects but ≥1 subjects → `resolved(subjects[0])` (relevance head-pick preserved). -> unit
- MISS, >6 name-similar subjects → capped at `MAX_CANDIDATES`, stable relevance order. -> unit
- MISS, degenerate/empty normalized query or empty normalized subject name → excluded from the similar set (no containment-on-empty-string false positives); falls through to head-pick. -> unit
- MISS, 1-char query (`"k"`): containment disabled → exact normalized equality only (the title "K" resolves when fetched; NO multi-candidate clarify from substring noise) (v2.3 guard). -> unit
- MISS, long sentence-length query containing a short fetched title ("K"/"C"/"86" via `q.includes(n)`) → blocked by `MIN_SIMILAR_LEN`/`MAX_REVERSE_RATIO` → NOT similar; no spurious clarify (head-pick/exact path applies) (v2.3 guard). -> unit
- MISS, reverse containment within the ratio (query = a full title + a short suffix) → still similar (legit reverse match preserved) (v2.3 guard). -> unit
- MISS, "凉宫" 2-char forward containment → still ≥2 similar → `needs_disambiguation` (the guards do not regress owner Decision 2). -> unit + eval
- **MISS subject parse: cover comes from `images.{large,common,…}` and year from `date` (fallback `air_date`) — a subject with only `image`/only `air_date` is parsed per the shared parser's fallback order, NOT dropped (P2-6).** -> unit
- `resolved` work with 0 catalog points → resolve `resolved`, `pointsByWorkId` → `empty` (NOT `not_found`). -> integration
- Bangumi 5xx → `upstream_unavailable` (NOT `not_found`, NOT `empty`). -> unit
- Enrichment: `year` parsed from `date`/`air_date`, `points_count` = derived `COUNT(points.id)`. -> integration

**Why best practice.** Pushing the ambiguity decision into the data layer is cross-cutting #2 and #8; dedup-by-work_id is what makes the discriminated `outcome` union *honest* (no false ambiguity). Stable `bangumi_id`s (#4) carry identity through the whole pipeline. Points-by-id removes the round-trip where the resolved id was thrown away. Reusing the shared subject parser (not an inline `image`/`air_date` shape) means the MISS path reads the same real Bangumi payload the ingest path already parses correctly.

> **Eval note (v2.2):** the resolver's `outcome` partition IS the #1 eval gate (§7), and the partition SHIFTS BY DESIGN in both directions: heuristic-driven clarifies flip **clarify → search** (the "short/vague" judgment is gone), and the loose MISS rule plus the HIT tie rule flip **search → clarify** (several name-similar subjects, or a genuine top-priority tie, now clarify). Per owner Decision 1 there is NO per-case `expected_stage` sign-off — the shift is captured in the post-1c NEW-vs-OLD comparison the owner confirms as a whole (§7).

### 4b. Tools

**Current defect.** 9 tools registered (`animichi_tools.py:333-341`). `resolve_anime` (D, thrash source) offloads the length judgment (:57-67). `search_bangumi` (D+) takes optional `bangumi_id` with a hidden session fallback (:107-116), converts the id back to a title and re-runs free-text search (:125), and carries dead `episode`/`force_refresh` (:104-105). `search_nearby` (C) uses `location=""` to conflate near-me vs omitted and `radius=0` as a sentinel (:138-139), raising every domain outcome as `ModelRetry`. `plan_route` (D) has a malformed-XML generated description, dead `origin`/`pacing`/`start_time` (:171-173), unconstrained `pacing: str`, and picks `search_bangumi or search_nearby` preferring the *stale* bangumi over a newer nearby (:191-193). `greet_user`/`general_qa`/`clarify` are echo double-hops (:209-330).

**Target design.** Tool outcomes are **discriminated unions** — impossible combos (resolved-without-id, not_found-with-candidates, place-ambiguity-without-ids, empty-route-with-a-required-ref) are unrepresentable at construction. The `result_ref`/`route_ref` are opaque handles into the typed `SessionState` registry (§4e); the full payload lives there, never in the model-facing return. **Every clarify-producing outcome ATOMICALLY writes `pending_clarification` before returning to the model** (the normative transition table, §4c) so the strict clarify validator never `ModelRetry`-loops.

- **`resolve_anime(title: str)`** → discriminated `ResolveResult` mirroring §4a's `ResolveOutcome`:
  ```python
  class ResolveResolved(BaseModel):
      model_config = ConfigDict(extra="forbid")
      outcome: Literal["resolved"]
      bangumi_id: str
      anime_title: str
  class ResolveAmbiguous(BaseModel):
      model_config = ConfigDict(extra="forbid")
      outcome: Literal["needs_disambiguation"]
      clarification_reason: Literal["anime_ambiguity"]   # reason ON the outcome
      candidate_ids: list[str] = Field(min_length=2)
  class ResolveNotFound(BaseModel):
      model_config = ConfigDict(extra="forbid")
      outcome: Literal["not_found"]
      clarification_reason: Literal["anime_not_found"]
  class ResolveUpstreamDown(BaseModel):
      model_config = ConfigDict(extra="forbid")
      outcome: Literal["upstream_unavailable"]
  ResolveResult = Annotated[
      ResolveResolved | ResolveAmbiguous | ResolveNotFound | ResolveUpstreamDown,
      Field(discriminator="outcome"),
  ]
  ```
  The full candidate detail (titles/covers/years/counts) is written to `SessionState.pending_clarification` (§4e), not to the model-facing return. **Both `needs_disambiguation` AND `not_found` write `pending_clarification` atomically** (§4c table) — `not_found` writes it with `candidate_ids=[]` so the model's `clarify_response(reason=anime_not_found)` finds a matching pending. Docstring: *"outcome==resolved → call search_bangumi(bangumi_id). outcome==needs_disambiguation → emit clarify_response(reason=clarification_reason, candidate_ids). outcome==not_found → emit clarify_response(reason=anime_not_found) asking for a corrected title. outcome==upstream_unavailable → emit qa_response telling the user to retry. Never infer ambiguity from query length."* Thread `query` into the payload builder. Delete the "candidates ALWAYS present" / "single id + multiple candidates" text. The `candidate_ids` may originate from EITHER §4a source — a HIT-path exact-priority tie or the MISS-path name-similar set (v2.2 loose rule) — the tool contract and the pending-write are identical; downstream, the user may select **several** of them (multi-select, §4c selection contract).
- **`search_bangumi(bangumi_id: str)`** — **required**, pattern-constrained (`^\d+$`); no hidden session fallback. Calls `pointsByWorkId(bangumi_id)`. Remove `force_refresh`; remove `episode` (or wire it end-to-end to the catalog — default remove). Discriminated return:
  ```python
  class SearchOk(BaseModel):
      model_config = ConfigDict(extra="forbid")
      outcome: Literal["ok"]
      result_ref: str                # handle into SessionState.search_results
      row_count: int = Field(ge=1)
      anime_title: str | None = None
      partial: bool = False
  class SearchEmpty(BaseModel):
      model_config = ConfigDict(extra="forbid")
      outcome: Literal["empty"]      # STATUS, not a ModelRetry; no ref
      anime_title: str | None = None
  SearchToolResult = Annotated[SearchOk | SearchEmpty, Field(discriminator="outcome")]
  ```
- **`search_nearby(location: str | None = None, radius_m: int | None = None)`** — `location=None` means "use shared GPS"; `radius_m` is `> 0` or `None`. Geocode stays an internal step (and still records a `geocode` StepRecord — load-bearing for the eval chain, §7). The **`clarification_reason` is carried on the outcome** so the model never guesses it. **`place_ambiguity + []` is made unrepresentable by SPLITTING the place-clarify outcome into two variants** (P1-2), one that *requires* ≥2 ids and one that has *no* id field at all:
  ```python
  class NearbyOk(BaseModel):
      model_config = ConfigDict(extra="forbid")
      outcome: Literal["ok"]
      result_ref: str
      row_count: int = Field(ge=1)
  class NearbyEmpty(BaseModel):
      model_config = ConfigDict(extra="forbid")
      outcome: Literal["empty"]
  class NearbyPlaceAmbiguous(BaseModel):        # ambiguous place → ALWAYS >= 2 ids
      model_config = ConfigDict(extra="forbid")
      outcome: Literal["place_ambiguity"]
      clarification_reason: Literal["place_ambiguity"]
      place_candidate_ids: list[str] = Field(min_length=2)   # [] is UNREPRESENTABLE
  class NearbyPlaceUnresolved(BaseModel):       # too-broad / unknown → NO id field at all
      model_config = ConfigDict(extra="forbid")
      outcome: Literal["place_unresolved"]
      clarification_reason: Literal["place_too_broad", "unknown_place"]
  class NearbyMissingLocation(BaseModel):
      model_config = ConfigDict(extra="forbid")
      outcome: Literal["missing_location"]
      clarification_reason: Literal["missing_location"]
  NearbyToolResult = Annotated[
      NearbyOk | NearbyEmpty | NearbyPlaceAmbiguous | NearbyPlaceUnresolved | NearbyMissingLocation,
      Field(discriminator="outcome"),
  ]
  ```
  All three clarify-producing outcomes (`place_ambiguity`, `place_unresolved`, `missing_location`) write `pending_clarification` atomically (§4c table): `place_ambiguity` from `geocode_staging` (≥2 ordered candidates), the other two with `candidate_ids=[]`.
- **`plan_route(search_result_ref: str, pacing: Literal["chill","normal","packed"] | None = None, origin_location: str | None = None)`** — the model passes the **explicit** ref of the search it wants to route (fixes the stale-bangumi bug). **`plan_route` NEVER defaults `search_result_ref` to `last_result_ref` or any session value — the parameter is required and always model-supplied (P3-8).** `last_result_ref` (§4e) is exposed only as an anaphora hint in trusted context; it is never a tool default. Register with an explicit `Tool(plan_route, description=..., docstring_format=...)` so the description is not the malformed generated XML; add a **snapshot test** on the generated `ToolDefinition`. Propagate `pacing` to the catalog route contract; geocode `origin_location`→coords or drop; remove `start_time`. Discriminated return, incl. an explicit **stale-ref** outcome (an evicted/unknown ref is a typed outcome, not a crash):
  ```python
  class RouteOk(BaseModel):
      model_config = ConfigDict(extra="forbid")
      status: Literal["ok"]
      route_ref: str
      point_count: int = Field(ge=1)
      total_minutes: int
  class RouteEmpty(BaseModel):
      model_config = ConfigDict(extra="forbid")
      status: Literal["empty"]
  class RouteStaleRef(BaseModel):
      model_config = ConfigDict(extra="forbid")
      status: Literal["stale_ref"]   # search_result_ref not in SessionState.search_results
  RouteToolResult = Annotated[RouteOk | RouteEmpty | RouteStaleRef, Field(discriminator="status")]
  ```
- **REMOVE** `greet_user`, `general_qa`, `clarify` function tools entirely (see §4c — the model emits `greeting_response`/`qa_response`/`clarify_response` directly). `TOOLS` becomes the 4 catalog tools + 2 web tools (`web_search`, `translate_anime_title`).

**Why best practice.** Every param reaches the catalog or is gone (#5); domain outcomes are typed discriminated status, not `ModelRetry` (#1); the explicit `search_result_ref` + a typed `stale_ref` outcome make route inputs unambiguous and crash-free (#4/#6); splitting the place-clarify outcome makes "ambiguous with no candidates" impossible at construction (#6); `clarification_reason` on the outcome keeps the reason a data-layer decision (#2); compact returns keep the full payload in the registry (#7).

### 4c. Output layer + `validate_output` + server-owned RuntimeStage

**Current defect.** All 5 output models (`runtime_models.py`) are full-payload envelopes `{intent, message, data, ui}` that **each carry an `intent` model field** (e.g. `ClarifyResponseModel.intent: Literal["clarify"]`, :61). `AgentResult.intent` reads that field (`agent_result.py:39-40`, `str(self.output.intent)`). The wire **discards** model `data` for search/route (`response_builder.py:57-76`) yet **consumes** model `data` for clarify **unvalidated** (:54-56) → model-fabricated `cover_url`/`spot_count`/`city` ship to the frontend (P0-1). `validate_output` keys `has_payload` off the *model-declared* `output.intent` (`animichi_agent.py:707`): a model that ran `search_nearby` but declared `search_bangumi` triggers a false `ModelRetry` → burns budget → `UnexpectedModelBehavior`; the same mismatch on the chat path silently ships empty results (P0-2). `ClarifyCandidateModel` (:40-47) re-types titles with **no** `bangumi_id`. The `ui: dict[str,str]` field on all 5 models is **never read** (wire uses `_UI_MAP.get(intent)`, `response_builder.py:47`). `_DataCoercionMixin` (:31-37) is a MiMo-stringify band-aid.

**Target design — compact models, NO `intent`/`data`/`ui` field, server-owned stage.**

```python
class SearchResponseModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str                     # ONE short sentence; no rows/coords/ids/counts

class RouteResponseModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str

class ClarifyResponseModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: Literal["anime_ambiguity", "place_ambiguity", "place_too_broad",
                    "unknown_place", "missing_location", "anime_not_found"]
    message: str                     # one short line; do NOT restate options
    candidate_ids: list[str]         # stable ids; [] for non-candidate reasons

    @field_validator("candidate_ids", mode="before")
    @classmethod
    def _coerce_stringified_list(cls, v: object) -> object:
        # KEEP a narrow before-coercion: the new list[str] re-exposes MiMo's
        # JSON-string-list bug ('["1","2"]'). This is the ONLY coercion retained
        # after _DataCoercionMixin is deleted (P2-6 v2).
        return json.loads(v) if isinstance(v, str) else v

class QAResponseModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str

class GreetingResponseModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str

class PartialResponseModel(BaseModel):   # §4h — DISTINCT type (NOT QAResponseModel-shaped)
    model_config = ConfigDict(extra="forbid")
    message: str                     # locale-aware "partial results" notice
```

> **Reason enum (B1 + P1-2/P1-3):** the reason enum is **6** honest branches — `anime_ambiguity` (resolver tie), `anime_not_found` (0 works), `place_ambiguity` / `place_too_broad` / `unknown_place` (geocoder), `missing_location` (no GPS). Each carries its reason from the **tool outcome** (§4b), never a model guess. **`needs_direct_input` is DROPPED** from every enum, the cardinality rule, and the §5 UI table: it had **no producer** in the transition table (§4c below), so it was a dead, unreachable reason (Codex P1-2 / sonnet P1). Its "free-text answer, no candidates" intent is already covered by `place_too_broad`/`unknown_place`/`anime_not_found`.

Register each as a named output — `ToolOutput(SearchResponseModel, name="search_response")`, etc. (already the shape at `animichi_agent.py:511-517`); `PartialResponseModel` is server-emitted only (the runner constructs it on `UsageLimitExceeded`, §4h) and is NOT offered to the model as an output tool.

**Server-owned RuntimeStage (P1-4 — the output object does NOT carry the tool name).** `AgentRunResult.output` is just the model instance; `ToolOutput(name=)` names the *tool shown to the model*, which is **not** reachable from `output`. So the top-level intent can no longer be read off `output.intent`. Introduce a server-owned map computed at the runner boundary and **stored on `AgentResult`**:

```python
# runner boundary
_STAGE_BY_OUTPUT: dict[type, str] = {
    SearchResponseModel:   "search",       # refined below
    RouteResponseModel:    "route",        # refined below
    ClarifyResponseModel:  "clarify",
    QAResponseModel:       "general_qa",
    GreetingResponseModel: "greet_user",
    PartialResponseModel:  "partial",      # §4h — graceful-limit stage
}
def runtime_stage(output: RuntimeStageOutput, steps: list[StepRecord]) -> str:
    top = _STAGE_BY_OUTPUT[type(output)]
    if top == "search": return _last_search_tool(steps)  # -> "search_bangumi" | "search_nearby"
    if top == "route":  return _last_route_tool(steps)   # -> "plan_route" | "plan_selected"
    return top                                            # clarify / general_qa / greet_user / partial
# The deterministic selection handlers BYPASS the agent and set `intent` directly on
# AgentResult: execute_selected_route -> "plan_selected", execute_multi_selection -> "plan_multi"
# (v2.2, §4c selection contract) — neither goes through this map.
```

The returned **string values are byte-identical to today's `_UI_MAP` keys and today's `output.intent` values** (plus the new `"partial"`), so persistence, analytics, and `_UI_MAP` see no change in the existing value space — only in *where the value comes from*. Sub-intent (`search_bangumi` vs `search_nearby`, `plan_route` vs `plan_selected`) is derived from `ctx.deps.steps` — this is also the P0-2 fix. `AgentResult` gains fields (`intent` becomes a stored field; the typed carrier arrives, §4e; and `status` + a `success` override for the partial path, §4h):

```python
@dataclass
class AgentResult:
    output: RuntimeStageOutput
    intent: str                       # SERVER-OWNED, set by the runner (was a property reading output.intent)
    session_state: SessionState       # typed carrier for response_builder (P2-8)
    steps: list[StepRecord] = field(default_factory=list)
    tool_state: LegacyPayload = field(default_factory=dict)   # retained during migration
    new_messages: list[ModelMessage] = field(default_factory=list)
    usage: RunUsage | None = None
    status: str | None = None         # §4h: None → response_builder derives as today; "partial" on the graceful path;
                                      #   "empty" | "too_large" | "error" on the deterministic multi-selection terminals (v2.3, §4c terminal matrix)
    success_override: bool | None = None  # §4h: None → step-derived; False on the graceful partial path
    # message stays a property reading output.message (message survives on the compact models)
    # success stays a property; returns success_override when set, else all(s.success for s in steps) or True
```

**Consumers that MUST migrate atomically** (all move in the ONE atomic switch, §6 Phase 1c — this is why removing `output.intent` cannot be phased piecemeal, P1-4/P1-5):

| Consumer | file:line | Change |
|---|---|---|
| `AgentResult.intent` | `agent_result.py:39-40` | property → stored field set by runner from `runtime_stage(...)` |
| runner: build `AgentResult` | `animichi_runner.py:120-131` | compute `runtime_stage`, set `intent` + `session_state`; log server-owned intent |
| `response_builder.agent_result_to_response` | `response_builder.py:47-80` | `_UI_MAP.get(result.intent)` (server-owned); branch on output **type** (isinstance), not `output.intent`; build `data` from `result.session_state` registry, not `output.data`; add a `PartialResponseModel` branch (§4h) using `result.status`/`result.success` + `last_result_ref` projection; **`intent=="plan_multi"` → DUAL projection: `data.results` from the merged `last_result_ref` AND `data.route` from the newest route ref (v2.3)** |
| `_UI_MAP` | `response_builder.py:13-23` | drop BOTH dead keys — `answer_question` (:19, collapse to `general_qa`) AND `unclear` (:21) — and ADD `"partial": "GeneralAnswer"` (§4h/§5) **and `"plan_multi": "RoutePlannerWizard"` (v2.2 multi-select, §4c/§5)**; keep all other values stable |
| chat `_make_on_complete` merge | `chat.py:106-124` | build the `DataChunk` from `result.session_state` + server-owned `runtime_stage`; stop reading `data.get("intent")` (:117) / `output.data` (deleted) |
| chat pending-detection | `chat.py:49-92` (`_scan_parts_for_clarify`/`_detect_clarify_context`) | DELETE the body-scan; load `pending_clarification` from the persisted session via `x-session-id`; accept the choice via the mapped `selected_candidate_ids` (list, v2.2)/`clarification_id` (selection contract below) |
| chat endpoint | `chat.py:129-171` (`handle_chat`) | **route `/v1/chat` through the unified runtime/session boundary** (P1-3a) — see the `/v1/chat` migration note below |
| selected-route builder | `selected_route.py:88-119` (`_build_success_result`, `_error_result`) | **the only non-runner `AgentResult` + `RouteResponseModel` producer** (P1-3b) — see the selected-route migration note below |
| eval `_available_data_keys` | `evaluators.py:141-148` | stop reading `getattr(result.output, "data", ...)` (deleted); **recompute `data_keys` from the new SessionState-sourced keys** (§7; the legacy-key compatibility projection is DROPPED per the v2.2 re-baseline decision) |
| eval stage→chains | `evaluators.py:67-76` | **re-derive the expected chains from the new REAL trajectories** as part of the re-baseline (§7) — no step is synthesized to keep old chains green |
| persistence `response_intent` | `persistence.py:79`, `session_facade.build_updated_session_state` | reads `result.intent` (now server-owned; same string values) |
| route persistence `maybe_persist_route` | `persistence.py:270-340`, `repositories/routes.py:18` (`save_route`/`get_user_routes`) | **MIGRATING CONSUMER (v2.3; owner decision 2026-07-16 = normalized JOIN TABLE):** the gate widens from `intent == "plan_route"` (:278) to `intent ∈ {"plan_route", "plan_selected", "plan_multi"}`; anime identity moves to `route_anime` association rows sourced from typed `SessionState` (the route-persistence block below); the `plan_params`/`infer_bangumi_id` dict-digging path (:298-303, :361-371) is DELETED |
| analytics / span attrs | `public_api.py:210-235` (`runtime.intent`) | reads `response.intent` (same string values, plus the new `partial` / `plan_multi`) |
| output models | `runtime_models.py` (all 5 + new `PartialResponseModel`) | delete `intent` + `data` + `ui` fields; delete `_DataCoercionMixin` (keep only the `candidate_ids` before-coercion) |
| selection dispatch (`_run_pipeline`) | `public_api.py` (sibling of the `selected_point_ids` branch) | **NEW (v2.2; dispatch corrected v2.3):** a request carrying `selected_candidate_ids` is mode-validated (request-mode exclusivity, below), validated against `pending_clarification`, then dispatched **BY `pending_clarification.reason`** — `anime_ambiguity → execute_multi_selection`; `place_ambiguity → execute_place_selection` — BOTH deterministic sibling handlers that BYPASS `animichi_agent.run`, exactly like `selected_point_ids → execute_selected_route` (§4c selection contract). The field alone NEVER dispatches: both reasons arrive on the SAME `selected_candidate_ids` field and only the pending reason disambiguates (v2.3, sonnet P1-1) |

`response_builder` builds the **entire** `data` payload from `result.session_state`: search/route rows come from the ref-keyed registry (§4e); clarify **hydrates** `candidate_ids → cards` from `SessionState.pending_clarification.ordered_candidates` (stable id → trusted title/cover/city/count).

**selected-route migration (P1-3b / sonnet P2).** `selected_route.py` is the ONLY producer of `AgentResult` + `RouteResponseModel` outside the runner. Today `_build_success_result` (:88-107) builds `RouteResponseModel(intent="plan_selected", message=…, data=RouteDataModel(route=route_model))` (:96-100) and `AgentResult(output=…, steps=…, tool_state=tool_state.to_legacy_dict())` (:103-107) — and `_error_result` (:110-119) mirrors it. Both use `RouteResponseModel(intent=, data=)` (both fields §4c-deleted) and `AgentResult()` without the now-required `intent`/`session_state`. Required changes (atomic, in Phase 1c): build the compact `RouteResponseModel(message=…)`; **write the route payload into `SessionState.routes[route_ref]`** (via the ref factory, §4e) and set `last_result_ref`/route ref; construct `AgentResult(output=…, intent="plan_selected", session_state=<the populated SessionState>, steps=…)`; drop `intent`/`data` from the model. **Silent-empty-itinerary guard (RED):** because `response_builder` now hydrates `data.route` from `session_state.routes`, an `AgentResult(session_state=SessionState())` with an empty registry ships an **empty itinerary** — a contract test MUST assert the selected-route path populates `session_state.routes` and that `response_builder` renders the ordered points (not `{}`).

**`/v1/chat` migration (P1-3a).** `handle_chat` (`chat.py:129`) calls `VercelAIAdapter.dispatch_request` directly (:165-171), receives an `AgentRunResult` (not `AgentResult`), and **never builds `PublicAPIRequest`/`AgentResult`** — so adding `selected_candidate_ids`/`clarification_id` to `PublicAPIRequest` cannot, by itself, replace its `_detect_clarify_context` body-scan; and it never reads `x-session-id` to load persisted pending state (the deps are built fresh at :153-158). **Decision (recommended default): route `/v1/chat` through the unified runtime/session boundary** — reuse the same session load + pending-clarification read + selection validation + `response_builder` projection as the primary path, keeping ONLY the Vercel streaming envelope. Concretely: (1) read `x-session-id` and load `pending_clarification`/`current_anime` from persisted session state (same primitive as the unified boundary); (2) map the Vercel request body's selection (a data-part or the mapped `selected_candidate_ids` (list) + `clarification_id`) into the SAME server-side selection validation + `execute_multi_selection` dispatch (§ selection contract); (3) delete `_scan_parts_for_clarify`/`_detect_clarify_context`; (4) `_make_on_complete` builds its `DataChunk` from `result.session_state` + the server-owned `runtime_stage`, not `output.model_dump()["intent"]`/`output.data`. *(Fallback if the owner rejects sharing the boundary: `/v1/chat` MUST define its OWN documented Vercel request-body/session/selection protocol — a body field carrying the selection list + the revision token, an `x-session-id` pending load, and a `runtime_stage`-based DataChunk — and that protocol is enumerated in this table. Either way `/v1/chat` is a first-class migration consumer, not an afterthought.)*

**Route persistence for the route-producing paths (v2.3 — OWNER DECISION 2026-07-16: normalized JOIN TABLE, "no historical baggage").** Today `maybe_persist_route` (`persistence.py:270`) persists ONLY `intent == "plan_route"` with a REQUIRED single `bangumi_id` (the :278 gate; :298-303 digs it from `plan_params`/`infer_bangumi_id` and silently bails on None) into the single `routes.bangumi_id` column (`repositories/routes.py:18` `save_route`; DDL `supabase/migrations/20260402120000_remote_schema.sql:121-132`: `bangumi_id TEXT REFERENCES bangumi(id)`, nullable, indexed at :162; `get_user_routes` JOINs `bangumi` through it). Consequences today: a `plan_multi` route would **silently vanish from saved history**, `plan_selected` routes are ALREADY silently skipped, and the schema cannot represent a multi-work route. The owner rejected the hedged "nullable column + `anime_ids` in the JSON payload" option in favor of the clean normalized design:
- **Additive migration — `route_anime(route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE, bangumi_id TEXT NOT NULL REFERENCES bangumi(id), PRIMARY KEY (route_id, bangumi_id))`** + an index on `bangumi_id`. One route ↔ many anime — the normalized association; a single-anime route is simply the 1-row case.
- **In the SAME migration: backfill, then DROP the single column.** `INSERT INTO route_anime (route_id, bangumi_id) SELECT id, bangumi_id FROM routes WHERE bangumi_id IS NOT NULL`, then DROP `routes.bangumi_id` + its index — anime identity has exactly ONE source of truth (the join table): no dual-write, no legacy single-column read path. (The column is nullable today with nothing else constraining the drop; existing saved routes keep their identity via the backfill — preserving DATA is not "historical baggage," preserving the shape would be.)
- **`maybe_persist_route` (the migrating consumer, table above):** the gate widens to `response.success AND intent ∈ {"plan_route", "plan_selected", "plan_multi"}`. Anime ids come from **typed `SessionState`, never dict-digging** (the `plan_params.get("bangumi")`/`infer_bangumi_id` row-inspection path is deleted): read the produced route's `RoutePayloadState.source_ref` → `search_results[source_ref]` — `kind="bangumi"` → `[anime_id]` (1 row); `kind="multi"` → `anime_ids` **minus `omitted_work_ids`** (the works that actually contributed rows, selection order — N rows); `kind="nearby"` → the DISTINCT `bangumi_id`s of the payload `rows` in first-occurrence order (the works the route actually touches — 0..M rows; this REPLACES today's silent bail-out, the same vanishing-route bug class); `plan_selected` (no source search) → the DISTINCT `bangumi_id`s of its routed rows (typically 1). **ONE uniform write path:** the route row + one `route_anime` row per derived anime id.
- **Repo contracts:** `save_route(session_id, anime_ids: list[str], point_ids, route_data, …)` — the single-`bangumi_id` parameter is REPLACED, and the insert writes the association rows in the same transaction; `get_user_routes` returns each route's `anime_ids` (+ display titles) via `route_anime JOIN bangumi`, association order preserved (insert order = derivation order above).
- **Persistence tests (all intents through the ONE path):** `plan_route` → 1 association row; `plan_selected` → 1; `plan_multi` (3 selected works, 1 empty) → 2 rows in selection order; nearby-sourced → the touched works (and the route row persists); list/read returns the joined `anime_ids`; the backfill migration preserves every pre-migration route's identity. -> unit + integration

**`validate_output` redesign** (`animichi_agent.py:682-719`):
- (a) **Derive sub-intent from `ctx.deps.steps`, not `output.intent`** — fixes P0-2 (false `ModelRetry` + silent empty ship). `search_bangumi` vs `search_nearby` and `plan_route` vs `plan_selected` come from the last relevant step.
- (b) **Keep the anti-fabrication gate**: a `search_response`/`route_response` with no corresponding registry payload → `ModelRetry`. Close the zero-tool fabrication bypass (a search/route output with *no* steps must not validate).
- (c) **ADD the complete clarify guard** (fixes P0-1 *and* closes the v1 gaps, P1-3):
  - **Reject clarify when no `pending_clarification` exists** in `SessionState` — a clarify emitted with nothing pending is a fabrication → `ModelRetry`. *(This is safe ONLY because the transition table below guarantees every clarify-producing outcome wrote pending atomically first.)*
  - **`output.reason == SessionState.pending_clarification.reason`** (the model may not relabel the reason).
  - **`output.candidate_ids` equals `pending_clarification.candidate_ids` by EXACT ORDERED equality** (no omit/reorder/invent).
  - **Reason-specific cardinality:** `anime_ambiguity`/`place_ambiguity` → `len >= 2`; `place_too_broad`/`unknown_place`/`missing_location`/`anime_not_found` → `== []`.

**Normative TOTAL clarify transition table (P1-2 — every clarifying outcome writes pending ATOMICALLY).** The strict "reject clarify when no `pending_clarification`" guard is only safe if EVERY clarify-producing tool outcome writes `pending_clarification(reason, ordered_candidates=[] for no-candidate reasons, fresh revision = ++clarification_revision)` into `SessionState` **at the moment the outcome is returned to the model** — before the model can emit `clarify_response`. Otherwise `ResolveNotFound` / `NearbyMissingLocation` / `NearbyPlaceUnresolved` would surface a clarify with nothing pending → `ModelRetry` loop → the exact thrash this redesign kills. The table is TOTAL over the clarify-producing outcomes (§4b):

| Producer (tool → outcome, §4b) | Union variant | `reason` written | pending payload written atomically (§4e) | accepted next request | consume action | CLEAR / revision |
|---|---|---|---|---|---|---|
| `resolve_anime → needs_disambiguation` | `ResolveAmbiguous` | `anime_ambiguity` | `candidate_ids=[≥2 bangumi_ids]` (HIT tie OR MISS name-similar, §4a), `ordered_candidates=[…]`, `revision=++` | `selected_candidate_ids` (list, len ≥1, EVERY id ∈ `candidate_ids`, deduped) + `clarification_id == revision` | **`execute_multi_selection(selected_candidate_ids)` → merged + deduped search + route over the merged set (§4e)** | clear pending + bump revision on a shipped-route terminal (T1–T3); PRESERVED on T4/T5/T6 (v2.3 terminal matrix, below) |
| `resolve_anime → not_found` | `ResolveNotFound` | `anime_not_found` | `candidate_ids=[]`, `ordered_candidates=[]`, `revision=++` | free-text `text` (corrected title) | re-run `resolve_anime(text)` | cleared by next non-clarify terminal; a new clarify replaces w/ fresh revision |
| `search_nearby → place_ambiguity` | `NearbyPlaceAmbiguous` | `place_ambiguity` | `candidate_ids=[≥2 gazetteer ids]` (from `geocode_staging`), `ordered_candidates=[…]`, `revision=++` | `selected_candidate_ids == [exactly ONE id ∈ candidate_ids]` (multi-place selection rejected as invalid) + `clarification_id == revision` | **`execute_place_selection(gazetteer_id)`** (v2.3, below): staged coords → deterministic nearby search — no re-geocode, no agent run | clear pending, bump revision |
| `search_nearby → place_unresolved` | `NearbyPlaceUnresolved` | `place_too_broad` \| `unknown_place` | `candidate_ids=[]`, `ordered_candidates=[]`, `revision=++` | free-text `text` (narrower place) | re-run `search_nearby(location=text)` | cleared by next non-clarify terminal; a new clarify replaces w/ fresh revision |
| `search_nearby → missing_location` | `NearbyMissingLocation` | `missing_location` | `candidate_ids=[]`, `ordered_candidates=[]`, `revision=++` | free-text `text` OR shared GPS | re-run `search_nearby(location=text or GPS)` | cleared by next non-clarify terminal; a new clarify replaces w/ fresh revision |

- **Atomic write site (§4e):** the write happens in the tool handler as it constructs the clarify-bearing outcome — the same `SessionState` mutation that stages candidates (`geocode_staging → pending_clarification` for `place_ambiguity`; a direct empty-candidate write for `not_found`/`place_unresolved`/`missing_location`). The validator then always finds a matching `pending_clarification`; the reject-when-no-pending path fires ONLY on a genuine fabrication.
- **No-candidate consume + CLEAR:** for the free-text reasons (`anime_not_found`/`place_too_broad`/`unknown_place`/`missing_location`) there is no selection — a request carrying `selected_candidate_ids` against an empty-candidate pending is rejected as invalid; the next user turn is ordinary `text`. The server does NOT relatch — `pending_clarification` is set ONLY by a clarify-producing outcome (always with a fresh, monotonically bumped `revision`) and is cleared the moment the next turn yields any non-clarify terminal outcome (a `resolved→search`, `ok`, route, greet, qa), or replaced by a fresh-revision pending if the retry clarifies again. This is the explicit CLEAR transition (§4e) that replaces the sticky OR (`session_facade.py:165`).

**Clarify-SELECTION request contract (P1-4; v2.2 = MULTI-SELECT, owner Decision 3).** The current chat path detects a pending clarify by scanning history for the removed `clarify` tool call — that must be replaced by an explicit request field + server validation. v2.2 makes the selection a LIST (the v2.1 single `selected_candidate_id` is REPLACED — ONE uniform path; single-select = a list of 1):
- `PublicAPIRequest` gains `selected_candidate_ids: list[str] | None` (len ≥1 when present) and **`clarification_id: int | None`** (`schemas.py:14-53`). **`clarification_id` is `int` to match `pending_clarification.revision: int` (§4e)** — a `str` field would make `str == int` always `False` and silently reject every valid selection (sonnet P3-a). *(If the transport can only carry a string, the server MUST coerce `int()` before comparison and reject a non-integer as a stale/invalid click.)* `selected_candidate_ids` are the anime/place choices from a clarify card (distinct from the existing `selected_point_ids`, which is route point selection).
- **Request-mode EXCLUSIVITY (v2.3).** A request is exactly ONE of three mutually exclusive modes, checked BEFORE any other validation or dispatch: **(1) point-selection** (`selected_point_ids` present), **(2) candidate-selection** (`selected_candidate_ids` present), **(3) plain text** (neither present). Mixed modes — `selected_point_ids` + `selected_candidate_ids` together, or a selection alongside non-empty `text` — are rejected with the typed invalid-request response. `clarification_id` is required **IFF** the request is candidate-selection mode: a candidate selection without `clarification_id` is invalid, and a `clarification_id` without `selected_candidate_ids` is invalid. `selected_candidate_ids` are **normalized (trimmed) + first-occurrence-deduped BEFORE the cardinality check** — `["A","A"]` is a place-selection of exactly one, not a rejected pair; a list that is empty after normalization is invalid. **Every invalid/ambiguous request preserves `pending_clarification` untouched** (no clear, no revision bump) — the clarify card stays live. -> unit + api
- **Validation (server, before any dispatch):** `clarification_id == pending_clarification.revision` AND **EVERY id ∈ `pending_clarification.candidate_ids`** — if the revision mismatches or ANY id is not a pending candidate, the click is **stale/invalid** and is rejected with a typed "this choice expired, please try again" response; it does NOT re-run resolution and does NOT clear the pending. Duplicate ids in the list are deduped server-side preserving first occurrence. **Reason-specific selection cardinality:** `anime_ambiguity` → 1..len(candidate_ids); `place_ambiguity` → exactly 1 (a nearby search targets ONE place; len > 1 is rejected as invalid); free-text reasons (`candidate_ids=[]`) → any selection is invalid.
- **On a valid selection the server consumes it deterministically and CLEARS pending + bumps `clarification_revision` (§4e):** `anime_ambiguity` → **`execute_multi_selection(selected_candidate_ids)`** (below); `place_ambiguity` → **`execute_place_selection(<the one gazetteer id>)`** (v2.3, below), so a place choice reaches the search by stable id + staged coordinates, not re-typed prose (closes the B4 place-selection gap).

**NEW deterministic server handler — `execute_multi_selection(candidate_ids: list[str], …)` (v2.2, owner Decision 3).** Analogous to `execute_selected_route`: invoked by `_run_pipeline` when the request carries `selected_candidate_ids`, it **BYPASSES `animichi_agent.run` entirely** — this is user-selection-triggered deterministic app code, NOT model orchestration and explicitly **NOT CodeMode** (merge/dedup/route is computed in the data layer per principles #2 and #10; the prior CodeMode spike was already killed). Behavior:
1. **Fetch:** for each validated `work_id`, call the Phase-1a catalog `pointsByWorkId(work_id)` **in parallel** (`asyncio.gather(..., return_exceptions=True)`). **`pointsByWorkId` returns a plain `SearchResult {rows, synced_at, partial?}` (`search.ts:130` — it IS `hitResult`, published points only): it has NO typed `upstream_unavailable` outcome and does NOT ingest** — so failure handling lives AT THE HANDLER (v2.3): a per-work thrown fetch error (network/oRPC/5xx) marks that work `fetch_failed`; a work returning `rows=[]` — **including an un-ingested Bangumi-only MISS candidate with no catalog points** — is a valid `empty` work (**this handler NEVER triggers ingest/preview**; ingest stays a resolve/search-path concern). Per-work `partial:true` propagates into the merged payload. The terminal outcome is decided by the matrix below.
2. **Merge + dedup:** apply the defined deterministic merge op (§4e) — union of rows in selection order, **dedup by stable point id** (franchise works share spots; first occurrence wins), stable ordering — producing ONE combined `SearchPayloadState(kind="multi", anime_ids=[…])` written to `SessionState.search_results[ref]` (+ `last_result_ref`).
3. **Route:** run the SAME deterministic route op `plan_route` uses (nearest-neighbor ordering) over the **merged, deduped set**, writing `RoutePayloadState(source_ref=<merged ref>)` into `SessionState.routes[route_ref]`.
4. **Result:** construct `AgentResult(output=RouteResponseModel(message=<server-composed, locale-aware>), intent="plan_multi", session_state=<the populated SessionState>, steps=<deterministic StepRecords: one fetch step per work + the route step>)`; `response_builder` projects `data.results` (merged grid) + `data.route` (merged itinerary); `_UI_MAP["plan_multi"] = "RoutePlannerWizard"` (§5). Single-select (`len == 1`) takes the SAME path (merge of one = that work's points; dedup is a no-op) — one uniform path, no special case.

**Terminal matrix (v2.3 — TOTAL over the handler's outcomes; steps 1–4 above are T1).** Let `fetched` = works whose fetch returned, `failed` = works whose fetch threw, `nonempty` = fetched works with ≥1 row, `merged` = the §4e merge/dedup over `nonempty`. All messages are server-composed and locale-aware. T4–T6 extend the `AgentResult.status` vocabulary (§4c fields) with `"empty" | "too_large" | "error"` on this server-composed path only; `intent` stays `"plan_multi"` on every row (analytics see the attempted stage).

| # | Condition | Terminal result | route? | `pending_clarification` |
|---|---|---|---|---|
| T1 | all works nonempty, within caps | SUCCESS (steps 2–4): merged `SearchPayloadState(kind="multi")` + route | yes | **CLEARED** + revision bump |
| T2 | MIXED-empty: some works empty (incl. un-ingested candidates), `merged.rows ≥ 1` | SUCCESS over the `nonempty` works; the empty works go to `SearchPayloadState.omitted_work_ids` (§4e) and are named in the message | yes | **CLEARED** + revision bump |
| T3 | MIXED-failed: some fetches threw, `merged.rows ≥ 1` | SUCCESS over the fetched works; failed works → `omitted_work_ids`, `partial=true`, message notes the omission | yes | **CLEARED** + revision bump |
| T4 | ALL-empty: every fetched work has 0 rows, `failed` empty | **typed EMPTY terminal — NO route is built** (mirrors the selected-route silent-empty RED guard, §4c; `RouteOk.point_count ge=1` keeps an empty itinerary unrepresentable): `status="empty"`, `success_override=False`, a "no catalog spots for the selected works yet — pick different ones?" message, `data.results` = the empty merged payload (`kind="multi"`, `rows=[]`, the selected `anime_ids`), NO `data.route` key | **no** | **PRESERVED** (recoverable: UNSELECTED candidates on the card were never fetched — re-picking others can succeed; no permanent latch — the next non-clarify terminal still clears it, §4e) |
| T5 | ALL-failed: every fetch threw | typed ERROR terminal mirroring `selected_route._error_result` (:110-119): `status="error"`, `success_override=False`, a retry message, NO registry refs written | no | **PRESERVED** (recoverable — the SAME selection may be retried; revision unchanged, card stays live) |
| T6 | ROUTE-TOO-LARGE: `len(merged.rows) > 500` (`MAX_ROUTE_POINT_IDS`, `router.ts:55`) — **pre-checked at the handler BEFORE calling the route op** — OR the catalog route rejects with the typed `routeTooManyClusters` 400 (`MAX_ITINERARY_CLUSTERS = 50`, `lib/route.ts:54`, enforced `api/route.ts:76`), which the handler catches | typed TOO-LARGE terminal: `status="too_large"`, `success_override=False`, a "too many spots — narrow your selection" message, `data.results` = the merged grid (the registry entry IS written; the user sees what they picked), NO `data.route` — **never a crash, never a raw 400/500 pass-through** | no | **PRESERVED** (recoverable by re-ticking FEWER works on the SAME card; revision unchanged) |

**Pending rule (normative — refines the §4c transition-table `anime_ambiguity` CLEAR cell):** `pending_clarification` is cleared **only when a route ships** (T1–T3); it is **preserved on T4/T5/T6 and on every invalid request** (request-mode exclusivity above). Preservation never re-latches: the §4e clear transition still clears pending on the next non-clarify terminal of a later turn.

**Boundary tests (v2.3):** 500 merged points → routes; **501 → T6** (pre-check). 50 clusters → routes; **51 → T6** (typed `routeTooManyClusters` catch on a clustered fixture). ALL-empty → **T4** with NO `route` key in `data` (contract test mirrors the selected-route silent-empty guard) and pending PRESERVED (a follow-up selection of DIFFERENT candidates with the SAME `clarification_id` succeeds). MIXED-empty → **T2** (route over the non-empty works; `omitted_work_ids` populated). An un-ingested Bangumi-only candidate in the selection → counted empty; **ZERO ingest calls recorded** (mock asserts no ingest). ALL-failed → **T5** with pending preserved. MIXED-failed → **T3**. -> unit + integration

**NEW deterministic server handler — `execute_place_selection(gazetteer_id: str, …)` (v2.3 — closes the place-consume dispatch gap, sonnet P1-1).** The `place_ambiguity` sibling of `execute_multi_selection`: `_run_pipeline` dispatches to it when a validated candidate-selection's `pending_clarification.reason == "place_ambiguity"` — dispatch is **BY REASON**, never by field (both reasons share `selected_candidate_ids`). It BYPASSES `animichi_agent.run` entirely; deterministic app code, NOT CodeMode. Behavior:
1. **Validate:** exactly ONE id (place cardinality, above) ∈ `pending_clarification.candidate_ids` + `clarification_id == revision` — the SAME shared selection validation, reason-specific cardinality applied.
2. **Coords from staging:** read the selected candidate's `lat`/`lng` from `pending_clarification.ordered_candidates` (§4e — `OrderedCandidate` carries coords for gazetteer candidates, v2.3) — **no re-geocode, no re-resolution**; the selection consumes the staged data.
3. **Search:** run the SAME deterministic nearby-search op the `search_nearby` tool uses, from the staged coords (+ the staged radius when the pending search recorded one, else the default), writing `SearchPayloadState(kind="nearby")` into `SessionState.search_results[ref]` + `last_result_ref`.
4. **Result:** `AgentResult(output=SearchResponseModel(message=<server-composed, locale-aware>), intent="search_nearby", session_state=<the populated SessionState>, steps=[ONE deterministic `search_nearby` StepRecord])` — `_UI_MAP` needs NO new key (`search_nearby → NearbyMap`, §5). An empty nearby result is the same typed empty handling as the tool's `empty` outcome (an empty results payload + a "no spots near the chosen place" message) — never a crash.
5. **Clear:** on the terminal (rows OR empty — both are definitive answers for the chosen place) clear `pending_clarification` + bump the revision; a thrown search failure mirrors T5 (typed error, pending PRESERVED). `current_anime` is untouched — a place choice changes location, not anime identity.

**Thrash-safety (unchanged by multi-select):** no model runs anywhere in EITHER selection path (`execute_multi_selection` / `execute_place_selection`, v2.3) — validation, fetch, merge, dedup, route, and the place-selection consume are all deterministic server code; the clarify that produced the card was itself a one-step terminal output (§4a/§4c). Multi-select adds product capability with ZERO new model round-trips.

**Why best practice.** `ToolOutput(name=)` per stage is the idiomatic pydantic-ai multi-output pattern; but because the tool name is not on `output`, a *server-owned* stage map is the correct place to recover top-level intent — and deriving sub-intent from steps removes a whole class of model-lie failures. Validating `candidate_ids == authoritative state` by ordered equality *and* `reason` *and* cardinality is the trust-boundary discipline the codebase already applies to search/route, extended completely to clarify. The revision token is the standard defense against stale optimistic-UI clicks. And keeping the multi-selection consume as a deterministic server handler — a sibling of `execute_selected_route`, not model orchestration and not CodeMode — is principle #2 ("compute decisions in the data layer") + principle #10 ("no skills/CodeMode") applied at the selection boundary.

### 4d. Instructions

**Current defect.** `_INSTRUCTIONS` (`animichi_agent.py:90-196`) hardcodes the "short/vague vs specific" heuristic verbatim (L107-121, a duplicate of the `resolve_anime` docstring), instructs **tool calls for removed tools** (`clarify()`/`greet_user()`/`general_qa()` at L111/115/145-147/160/165-166), contains "STOP and wait after clarify()" scaffolding (L118-121), an absolute "no text on clarify" rule (L120-121) that conflicts with the required `ClarifyResponseModel.message`, and states locale twice (L154 + the dynamic injector). The dynamic `_inject_session_context` (`animichi_agent.py:549`, composed in the `before_model_request` hook at :571) writes per-turn volatile state into the **system block** → busts the provider prompt cache every turn, in tension with `ManagedPrompt` (label `production`), throws away candidate ids, and re-implements dynamic instructions inside a hook (non-idiomatic).

**Target design.** Rewrite `_INSTRUCTIONS` to **~45–60 lines**:
- Role + job (unchanged intent).
- The 5 model-emitted output types (emit exactly one). *(The 6th, `PartialResponseModel`, is server-emitted only, §4h — the model never selects it.)*
- **Routing = branch on the tool `outcome`, never on query judgment.** Replace L107-121 with an outcome table: `resolve_anime.outcome==resolved → search_bangumi`; `==needs_disambiguation → emit clarify_response(reason=clarification_reason, candidate_ids)`; `==not_found → emit clarify_response(reason=anime_not_found)`; `==upstream_unavailable → emit qa_response("try again")`; `search_nearby.outcome` maps analogously — `==place_ambiguity → clarify_response(reason=place_ambiguity, place_candidate_ids)`; `==place_unresolved → clarify_response(reason=clarification_reason, [])`; `==missing_location → clarify_response(reason=missing_location, [])`. Add the explicit line: *"Never infer ambiguity from query length."*
- **Compact-output rule (lands atomically with §4c; message length is SIZED TO THE RESPONSE — owner refinement 2026-07-16):** *"Write a natural message sized to the response. For the DATA-BEARING stages (search / route / clarify) a brief 1–2 sentence wrapper is enough — the app renders the rich generative UI (spots, map, cards, itinerary) from the data, so do not narrate it. For `general_qa` write a FULL, appropriately-long answer — your prose IS the content there; never truncate a QA answer to one line. In EVERY case you NEVER transcribe structured data — never re-type points, coordinates, IDs, counts, titles, or route legs; the app fills ALL of that from the typed SessionState registry. The ONLY identifiers you may ever echo are the `candidate_ids` handed to you by a clarify tool outcome."* (Two things resolved here: the "echo candidate_ids vs never-transcribe-IDs" contradiction, P2-1/#4 — `candidate_ids` is the sole permitted ID echo; and the owner's QA-length carve-out — the compaction is about NOT re-authoring data the app owns, NOT about capping prose. `QAResponseModel.message` carries no length constraint; the data-bearing models' `message` is a brief wrapper by instruction, not by schema.)
- **`web_search` rule (#9, P2-9):** *"web_search returns attributed prose for QA only. Never merge web results into a search or route response and never present them as pilgrimage points."*
- Multi-turn: anaphora resolved from conversation history + the injected session context (below); drop the per-turn state *restatement in the system block*. **`plan_route` still takes an explicit `search_result_ref` — the anaphora hint (`last_result_ref`, §4e) is context, not a default (P3-8).**
- **KEEP the untrusted-tool-output invariant (L184-195) verbatim** — it is correct and load-bearing (§8).
- Single locale line.
- DELETE: the heuristic + STOP scaffolding, all tool-call framing for removed tools, the absolute "no text on clarify," and any eager naming of deferred web tools.

**Cache-neutral dynamic wiring (P2-1 — resolve the v1 contradiction).** v1 said *both* "pass volatile state via `instructions=`" *and* "via user-turn/history, never the system block" — these are different mechanisms, and pydantic-ai marks dynamic-instruction functions as **UNcached** parts (`messages.py`). Resolution:
- `instructions=` carries **only static role + locale** (fully cacheable; composes with `ManagedPrompt.get_instructions`).
- **Volatile typed session context** (`current_anime`, a lightweight anaphora marker = `last_result_ref`, and the pending-clarification candidate ids) is serialized into a **trusted USER/history part at the runner boundary** — never into the cached system prefix, and never via a dynamic-instruction fn. This keeps the ManagedPrompt prefix cache-stable across turns.
- Do **not** mutate the system block in `before_model_request`; keep that hook only for `run_error` recording.
- Fix the 2 s event-loop block (`_wait_for_prompt_resolution`, `animichi_agent.py:199-202`): `asyncio.wait_for(asyncio.wrap_future(future), timeout)` instead of `future.result(timeout=2.0)`.
- Rewrite the local `_INSTRUCTIONS` and the remote Logfire `production` prompt **in lockstep** and add a drift/version pin-test that fails CI if they diverge.

**Why best practice.** pydantic-ai's `instructions=` (static string + composed static parts) is the sanctioned cacheable assembly point; volatile state belongs in a trusted history/user part, not the cached prefix (the ManagedPrompt caching contract). Routing on a typed `outcome` rather than prompt-encoded heuristics is the same #2 principle applied to the instruction layer.

### 4e. Session state / Deps / registry — the typed `SessionState` machine

**Current defect.** `ToolState` (`tool_state.py:154-217`) is a bag of per-tool-result slots with **no identity home**: injection derives "Current anime" from `state.resolve_anime.title`, conflating the resolve *tool output* with the *session-carried* identity — nothing survives a turn where resolve didn't run. Candidate data has **3 homes + a parallel flag** (`resolve_candidates:163`, `resolve_anime.candidates:63`, `clarify.candidates:144`, `pending_clarify:164`). It keeps **TWO** search slots (`search_bangumi:166` + `search_nearby:167`) that a single-slot design would overwrite. `_seed_tool_state` (`animichi_runner.py:58-73`) **drops** the `current_bangumi_id`/`current_anime_title` the facade computed → turn 2+ has no identity in the typed channel. `pending_clarify` is sticky (`_merge_clarify_state`, `session_facade.py:165`). `resolve_candidates` is seeded **unvalidated** (`animichi_runner.py:69`) into a `validate_assignment=True, extra=forbid` model → schema drift crashes the request at seed time (T4). `_PAYLOAD_MODELS` is not total over `ToolName` (`GEOCODE → KeyError`, T5). **v1 gap (both reviews, P1-2/P1-4):** the v1 `SessionState.search_results: SearchResultsState` held only *metadata* for ONE result — so it carried no full payload, no multi-result-by-ref, and no route registry, which made the explicit `search_result_ref` (§4b) **meaningless**.

**Target design — a ref-keyed registry holding FULL payloads.** `SessionState` is a dedicated sub-model that **attaches as a field on `ToolState`** (`deps.tool_state.session: SessionState`) — `tool_state` is the right home (audit T1). It is the **single** identity/candidate/result carrier; `message_history` is for conversational continuity only.

```python
ResultRef = NewType("ResultRef", str)
RouteRef  = NewType("RouteRef", str)

class CurrentAnime(BaseModel):
    model_config = ConfigDict(extra="forbid")
    bangumi_id: str
    title: str

class SearchPayloadState(BaseModel):        # the FULL payload (build_search_payload output, typed)
    model_config = ConfigDict(extra="forbid")
    kind: Literal["bangumi", "nearby", "multi"]   # "multi" = merged multi-work result (v2.2, §4c)
    rows: list[PointState] = Field(default_factory=list)
    row_count: int = 0
    metadata: SearchMetadataState | None = None
    nearby_groups: list[NearbyGroupState] | None = None
    anime_id: str | None = None                   # single-work results
    anime_ids: list[str] | None = None            # kind="multi": the selected work_ids, selection order
    omitted_work_ids: list[str] | None = None     # kind="multi" (v2.3): selected works that contributed no rows (empty or fetch-failed)
    partial: bool = False

class RoutePayloadState(BaseModel):         # the FULL itinerary
    model_config = ConfigDict(extra="forbid")
    ordered_points: list[PointState] = Field(default_factory=list)
    timed_itinerary: TimedItinerary | None = None
    summary: RouteSummaryState | None = None
    source_ref: ResultRef | None = None

class OrderedCandidate(BaseModel):          # trusted display, stable id
    model_config = ConfigDict(extra="forbid")
    id: str                                 # bangumi_id OR gazetteer id
    title: str                              # anime title OR place label
    cover_url: str | None = None
    city: str | None = None
    points_count: int | None = None
    lat: float | None = None                # gazetteer candidates ONLY (v2.3): staged coords —
    lng: float | None = None                #   execute_place_selection consumes them; no re-geocode on selection

class PendingClarification(BaseModel):      # THE SOLE candidate oracle
    model_config = ConfigDict(extra="forbid")
    reason: Literal["anime_ambiguity", "place_ambiguity", "place_too_broad",
                    "unknown_place", "missing_location", "anime_not_found"]
    candidate_ids: list[str] = Field(default_factory=list)      # ordered, stable; [] for non-candidate reasons
    ordered_candidates: list[OrderedCandidate] = Field(default_factory=list)
    revision: int                           # == SessionState.clarification_revision at emit; the stale-click token

class GeocodeStaging(BaseModel):            # PRE-clarify staging ONLY — never the validator oracle
    model_config = ConfigDict(extra="forbid")
    candidates: list[OrderedCandidate] = Field(default_factory=list)

class SessionState(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_anime: CurrentAnime | None = None
    search_results: dict[ResultRef, SearchPayloadState] = Field(default_factory=dict)
    routes: dict[RouteRef, RoutePayloadState] = Field(default_factory=dict)
    pending_clarification: PendingClarification | None = None
    geocode_staging: GeocodeStaging | None = None
    last_result_ref: ResultRef | None = None        # most-recent search, ANAPHORA HINT ONLY (never a plan_route default, P3-8)
    clarification_revision: int = 0                  # increments on each new pending; the stale-click guard
```

**Ref lifecycle.**
- **Generation:** server-side at tool-execution time via an **injectable factory on deps** (deterministic in tests), e.g. `f"{kind}:{revision}:{n}"`. The model never mints a ref.
- **Lifetime / scope:** session-scoped; persisted across turns in the interaction log (below). A ref stays valid for the whole session until evicted.
- **Eviction:** bounded LRU, keep the last `MAX_REFS = 8` search results and routes per session (prevents unbounded session growth).
- **Stale-ref behavior:** `plan_route(search_result_ref=X)` with `X ∉ search_results` → the typed `RouteStaleRef` outcome (§4b), which instructs the model to re-search — **never a KeyError/500**.

**Oracle rules.**
- `PendingClarification` is the **SOLE** candidate oracle the `validate_output` clarify guard reads (§4c). `GeocodeStaging` is *pre-clarify staging only*: when `search_nearby` returns `place_ambiguity`, it POPULATES `pending_clarification` (reason + ordered candidates + a fresh `revision`) from `geocode_staging` — the validator never reads `geocode_staging` directly. The other clarify-producing `search_nearby` outcomes (`place_unresolved`/`missing_location`) and `resolve_anime.not_found` write `pending_clarification` directly with `candidate_ids=[]` (the transition table, §4c). This removes the "candidates in two homes" ambiguity (P2-7 v2).
- Presence of `pending_clarification` **is** the pending flag (no parallel bool). `resolve_candidates`, `resolve_anime.candidates`, `clarify.candidates`, and `pending_clarify` all collapse into it (T2).

**Persistence across turns + the explicit CLEAR transition (P1-2/P1-5).** A per-run `deps` object alone does NOT persist — session state lives in the interaction log and is reconstructed each turn:
- **Write:** `extract_context_delta(result)` (`session_facade.py:395`) serializes the final `SessionState` (current_anime, the registry refs+payloads within the eviction bound, and pending_clarification/revision) into the persisted `context_delta` for this interaction. This is an **additive/versioned** delta (a `session_state_v2` key) written alongside today's fields for compat reads (§6 Phase 1b).
- **Read/seed:** `build_context_block` reconstructs the block from the deltas; `_seed_tool_state` (§ below) seeds `deps.tool_state.session` from it — including `current_anime` (fixes R1) and any still-pending clarification.
- **Explicit CLEAR:** replace the sticky OR at `_merge_clarify_state` (`session_facade.py:165`, `pending_clarify or pending`) with a state-machine that honors a **clear transition** (per the transition table, §4c): `pending_clarification` is set ONLY by a clarify-producing outcome (always a fresh `revision`); it is cleared when a valid `selected_candidate_ids` selection is consumed OR the next turn yields any non-clarify terminal outcome; and a re-clarify REPLACES it with a bumped `revision`. Within a run, consuming a selection clears `SessionState.pending_clarification` and bumps `clarification_revision`. No more latch.

**Seeding rules.** `_seed_tool_state` seeds `session.current_anime` from `context["current_bangumi_id"]`/`["current_anime_title"]` (fixes R1). Seed **defensively** (skip malformed rows; never let a seed raise into an unhandled 500 — T4). Make `_PAYLOAD_MODELS` exhaustive over `ToolName` or guard the lookup (T5). Delete the `extra="allow"` legacy-dict crutch once `SessionState` is typed (T3).

**Multi-selection merge/dedup — a DEFINED deterministic op (v2.2, owner Decision 3).** Executed ONLY inside `execute_multi_selection` (§4c) — never by the model, never CodeMode:
- **Input:** the per-work `SearchPayloadState`s fetched via `pointsByWorkId`, in **selection order** (the validated `selected_candidate_ids` order).
- **Union:** `rows = concat(work_i.rows)` in selection order, each work's internal row order preserved (catalog order).
- **Dedup:** by **stable point id** — franchise works share spots, so dedup is REQUIRED and must be deterministic: the FIRST occurrence wins (earliest selected work), later duplicates are dropped.
- **Ordering:** the result order is therefore fully stable — selection order → per-work catalog order → first-occurrence dedup. Same inputs, same output, always.
- **Output:** ONE combined `SearchPayloadState(kind="multi", anime_ids=<selected work_ids>, anime_id=None, rows=<deduped union>, row_count=len(rows), partial=<OR of per-work partial>, omitted_work_ids=<the selected works that contributed no rows — empty or fetch-failed — else None (v2.3)>)` stored in `search_results[ref]`; the deterministic route op (`plan_route`'s nearest-neighbor ordering) then operates on this merged, deduped set (`RoutePayloadState.source_ref=<merged ref>`).
- **Identity after a multi-select (v2.3):** `execute_multi_selection` sets `current_anime = None` when `len(anime_ids) >= 2` — a merged multi-work result has NO single identity, and silently pinning the first selection would mis-scope follow-up turns. Next-turn anaphora ("plan a route for those") falls back to the merged `last_result_ref` (the §4d anaphora hint); a later single-work resolve/selection re-establishes `current_anime`. A single-select (list of 1) through the SAME path DOES set `current_anime` to that work — the user picked one work, identity is unambiguous; this final identity write is the uniform path's only cardinality-conditional. `execute_place_selection` never touches `current_anime` (location, not identity).

**Why best practice.** A single typed state object with a ref-keyed registry is pydantic-ai's `deps`/state discipline: authoritative identity + full payloads live in one validated place, addressed by opaque refs, not reconstructed from a lossy compacted transcript (R2). It is also what makes the compaction fix in §4f safe — candidates and payloads live in typed state, not in a best-effort summary.

### 4f. Capabilities

**Current defect.** `build_animichi_agent` (`animichi_agent.py:603-643`) threads a modern/legacy switch through 6 branch points and violates 1-10-50. `OverflowingToolOutput` (`_overflow_capability()`, :534) is misconfigured (D): it unconditionally registers a dead `read_tool_result` tool, Truncate-only never stores, a test locks it into the eager tool set, Truncate-on-JSON produces invalid JSON, and Codex's import probe hard-failed with "No usable temporary directory" **before** construction. Compaction: `max_tokens` is **inert** under `TieredCompaction`; the final `SlidingWindow(preserve_first_user_message=False)` tier **destroys the candidate-bearing summary** exactly when the candidate list is large; there is **no CJK tokenizer** so `HISTORY_MAX_TOKENS≈5500` ≈ 22k CJK chars before it triggers; and the harness truncates each tool return to 500 chars **before** the summarizer. `ToolSearch` + `defer_loading` for only 2 web tools is premature and the prompt names them as directly callable. `InputGuard` is default-off with a `replace` policy.

**Target design.**
- **Remove `OverflowingToolOutput` entirely.** Delete `_overflow_capability`. Cap **the model-facing return only** at its source in `tool_runtime._model_summary` (`tool_runtime.py:63-94`) — the function that already sends the model a compact preview. Do **not** cap `catalog_adapter.build_search_payload` (`catalog_adapter.py:47-62`): that dict feeds route-planning rows *and* the UI, and truncating it would drop authoritative data (P1-7). The full typed payload flows into `SessionState.search_results[ref]` and SSE unchanged. Do **not** subclass the harness to suppress `get_toolset`. Replace the tool-set invariant test with a `FunctionModel` request-capture asserting `read_tool_result`/`search_tools` are **absent** from the offered tools.
- **`items` duplicate:** `build_search_payload` emits both `rows` and `items` (`catalog_adapter.py:54-55`). Remove the `items` duplicate **only after** all consumers migrate to `rows` **and** contract tests prove wire compatibility (P1-7). Until then it stays.
- **Delete the legacy composition path.** Build modern-only: remove `modern_composition` param, `_modern_composition_enabled`, the env switch, the legacy branch, and the ~140 lines of superseded compaction (`_compact_tool_results`/`_compress_*`/`_sliding_window`/`_find_turn_starts`/`_pick_keep_from`). **KEEP** `_summarize_tool_content` (+ `_parse_content_to_dict`/`_summarize_*`) — modern `CompactToolReturns` uses it as its summarize callback. Delete `test_modern_legacy_parity.py` and coupled refs. Extract `_modern_capabilities()` so `build_animichi_agent` returns to ~10 lines (1-10-50).
- **Fix compaction.** (a) **Drop the `SlidingWindow` tier**; tiers 1 (`CompactToolReturns`) + 2 (`SummarizingCompaction`, `preserve_first_user_message=True`, verbatim `SUMMARY_PROMPT`) suffice; if the summary exceeds target, return unmodified (still inside the 100k+ window) rather than dropping candidates. (b) Supply a **CJK-aware tokenizer** (or lower the threshold) so JP/CN triggers on time. (c) **Carry candidates + full payloads in the typed `SessionState` registry (§4e), not the summarizer** — the 500-char pre-truncation makes the transcript lossy; the summary is best-effort transcript only. (d) Sentinel-comment the inert `max_tokens`; remove `HISTORY_KEEP_TOKENS`.
- **Make web tools eager.** Use `WEB_TOOLS`; drop `ToolSearch` + `DEFERRED_TOOLS` (honest prompt, no discovery round-trip). Keep `ToolSearch` in reserve only if the catalog grows.
- **`InputGuard`: block, not replace; default-off until eval.** Change the action to `GuardResult.block(...)` (spends no tokens on a false positive); align the eval to the guard-on trajectory; keep default-off until validated (see §9).

**Why best practice.** Capping the *model-facing* return (not the stored payload) keeps identity/route/UI data intact while shrinking the token surface — the correct reading of #7. Modern-only removes a superseded surface the harness treats as default. The compaction fix respects that a summarizer sees truncated returns — so identity must live in typed state, matching §4e. Eager tools for a 2-tool set is what ON-DEMAND reserves progressive disclosure *away from*. `block` is the harness's sanctioned graceful input-guard outcome.

### 4g. Model layer — **SECURITY**: alias registry + trust_env + timeout/fallback inversion

> **SECURITY (M1, P0 — pulled to Phase 0).** `request.model` is a caller-supplied string passed **raw** to `run()` (`animichi_runner.py:106-110`) — it **bypasses** `base.py` resolution. A request `openai:mimo@https://evil.example` is read by pydantic-ai as an `OpenAIResponsesModel` named with the `@suffix` at `api.openai.com` (probe-confirmed), and `_resolve_api_key` (`base.py:49-60`) sends the **generic compat key to any non-hardcoded host**. Naively wiring the resolver *without an allowlist* would let a caller-chosen endpoint receive a project secret. Fix with an allowlist, not just a parser.

**Current defect.** Beyond M1: `_build_http_client` sets `trust_env=False` (`base.py:33`) — a contract violation of `apps/agent/AGENTS.md:61` (shared lifecycle-managed clients + `trust_env=True`). The model client `timeout_seconds=120` (`base.py:32`) exceeds the agent's 90 s cancel deadline (`AGENT_TIMEOUT_SECONDS=90.0`, `public_api.py:71`) → one primary request eats the whole run before `FallbackModel` can fail over; SDK retries add further delay. Split key sourcing (`os.environ` for DEEPSEEK/MIMO vs `get_settings().openai_compat_api_key`, :49-60). `_FALLBACK_MODEL` is misnamed (it is the **default**, :25). Per-parse `httpx.AsyncClient` leaks. Thinking-disable is host-gated by DNS (:41-46), not model profile.

**Target design.**

**Phase-0 EXACT model-alias allowlist (P1-5 — BLOCKS PHASE 0; enumerated so implementation does not guess).** Callers select a configured **alias name**, never a URL. Define a **server-owned** `MODEL_ALIASES` map (in `agent/config` / `base.py`, composed from the existing settings raw specs — `settings.py:124` `default_agent_model`, `:132` `openai_compat_base_url`; the caller string never becomes a base-URL). The three aliases are **derived from `base.py`'s existing `_resolve_api_key` domain_keys** (`base.py:51-53`: `xiaomimimo.com → MIMO_API_KEY`, `deepseek.com → DEEPSEEK_API_KEY`, else `get_settings().openai_compat_api_key`):

| Alias (caller sends `model=`) | server-owned model spec | fixed base_url | credential env ref |
|---|---|---|---|
| `default` | `settings.default_agent_model` (+ `settings.fallback_agent_model` chain) via `get_default_model()` — the existing server default, unchanged | provider-native (per the resolved spec) | per the resolved spec's provider |
| `deepseek` | `deepseek:deepseek-v4-flash` (native `DeepSeekProvider`) | `api.deepseek.com` (native) | `DEEPSEEK_API_KEY` |
| `mimo` | `openai:<configured MiMo model>` on the OpenAI-compat provider | `settings.openai_compat_base_url` (`https://api.xiaomimimo.com/v1`) | `MIMO_API_KEY` |

Rules (all enforced BEFORE `run()`, at/above `animichi_runner.py:106`):
- `run_animichi_agent` resolves every non-`None` `model` override **through `MODEL_ALIASES` before `run()`**. A resolved alias yields the server-owned `{spec, base_url, credential}` — **no caller string ever reaches `parse_model_spec` as a base-URL.**
- **Unknown alias** (not in `MODEL_ALIASES`) **OR any `@`/scheme/URL-bearing string** (`@`, `://`, `http`, whitespace, or any char outside `[a-z0-9_-]`) → a **TYPED rejection** (`ModelAliasError`) surfaced as **HTTP 400** (a stable `PublicAPIError` code, e.g. `invalid_model_alias`) — **never a 500, never a pass-through to `parse_model_spec`.**
- `model=None` → unchanged: `get_default_model()` (the existing default resolution).

**Phase-0 tests (name each):**
- `model="__nope__"` (unknown alias) → HTTP 400 `invalid_model_alias` (NOT 500). -> unit + integration
- `model="openai:mimo@https://evil.example"` (raw URL / `@`) → HTTP 400 (NOT 500, NOT pass-through). -> unit + integration
- `model="deepseek"` → the server-owned DeepSeek native spec (`DEEPSEEK_API_KEY`, `api.deepseek.com`). -> unit
- `model="mimo"` → the server-owned OpenAI-compat spec (`MIMO_API_KEY`, `openai_compat_base_url`). -> unit
- `model="default"` → identical to `get_default_model()`. -> unit
- `model=None` → default resolution unchanged. -> unit

- **Full registry ergonomics (Phase 3, additive to Phase 0).** The full `MODEL_ALIASES` registry owns `{name, provider_kind, fixed_base_url, credential_ref, settings, fallback}`; reject duplicate effective models; per-run BYOK niceties layer on the same allowlist. **Phase 0 ships the minimal enumerated allowlist above** (close the credential-leak vector); the ergonomics follow in Phase 3.
- **`trust_env=True`** on a **shared** `httpx.AsyncClient` owned by the FastAPI **lifespan** (remove the custom `trust_env=False` client unless an approved threat-model exception exists).
- **Fix the timeout/fallback inversion:** explicit `agent_deadline` + `model_attempt_timeout` (per-attempt < agent deadline) + set SDK retries to **0** when a `FallbackModel` is in play.
- Unify all key sourcing through `get_settings()` (add a `mimo_api_key` field alongside the existing `openai_compat_api_key`). Rename `_FALLBACK_MODEL → _DEFAULT_MODEL_SPEC`. Guard `get_default_model` against adding the primary as its own fallback. Apply thinking-disable via **model profile / `ModelSettings(thinking=False)`** (native DeepSeek + any override), not DNS.

**Why best practice.** An alias registry is the standard "callers pick a policy, never an endpoint" pattern — it closes the credential-routing hole while keeping BYOK/per-run overrides. Shared lifecycle-owned clients with `trust_env=True` is the documented deployment posture. Per-attempt timeout < run deadline is what makes `FallbackModel` actually fail over.

### 4h. Runner / `UsageLimits` / partial results / step model

**Current defect.** `MAIN_REQUEST_LIMIT=25` + `SUMMARY_REQUEST_HEADROOM=2` (`animichi_runner.py:25-27`) are magic numbers fitted to the thrash loop B0 removes. No graceful degradation: `UsageLimitExceeded` → generic `except` (`public_api.py:317`) → 500. String-model overrides bypass resolution (M1, §4g). SSE "thinking" steps were coupled to the removed `greet_user`/`general_qa` tools. A plain-string output raises `ValueError` (`animichi_runner.py:115-118`) → unhandled 500. `on_step` is a 5-positional-arg callable (data clump).

**Target design.**
- **Keep the existing `request_limit` during the atomic switch; add DIRECT loop gates; THEN measure and raise in a follow-up (fixes the circular dependency, P1-5/P1-8).** v1 tried to "choose the cap from the post-Phase-1 distribution while changing the distribution in Phase 1." Instead: in the atomic switch keep today's cap as a safety net **plus** add the direct thrash gates (§7: tool-call count, repeated-identical-tool-call limit); once the redesign lands and the *new* request distribution is measured, raise `request_limit` to the re-derived value (~40–50) and delete the `+2 SUMMARY_REQUEST_HEADROOM` in a follow-up PR. `tool_calls_limit` stays as the tighter guard throughout.
- **Graceful `UsageLimitExceeded` → a typed, deterministic partial response via a DISTINCT `PartialResponseModel` (P1-4).** A `QAResponseModel`-shaped output would map to the `general_qa` stage (`_STAGE_BY_OUTPUT`), mislabeling a degraded run as a normal answer. Instead, catch `UsageLimitExceeded` in the runner and emit a well-defined partial `AgentResult`:
  - `output` = a **`PartialResponseModel(message=<locale-aware "partial results" notice>)`** (§4c — a distinct type, server-emitted only).
  - `intent` = the stable **`"partial"`** stage (`_STAGE_BY_OUTPUT[PartialResponseModel]="partial"`; `runtime_stage` returns it directly; `_UI_MAP["partial"]="GeneralAnswer"`, §5).
  - `session_state` = the accumulated registry (so any rows/routes already fetched still render).
  - **`success`/`status` ownership (P1-4):** these are NOT derivable — the runner OWNS them on this path. `AgentResult.success` is normally step-derived; on the partial path the runner sets `success_override=False` and `status="partial"` (the new `AgentResult` fields, §4c). All other paths leave both `None`, so their behavior is byte-identical to today.
  - **`response_builder` payload projection when several refs exist (P1-4):** the `PartialResponseModel` branch projects `session_state.last_result_ref` as the primary `data["results"]`; if a route exists it includes the most-recently-created `RouteRef` as `data["route"]`; if the registry is empty, `data={}` and only the notice `message` renders. (Deterministic: `last_result_ref` + newest-route — never an arbitrary dict pick.)
  - Persistence: written like any other turn (the partial `intent`/`session_state`/`status` persist); SSE: the stream completes normally (a `data-response` DataChunk with the partial payload), not an error frame.
- **String-model resolution:** resolve `request.model` via the alias allowlist (§4g) before `run()`.
- **SSE / step model:** synthesize the "thinking" step at the runner level, or move to native `run(event_stream_handler=)` `FunctionToolCallEvent`. **PINNED (v2.3 — closes the open "MAY"): the runner ALWAYS records a genuine terminal `clarify` StepRecord** when the final output is `ClarifyResponseModel` — ONE behavior, chosen for SSE "thinking" continuity, analytics, and a non-empty clarify trajectory the eval chains derive from (§7). It is a real record of the terminal clarify emission (recorded AFTER `validate_output` passes; a `ModelRetry`-rejected clarify attempt records nothing), NOT a fake tool call. **The v2.1 requirement to synthesize a step for frozen-baseline preservation stays DROPPED** (owner Decision 1, §7): chains are re-derived from what the runner actually records. **Gate accounting (v2.3):** runner-synthesized StepRecords — this terminal clarify record, SSE thinking steps, and the deterministic selection handlers' fetch/route records — are **EXCLUDED from the direct thrash-gate counts**: the tool-call ≤6/case and repeated-identical=0 gates count MODEL-initiated tool calls only (§7).
- **String-output guard → the same typed graceful partial path** (no bare `ValueError`).
- **`on_step` → a `StepEvent` value object (P3).** Replace the 5-positional-arg `OnStep` callable (`deps.on_step(tool, status, data, thought, observation)`, `tool_runtime.py:23-34`) with a single `StepEvent` dataclass argument (`{tool, status, data, thought, observation}`) — removes the data clump; note `retries` coupling (tool+output retries share `retries=2`) is left as-is (minor).

**Why best practice.** `UsageLimits` in pydantic-ai is a safety rail, not a routing mechanism; the correct posture is a generous cap + graceful catch, and adding direct loop gates measures thrash directly instead of inferring it from a request budget. Native `event_stream_handler` is the sanctioned streaming hook for step events; a value object for step emission matches the deps/value-object discipline. A distinct partial output type keeps the degraded stage honest in analytics + UI.

### 4i. Sub-agents + Guardrails

> **SECURITY (S1, HIGH — pulled to Phase 0).** The translation sub-agent uses **raw** `duckduckgo_search_tool()` (`translation.py:113-121`) and never imports `web_trust` → DDG results are **not** wrapped (no `untrusted_web_result` delimiting, no "instruction=DATA" preamble, no `source_tier`). A poisoned page can inject into the translation sub-agent. Blast radius is bounded (output is a constrained title string), hence HIGH not critical — but it must be sanitized, and Phase 0 ships the minimal sanitize + usage-share.

**Current defect (translation, B5).** Beyond S1: usage is **not shared** — `translation_agent.run()` has no `usage=` (`translation.py:175`) so sub-agent tokens escape the parent `UsageLimits`. The child does **not inherit the run's model** (`translation_agent` locks `resolve_model(None)` at import, :113-114). Provenance is **fabricated**: `source="web_search", confidence=0.7` is returned even if the child never searched (:184-189). `FallbackExceptionGroup` is not caught. `TranslationDeps` is vestigial. It also violates the catalog-only creed (`animichi_tools.py:1-11` "ZERO upstream calls") by hitting legacy DB + Bangumi API + raw DDG directly.

**Current defect (`sql_agent`).** Dead code: zero runtime importers. A direct-DB caller + per-call-built-LLM anti-pattern + a hardcoded 27-entry `KNOWN_LOCATIONS` dup of the catalog, carrying **5 `# noqa: S608`** suppressions.

**Current defect (`web_trust`).** Correct and hand-rolled (A-), but injection scanning is split across **three** inconsistent call sites: `public_api.py:150-157` (log-only, always-on, redundant), `InputGuard` (replace, default-off), `web_tools.py:63-68` (tool-return log-scan).

**Target design.**
- **Phase 0 (SECURITY) — translation minimal hardening:** **share `usage=ctx.usage` + `model=ctx.model`**, sanitize DDG via `wrap_untrusted_web_results` (fixes S1), and **catch `FallbackExceptionGroup`**. These are additive and do not depend on the atomic switch.
- **Later (sub-agent phase) — translation full redesign.** Preferred: move anime-title/alias localization **behind the catalog contract** (structured title relations = structured retrieval; preserves the upstream-free creed). Remove web tools from the child; pure text-translation goes through a **tool-less** path (`direct.model_request` or a tool-less agent — fixes T2's false "no web search"). Assign `source`/`confidence` in the **app**, not claimed by the model. Drop `deps_type` → `Agent[None, str]`. Rename the fallback `source` to `"untranslated"`.
- **DELETE `sql_agent`** — remove `sql_agent.py` + `test_sql_agent.py` + `SQLAgent`/`SQLResult` from `__init__` + `ResolvedLocation` (`models.py:51`) + scrub the `models.py:37` docstring. Kills dead code + a creed violation + 5 suppressions in one move.
- **`web_trust` → KEEP hand-rolled; consolidate the 3 sites onto `InputGuard`.** Delete the redundant `public_api.py:150-157` scan; **keep** the tool-return log-scan (`web_tools.py:63-68`). Input-guard action = **block, not replace** (§4f). `detect_prompt_injection` stays a **log signal**, not a gate. A real gate would need official `pydantic-ai-shields` (§9).

**Why best practice.** Sub-agent delegation *requires* `usage=ctx.usage` and should share the run model; tool returns re-entering context must be sanitized (neither `InputGuard` nor `OutputGuard` covers tool returns — `wrap_untrusted_web_results` fills that gap; do **not** convert it to an `OutputGuard`). Deleting dead direct-DB agents restores the catalog-only architecture.

**Dead-handler cleanup (P3).** Once the function tools are removed, these become dead and must be deleted in the atomic switch: `run_clarify` + `_run_ephemeral` (`tool_runtime.py:104,156`), and the greet/QA handlers (`execute_greet_user`/`execute_answer_question` — internal handler names; the LLM saw `general_qa`, the 4-name maze qa_response/general_qa/answer_question/QAResponseModel collapses to the single `general_qa` stage). Remove BOTH dead `_UI_MAP` keys — `answer_question` (`response_builder.py:19`) and `unclear` (`response_builder.py:21`).

## 5. Generative UI protocol + reason→component story (SPEC SECTION for the `apps/web` rebuild)

The target frontend has **not** started generative UI; the old `frontend/generative/FoxGuide.tsx` (Next.js) is being replaced. This section **defines** the wire contract + component story the rebuild implements, aligned with the compact output redesign (§4c). It is *not* a review of existing frontend code.

### Wire contract (what the frontend consumes)
The response stays `PublicAPIResponse` (`schemas.py:91-111`): `{success, status, intent, message, data, session, ui, ...}`. After the redesign:
- **`intent`** — **server-owned and stable** for `_UI_MAP` (§4c `RuntimeStage`). Top-level from the output-model class; sub-intent (`search_bangumi` vs `search_nearby`, `plan_route` vs `plan_selected`) from `ctx.deps.steps`; the deterministic selection handlers set `plan_selected` / `plan_multi` directly. The frontend switches on `intent` (or the `ui.component` descriptor). String values are unchanged from today (plus the new `partial` and `plan_multi`).
- **`ui.component`** — `_UI_MAP.get(intent)` (`PilgrimageGrid` / `NearbyMap` / `RoutePlannerWizard` / `GeneralAnswer` / `Clarification`). The per-model `ui` field is removed (it was dead).
- **`message`** — the one-line model prose (all stages).
- **Clarify** — `data` carries `{reason, candidates}` where `candidates` are **hydrated cards** the app built from `SessionState.pending_clarification.ordered_candidates`. The model supplied only ordered `candidate_ids`; the frontend never trusts model-typed candidate prose.
- **Search / Route** — `data.results` / `data.route` are built **entirely from `SessionState`** (the ref-keyed registry). The model contributed only `message`.

### reason → UI component story
| Stage / reason | `ui.component` | Frontend renders |
|---|---|---|
| `clarify` · `anime_ambiguity` | `Clarification` | **MULTI-SELECT cover-card picker (checkboxes)** over hydrated candidates; confirming posts `selected_candidate_ids` (list of `bangumi_id`s, len ≥1 — a single tick = a list of 1) + `clarification_id` (→ `execute_multi_selection` → merged grid + route) |
| `clarify` · `place_ambiguity` | `Clarification` | place-choice list (gazetteer labels), SINGLE-select; selecting posts `selected_candidate_ids=[<gazetteer id>]` (exactly one) + `clarification_id` (→ `execute_place_selection`, v2.3) |
| `clarify` · `place_too_broad` / `unknown_place` | `Clarification` | free-text "be more specific" prompt (no candidate list) |
| `clarify` · `anime_not_found` | `Clarification` | "we couldn't find that title" + corrected-title text input |
| `clarify` · `missing_location` | `Clarification` | location input (or "use my location" → shared GPS) |
| `search_bangumi` | `PilgrimageGrid` | spot grid/list from `data.results.rows` |
| `search_nearby` | `NearbyMap` | map + nearby groups from `data.results` |
| `plan_route` / `plan_selected` | `RoutePlannerWizard` | ordered itinerary + map from `data.route` |
| `plan_multi` (v2.2 multi-select) | `RoutePlannerWizard` | merged multi-work result: combined spot grid from `data.results` (deduped union) + ordered itinerary/map from `data.route` |
| `general_qa` / `greet_user` | `GeneralAnswer` | prose (`message`) |
| `partial` | `GeneralAnswer` | partial-results notice + whatever rows/route were already fetched (`last_result_ref` + newest route) |

Selection loop: a clarify card selection posts `selected_candidate_ids` (list; multi for `anime_ambiguity`, exactly one for `place_ambiguity`) + `clarification_id` (the revision token). The server **validates against pending state** (every id ∈ candidates + revision match), rejects stale clicks, **consumes** the choice deterministically (`execute_multi_selection` for anime; `execute_place_selection` for place, v2.3), and **clears** `SessionState.pending_clarification` (§4c/§4e) — no sticky re-clarify. Route selection continues to use `selected_point_ids`; request modes are mutually exclusive (§4c v2.3): `selected_point_ids` XOR `selected_candidate_ids` XOR plain text. Non-ideal `plan_multi` terminals render deterministically (§4c terminal matrix): `status="empty"` → the notice + the empty merged grid, clarify card STILL LIVE; `status="too_large"` → the "narrow your selection" notice, clarify card STILL LIVE (pending preserved) so the user re-ticks fewer works.

## 6. Phasing / sequencing

Dependency-ordered. **Phase 0 is SECURITY** (P0/HIGH items, additive, deployable alone). Phase 1 is the thrash-fix core, split so the additive pieces deploy alone and there is exactly ONE atomic switch; later phases are independent cleanups. **Per the sonnet re-review, Phase 0 + Phase 1a are implementable immediately** (the two small v2.1 fixes are self-contained); the medium fixes serve 1c/1d.

### Phase 0 — SECURITY (own PR, additive, deploy alone)
- **Model-alias allowlist (minimal, ENUMERATED §4g)** — resolve `model=` through the server-owned `MODEL_ALIASES` (`default|deepseek|mimo`) before `run()`; unknown alias / `@`/scheme/URL-bearing string → typed `ModelAliasError` → **HTTP 400** (never 500, never pass-through); `model=None` unchanged. Closes the credential-leak vector (§4g / M1 / P1-5). -> unit + integration
- **Translation sanitize + usage-share** — `wrap_untrusted_web_results` on the child's DDG path + `usage=ctx.usage` + `model=ctx.model` + catch `FallbackExceptionGroup` (§4i / S1). -> unit + eval

### Phase 1a — additive catalog endpoints (own PR, deploy alone)
Deterministic `resolve` (dedup-by-work_id, tie rule, MISS name-similar rule, enrichment, `upstream_unavailable`) + `pointsByWorkId` + `fetchBangumiSubjects` (§4a). **MISS subject shape uses the shared parser's REAL fields — `images.{large,common,…}` for cover + `date`(fallback `air_date`) for year, NOT `image`/`air_date` (P2-6 / P3-c); `points_count` derived via `COUNT(points.id)` in the resolver query (enrich UPSERT does not own it).** Additive: the agent does not call them yet. -> integration (TS worker) + unit

> **⚠ v2.2 AMENDMENT REQUIRED (owner Decision 2).** The already-built Phase-1a resolver implements the old TIGHT MISS rule (normalized-name EXACT match ≥2). It MUST be amended to the LOOSE name-similar rule (§4a: substring containment in either direction over `name`/`name_cn`, `MAX_CANDIDATES=6`, relevance order; `similar==1 → resolved(similar[0])`; `similar==0 → head-pick`) **before Phase 1c wires the agent to it**. This is clean: 1a is additive and not yet consumed by any caller. Amend the §4a unit tests in the same change (exact-match tests → the fuzzy/name-similar set). **v2.3: the informativeness guards (`MIN_QUERY_LEN`/`MIN_SIMILAR_LEN`/`MAX_REVERSE_RATIO`, §4a) are PART of this amendment — the loose rule ships GUARDED, never bare; the guard unit cases (1-char, short-ASCII-title reverse, in-ratio reverse, "凉宫") land in the same change.** -> unit + integration (TS worker)

### Phase 1b — additive/versioned session-state persistence + RuntimeStage mapping (own PR, deploy alone)
- Versioned `session_state_v2` delta in `extract_context_delta` + compat reads in `build_context_block`; explicit CLEAR transition replacing the sticky OR (§4e). -> unit + integration
- Server-owned `RuntimeStage` map + `AgentResult.intent` (stored field) + `AgentResult.session_state` + the `status`/`success_override` fields, written by the runner **with compat reads** (old `output.intent` still present until 1c) (§4c). -> unit

### Phase 1c — the ONE atomic switch (own PR; the fenced atomic subset)
Everything that must move together because it removes `output.intent`/`output.data`/the function tools at once:
- New tool contracts (discriminated outcomes, refs, split place-clarify outcomes) + `search_bangumi`/`search_nearby`/`plan_route` wired to the Phase-1a endpoints (§4b). -> unit + eval
- Terminal `ClarifyResponseModel {reason, message, candidate_ids}` (6 reasons; `needs_direct_input` DROPPED) + remove `clarify`/`greet_user`/`general_qa` function tools + delete dead handlers (`run_clarify`/`_run_ephemeral`/greet+QA handlers) (§4b/§4i). -> unit + eval
- **The normative TOTAL clarify transition table (§4c)** — every clarify-producing outcome writes `pending_clarification` atomically (incl. `ResolveNotFound→anime_not_found` + `NearbyMissingLocation→missing_location` + `NearbyPlaceUnresolved`). -> unit + eval
- Compact output models (drop `intent`/`data`/`ui`; keep the `candidate_ids` before-coercion; delete `_DataCoercionMixin`) + **removing the dead `ui` field is PART of this switch** (it changes schemas + the remote prompt — not independent, P1-5) (§4c). -> unit + eval
- `validate_output` rewrite (sub-intent from steps; anti-fabrication gate; complete clarify guard) (§4c). -> unit + eval
- Instructions rewrite (outcome table, compact-output rule, web-search rule, keep untrusted invariant verbatim) + cache-neutral dynamic wiring + drift pin-test (§4d). -> eval
- Typed `SessionState` registry as the response carrier; `_seed` seeds `current_anime`; `response_builder` builds data from `session_state`; migrate ALL enumerated consumers atomically (§4c table) — **including `selected_route.py` (route → `SessionState.routes`, `intent="plan_selected"`, drop `intent`/`data`) and `/v1/chat` (route through the unified boundary; delete the body-scan; load pending via `x-session-id`)** (§4c/§4e). -> unit + integration
- Request/response adapters: `PublicAPIRequest.selected_candidate_ids: list[str]` (REPLACES the v2.1 single `selected_candidate_id`) + **`clarification_id: int`** + server validation (every id ∈ candidates, revision match, reason-specific cardinality) + **request-mode EXCLUSIVITY (v2.3: `selected_point_ids` XOR `selected_candidate_ids` XOR plain text; `clarification_id` IFF candidate mode; normalize/dedupe BEFORE cardinality; pending preserved untouched on every invalid request)** + selection-consume/clear (§4c). -> unit + api
- **NEW deterministic `execute_multi_selection` handler** (bypasses the agent; sibling of `execute_selected_route`; NOT CodeMode): parallel `pointsByWorkId` fetch + the defined merge/dedup op (§4e) + route over the merged set + `intent="plan_multi"` + `_UI_MAP["plan_multi"]` (§4c/§5) — **with the v2.3 TERMINAL MATRIX** (fetch-exception handled AT the handler; un-ingested candidate = empty with NO ingest; mixed → route over contributors + `omitted_work_ids`; ALL-empty → typed T4 with NO route; ALL-failed → typed T5; >500-point / >50-cluster → typed T6; pending cleared on T1–T3, preserved on T4/T5/T6) + the 500/501, 50/51, all-empty, mixed boundary tests (§4c). -> unit + integration + api
- **NEW deterministic `execute_place_selection` handler (v2.3):** selection dispatch keyed **by `pending_clarification.reason`** (`anime_ambiguity → execute_multi_selection`; `place_ambiguity → execute_place_selection`); validate the single gazetteer id → staged coords from `ordered_candidates` (which now carry `lat`/`lng`, §4e) → deterministic nearby search → `SearchPayloadState(kind="nearby")` → `intent="search_nearby"` → clear/bump (§4c). -> unit + integration + api
- **Route persistence for the route-producing paths (v2.3; owner decision = normalized JOIN TABLE):** additive migration `route_anime(route_id FK → routes.id, bangumi_id FK → bangumi.id)` + backfill + **DROP `routes.bangumi_id`** (single source of truth); `maybe_persist_route` gate widens to `intent ∈ {plan_route, plan_selected, plan_multi}` and derives 0..N association rows from the route's typed `SessionState` source payload; `save_route`/`get_user_routes` contracts move to the join (§4c route-persistence block). -> unit + integration
- Evaluator updates for the re-baseline (owner Decision 1): `_available_data_keys` recomputes `data_keys` from the new SessionState-sourced keys natively (NO legacy compatibility projection); stage→chains re-derived from the new real trajectories (the runner clarify step is PINNED always-on, §4h) + **the v2.3 eval-harness D3-awareness (§7): `AgentInput` selection fields + the seeded-pending fixture + the reason-dispatched selection task; `plan_multi` chains/min-steps as a function of the selected count; `NonemptyResults` pinned to the produced route's `source_ref` registry entry**. -> unit
- **Post-1c re-baseline:** run the full eval → establish the NEW baseline → present the NEW-vs-OLD comparison (expected: thrash failures DOWN, routing/nonempty UP) → **owner confirms the new baseline as a whole** (§7/§8). -> eval

### Phase 1d — graceful limits + direct loop gates (own PR)
Graceful `UsageLimitExceeded` → typed **`PartialResponseModel`** partial response (distinct `"partial"` stage/status; runner-owned `success`/`status`; `last_result_ref` projection) + `StepEvent` value object + direct loop gates with concrete thresholds (§4h/§7). Keep today's `request_limit` here; **measure the new distribution, then raise the cap in a follow-up PR** (§4h). -> integration + eval

### Phase 2 — capabilities cleanup (own PR)
Remove `OverflowingToolOutput` + model-facing source-cap in `_model_summary`; delete legacy composition path (KEEP `_summarize_tool_content`); compaction fixes (drop `SlidingWindow`, CJK tokenizer, candidates-via-registry, sentinel inert `max_tokens`); eager web tools; extract `_modern_capabilities()`. -> unit + eval

### Phase 3 — model layer (own PR)
Full alias-registry ergonomics + `trust_env=True` + timeout/fallback inversion + unify keys + shared lifespan client + rename `_FALLBACK_MODEL` + profile-based thinking-disable (§4g). (Phase 0 already shipped the security-critical minimal allowlist.) -> unit + integration

### Phase 4 — sub-agents / guardrails (own PR)
Translation catalog-ify (full redesign) + `sql_agent` delete + `web_trust` consolidate 3 sites + block-not-replace (§4i). (Phase 0 already shipped the translation sanitize + usage-share.) -> unit + eval

### Safe cleanups that could land FIRST (independent, low-risk)
- **Delete `sql_agent`** (dead code; removes 5 suppressions). -> unit
- **Rename `_FALLBACK_MODEL → _DEFAULT_MODEL_SPEC`** (pure rename). -> unit

## 7. Eval plan

Test-type legend: `unit | integration | eval | browser | api`.

### The RE-BASELINE strategy (owner Decision 1, 2026-07-16) — replaces frozen-baseline preservation
The v2/v2.1 spec preserved `agent_eval_v3.json` + `baselines/` **byte-identically** (a synthetic `clarify`-named step to keep the `evaluators.py:67-76` stage→chains green, plus a `_available_data_keys` legacy-key compatibility projection). **The owner dropped that requirement** ("没必要兼容 / 直接做到最好的方案"): the redesign builds the cleanest contract and **RE-ESTABLISHES the baseline**. Consequences:
- **NO synthetic `clarify` step.** The runner may still emit a REAL clarify step for SSE/analytics value (§4h), but nothing is synthesized to match frozen chains. The `evaluators.py:67-76` stage→chains are **re-derived from the new real trajectories** (the runner behavior is PINNED in §4h, v2.3: a terminal clarify **always** records a genuine `clarify` StepRecord — so the anime-clarify chain is `[resolve_anime, clarify]` and the nearby place-clarify chain is `[geocode, clarify]`, derived from what the runner actually records; runner-synthesized records are EXCLUDED from the thrash-gate counts below).
- **NO `_available_data_keys` compatibility projection.** Phase 1c removes `output.data` cleanly; `_available_data_keys` is rewritten to read the **new SessionState-sourced keys natively** (the exact stage→data-key table, v2.3: `search_bangumi`/`search_nearby` → `results`; `plan_route`/`plan_selected` → `route` (+ `results` when the source search is projected); **`plan_multi` → `results` AND `route`** — the §4c dual projection; **`clarify` → `reason` + `candidates`** — there is NO `question` key: `PendingClarification` carries `{reason, candidate_ids, ordered_candidates, revision}` and the §5 wire clarify `data` is `{reason, candidates}`; `partial` → whichever of `results`/`route` the registry holds — the NEW key vocabulary is defined with the evaluator rewrite, not projected back to legacy names). Cases that assert `data_keys` are updated to the new vocabulary as part of the re-baseline.
- **`NonemptyResults`** (`evaluators.py:203+`, today reads `tool_state["search_nearby"]["row_count"]`) is rewritten against `session_state` with the source PINNED (v2.3): search-stage cases read `session_state.search_results[last_result_ref].row_count > 0`; **route-producing cases (`plan_route`/`plan_selected`/`plan_multi`) inspect the produced route's `RoutePayloadState.source_ref` registry entry** — `session_state.search_results[route.source_ref].row_count > 0` AND the route's `ordered_points` non-empty — so a route over a silently-empty source can NEVER score nonempty. (`tool_state` is retained during migration but is NOT the evaluator source; expected effect: nonempty scores go UP once thrash stops eating the budget.)
- **An evaluator version bump is REQUIRED** (not optional): the re-derived chains + the new data_keys vocabulary are a new evaluator version, tagged explicitly.

### Eval-harness D3-awareness (v2.3 — the harness can EXECUTE the selection paths)
The current harness cannot run a D3 selection case: `AgentInput` (`evaluators.py:43-51`) carries only `{query, locale, context, selected_point_ids}`, and the task dispatch (`eval_harness.py:279-281`) branches solely on `selected_point_ids` → `_selected_task` (`eval_harness.py:234`: `execute_selected_route` + `MockCatalogClient`). v2.3 additions:
- **`AgentInput` gains** `selected_candidate_ids: list[str] | None = None`, `clarification_id: int | None = None`, and `seeded_pending: Mapping[str, object] | None = None` — a serialized `PendingClarification` fixture (`{reason, candidate_ids, ordered_candidates (incl. lat/lng for place), revision}`); the JSON case loader maps the same-named keys. -> unit
- **Dispatch** (in `make_agent_task`'s `task()`): `selected_candidate_ids` present → a NEW `_selection_task`: build a `SessionState` seeded from `seeded_pending`, run the SAME server validation (request-mode exclusivity, ids ∈ candidates, revision match, reason cardinality), then dispatch **by the seeded `reason`** to `execute_multi_selection` / `execute_place_selection` with `MockCatalogClient` — mirroring `_selected_task`, NOT `run_animichi_agent` (no model). `selected_point_ids` → `_selected_task` (unchanged). Else → `_agent_task`. -> unit
- **`plan_multi` trajectory scoring is a FUNCTION of the selected count** (a static `_STAGE_TOOL_CHAINS`/`_STAGE_MIN_STEPS` entry cannot express it): for N = `len(selected_candidate_ids)` after dedup, the expected chain is `("search_bangumi",) × N + ("plan_multi",)` — N deterministic per-work fetch StepRecords (named `search_bangumi`: they ARE the same `pointsByWorkId` op the tool performs) + the terminal `plan_multi` route StepRecord — and min-steps = `N + 1`; the chain/StepEfficiency evaluators read N from the case input. `execute_place_selection` cases: chain `("search_nearby",)`, min-steps 1. -> unit
- **Fixtures:** a seeded-pending anime fixture (2–6 candidates; franchise-overlap points in `MockCatalogClient` for the dedup assertion), a place fixture (2 gazetteer candidates WITH staged coords), and the §4c terminal-matrix boundary fixtures (all-empty T4, 500/501 + 50/51 T6). Selection cases assert the terminal-matrix row (stage, `status`, pending cleared/preserved) alongside the standard metrics. -> eval + unit

### Establishing the NEW baseline — the owner-confirmation gate
After Phase 1c lands (and the 1a resolver amendment, §6): run the FULL eval (`agent_eval_v3.json` + `runtime_journey_v1.json` + the additive dataset) and present a **NEW-vs-OLD comparison report** to the owner:
- per-metric deltas (routing/IntentMatch, nonempty, StepEfficiency, ToolCallRecall, locale, request/tool-call distributions);
- the stage-partition shift (clarify↔search flips in BOTH directions, §4a eval note) as counts per direction + a sampled case list — **informational, NOT a per-case sign-off**;
- the direct thrash gate numbers (below) before/after.
**Expected direction: thrash failures DOWN, routing/nonempty UP.** The owner confirms the new baseline **as a whole** (a single sign-off — the owner pre-approved this process on 2026-07-16; the confirmation is of the concrete numbers). Once confirmed, the new baseline is checked in and becomes the diff target for all subsequent changes; `MAX_CANDIDATES`/the fuzzy predicate/`BANGUMI_FETCH_N` (§4a) are eval-tunable against THIS baseline.

**Verification ACs:**
- `_available_data_keys` returns the new SessionState-sourced key vocabulary for one search, one route, one candidate-clarify, one no-candidate-clarify, and one multi-select (`plan_multi`) result — with no `output.data` read. -> unit
- Evaluator chains match the runner's REAL recorded trajectories for resolve→clarify, nearby-geocode→clarify, and the selection paths (no synthetic steps). -> unit
- `search_nearby` still records a `geocode` StepRecord on the place path (load-bearing for the nearby chain). -> unit
- `NonemptyResults` on a route-producing case reads the produced route's `source_ref` registry entry (a route whose source payload is empty scores 0). -> unit
- Selection-case dispatch is BY REASON: `selected_candidate_ids` + a seeded `place_ambiguity` pending → `execute_place_selection`; + a seeded `anime_ambiguity` pending → `execute_multi_selection` (never dispatched on the field alone). -> unit
- The full-eval NEW-vs-OLD comparison report is generated and attached to the 1c PR; owner confirmation is recorded before tag/deploy. -> eval

### Versioned evaluator + a NEW additive dataset for new behaviors
- **Version the evaluator** (REQUIRED, above) — the version tag marks the re-baseline boundary.
- **Introduce a NEW additive dataset** `apps/agent/agent/tests/eval/datasets/agent_redesign_v1.json` (name illustrative) for the genuinely-new behaviors (discriminated outcomes, `upstream_unavailable`, the new reasons `anime_not_found`/`place_too_broad`/`unknown_place`, split place-clarify, stale-ref, partial results, the LOOSE name-similar MISS rule incl. a "凉宫"-style several-similar case, and the multi-select selection protocol + merged `plan_multi` result). Existing `agent_eval_v3.json`/`runtime_journey_v1.json` cases remain as CASES (the queries are still valid); their expectations/baselines are RE-ESTABLISHED under the new design (above) rather than preserved. -> eval
### DIRECT thrash red-line gates — CONCRETE thresholds (P2-7; final stage is necessary but NOT sufficient — P1-6)
The #1 output-stage gate (below) cannot catch an agent that loops 40× then emits the right stage. Add deterministic per-case gates over the recorded trajectory + usage. **Initial thresholds (owner-tunable via the calibration PR below):**
- **request count per case — hard ceiling = 12** model requests/case (vs the observed 27–50 thrash; a clean single-anime path is resolve→search→emit ≈ 2–3, a clarify path ≈ 3–4). Breach = the case FAILS the gate. -> eval
- **tool-call count per case — ceiling = 6** tool calls/case (trivial path uses 2; nearby+route 3–4). Breach = case FAILS. -> eval
- **repeated-identical-tool-calls — 0 tolerance** (same tool + same args twice) = the thrash signature. Any occurrence = case FAILS. -> eval
- **p95 requests across the regressed set — ≤ 6**, computed over the 15 regressed MiMo cases + the full `agent_eval_v3.json`. Breach = the gate FAILS (blocks merge). -> eval

**Gate accounting (v2.3):** all four gates count MODEL-initiated activity only — runner-synthesized StepRecords (the always-on terminal `clarify` record §4h, SSE thinking steps) are EXCLUDED from the tool-call and repeated-identical counts; the deterministic selection handlers (`execute_selected_route`/`execute_multi_selection`/`execute_place_selection`) never run the model, so selection cases trivially satisfy the request gates.

**Dataset scope + fail semantics.** Per-case gates run over the full `agent_eval_v3.json` + `runtime_journey_v1.json`; the p95 gate over the regressed-MiMo + v3 union. Any per-case breach or a p95 breach is a **RED-LINE merge blocker** (not a warning).

**Calibration precedes gating (P2-7).** Because the redesign changes the request distribution, ship a **measurement-only PR first** on the redesign branch (records per-case request/tool-call counts + p95 WITHOUT gating), and the **owner signs off the final thresholds before Phase 1c merges**. The numbers above are the INITIAL ceilings the measurement PR validates/adjusts; the gate turns on only once the owner has signed off the calibrated values. -> eval

### #1 GATE (output-stage partition) — measured, then confirmed AS A WHOLE (v2.2; per-case sign-off DROPPED)
`runtime_journey_v1.json` asserts `expected_stage` on the **OUTPUT stage**. The redesign shifts the clarify/search partition in **both** directions **by design**:
- **clarify → search:** cases whose `expected_stage=clarify` was driven only by the removed "short/vague" heuristic now legitimately search.
- **search → clarify:** cases that hit a top-priority HIT tie or the LOOSE MISS name-similar rule (≥2 similar subjects, §4a) now legitimately clarify — the owner explicitly wants this (Decision 2: "凉宫" shows the several works to pick from).

Per owner Decision 1, the v2.1 per-case audit (`eval/clarify_case_audit.csv`, per-case `expected_stage` sign-off) is **DROPPED**. Instead the partition shift is reported inside the NEW-vs-OLD comparison (flip counts per direction + sampled cases) and the owner confirms the new baseline **as a whole** (above). The alias-seeding observation (do franchises actually share equal-priority `alias_normalized` rows?) is retained as an *informational* note in the report — it predicts how often the HIT path clarifies; the MISS name-similar rule is expected to be the dominant disambiguation source.

### RED LINE (v2.2)
The v2/v2.1 red line ("`agent_eval_v3.json` + `baselines/` stay **byte-identical**") is **REPLACED** (owner Decision 1). The v2.2 red lines:
- **The DIRECT thrash gates stay red lines** (above): request ≤12/case, tool-calls ≤6/case, repeated-identical = 0, p95 ≤6 — calibrated by the measurement-only PR + owner sign-off, then merge-blocking.
- **No deploy before baseline confirmation:** Phase 1c does not tag/deploy until the full-eval NEW-vs-OLD comparison is presented and the owner confirms the new baseline as a whole.
- **No silent drift AFTER confirmation:** once the new baseline is checked in, subsequent changes diff against it; changing it again requires an explicit owner-visible re-baseline (incl. tuning `MAX_CANDIDATES`/the fuzzy predicate, §4a).

### Other behavior-changing items needing an eval case
- Discriminated outcome routing (resolve `resolved`/`needs_disambiguation`/`not_found`/`upstream_unavailable` → correct output stage). -> eval
- The LOOSE MISS name-similar rule: a "凉宫"-style several-similar query → `needs_disambiguation` with the similar works as candidates; a unique-similar query → `resolved(similar[0])`; a no-similar query → relevance head-pick. -> eval + unit
- `clarify_response` terminal contract + the complete validator guard (reason + ordered `candidate_ids` + reason-specific cardinality + reject-when-no-pending) + the total transition table (every clarify-producing outcome writes pending atomically). -> eval + unit
- Removal of `greet_user`/`general_qa` echo tools. -> eval
- Payload compaction (model emits `{message}`; app builds data from the registry). -> eval + unit
- Sub-intent derived from steps not `output.intent` (P0-2). -> unit
- Multi-turn identity via `SessionState` + no sticky pending + the explicit clear transition. -> eval + integration
- Selection protocol (v2.2 multi): `selected_candidate_ids` (list) + `clarification_id` (int) validation — every id ∈ candidates, revision match, reason-specific cardinality (anime 1..N, place exactly 1), stale/invalid rejection; **request-mode exclusivity (v2.3): `selected_point_ids` XOR `selected_candidate_ids` XOR plain text, `clarification_id` IFF candidate mode, dedupe-before-cardinality, pending preserved untouched on every invalid request.** -> api + unit
- `execute_multi_selection`: parallel fetch, deterministic merge/dedup (first-occurrence dedup by stable point id + stable ordering, on a franchise-overlap fixture), route over the merged set, `plan_multi` stage + combined `data.results`+`data.route`, single-select via the same uniform path (list of 1); **the v2.3 TERMINAL MATRIX:** all-empty → typed T4 (NO route key), mixed-empty/-failed → T2/T3 (route over contributors, `omitted_work_ids` noted), all-failed → typed T5 (pending preserved), too-large → typed T6 at the 500/501-point and 50/51-cluster boundaries (never a crash); un-ingested candidate counts empty with ZERO ingest calls. -> unit + integration + api
- Selected-route path writes `SessionState.routes` + non-empty itinerary (silent-empty guard). -> unit + integration
- `/v1/chat` selection + persisted-pending load through the unified boundary. -> api + integration
- `execute_place_selection` (v2.3): exactly-one gazetteer id validation; staged-coords consume (no re-geocode call recorded); `SearchPayloadState(kind="nearby")` + `intent="search_nearby"`; clear/bump on the terminal; a multi-id place selection rejected. -> unit + integration + api
- Over-clarify informativeness guards (v2.3, §4a): "凉宫" still clarifies (forward containment); a 1-char query is exact-only (no spurious clarify); a short ASCII title ("K"/"86") is never swallowed by a long sentence (reverse guards); an in-ratio reverse match still resolves. -> unit + eval
- Route persistence via `route_anime` (v2.3): `plan_route` → 1 association row, `plan_selected` → 1, `plan_multi` → N contributing works in selection order, nearby-sourced → the touched works (0..M); list/read returns the joined `anime_ids`; the backfill preserves pre-migration identity; `routes.bangumi_id` dropped. -> unit + integration
- Graceful `UsageLimitExceeded` → typed `PartialResponseModel` (re-run the 15 regressed MiMo cases). -> eval + integration
- Catalog `resolve`/`pointsByWorkId` outcome partition (incl. the name-similar rule) + MISS subject field-name parse. -> integration (TS worker)
- Eager web-tool usage rates; injection guard (block-not-replace); translation title-resolution + text-translation paths + web sanitization. -> eval

## 8. Test integrity + non-negotiables

- **No suppressions.** No `noqa`/`type: ignore`/`eslint-disable`/`pragma: no cover`/`continue-on-error`/`skip` without explicit owner approval. (Deleting `sql_agent` *removes* 5 existing `# noqa: S608`.)
- **TDD.** Backend via `/backend-tdd`, catalog TS via its worker test suite. Each behavior-changing item ships with its test in the same PR.
- **Every behavior-changing item has an eval case** (§7). Quality ratchet: every AC carries a test-type annotation; coverage floors ratchet up, never down.
- **KEEP the untrusted-tool-output invariant verbatim** — `_INSTRUCTIONS` L184-195 is copied unchanged into the rewritten prompt.
- **Provenance/trust:** the app assigns `source`/`confidence` (never the model); `candidate_ids == pending_clarification.candidate_ids` by ordered equality; the model never supplies displayed candidate prose; `candidate_ids` is the sole ID the model may echo (§4d).
- **Impossible states unrepresentable:** every tool outcome is a discriminated union with outcome-specific required fields (incl. the split place-clarify outcomes — `place_ambiguity` requires ≥2 ids, `place_unresolved` has no id field).
- **Total clarify transition:** every clarify-producing outcome writes `pending_clarification` atomically before returning; the reject-when-no-pending guard can only fire on a genuine fabrication.
- **Re-baselined eval (owner Decision 1, 2026-07-16 — replaces "frozen baselines"):** the redesign does NOT preserve `agent_eval_v3.json`/`baselines/` byte-identically, does NOT synthesize steps, and does NOT project legacy data_keys to fake continuity. After Phase 1c: full eval run → NEW-vs-OLD comparison → **owner confirms the new baseline as a whole** (process pre-approved; §7). New behaviors go to the additive dataset; after confirmation the new baseline is the diff target, and changing it again requires an explicit owner-visible re-baseline.
- **Direct thrash gates** (request ≤12/case, tool-calls ≤6/case, 0 repeated-identical, p95 ≤6) are red lines, not just the output stage — turned on after the calibration PR's owner sign-off.
- **Contract pins:** local `_INSTRUCTIONS` ↔ remote `production` prompt drift pin-test; `plan_route` generated `ToolDefinition` snapshot test; tool-set invariant test asserts `read_tool_result`/`search_tools` **absent**; `build_search_payload` wire-compat contract test before the `items` duplicate is removed; selected-route non-empty-itinerary contract test; **multi-selection validation tests (every id ∈ candidates; revision match; anime 1..N / place exactly-1 cardinality; stale/invalid rejection) + merge/dedup determinism test (franchise-overlap fixture: union, first-occurrence dedup by stable point id, stable ordering)**; **the v2.3 terminal-matrix boundary pins (500/501 merged points; 50/51 clusters via a typed `routeTooManyClusters` catch; ALL-empty → NO `route` key + pending preserved; un-ingested candidate = empty with ZERO ingest calls) + request-mode exclusivity pins (`selected_point_ids` XOR `selected_candidate_ids` XOR text; `clarification_id` IFF candidate mode; dedupe-before-cardinality; pending untouched on invalid) + place-selection pins (exactly-one id; staged-coords consume, no re-geocode) + route-persistence pins (`route_anime` 1/1/N/0..M association rows across plan_route/plan_selected/plan_multi/nearby-sourced; backfill preserves pre-migration identity)**; Phase-0 alias allowlist rejection tests (unknown→400, raw-URL→400).

## 9. Open decisions for the owner (recommended defaults included so implementation is unblocked)

Each remains an owner decision, but ships with a **recommended default** the implementation may proceed on unless overridden.

1. **MiMo thinking posture (eval-relevant).** MiMo (the default `openai_compat_base_url`) is a reasoning model with no thinking-control param; if thinking defaults ON it inflates request count. **Recommended default: verify MiMo's thinking posture and, if ON, disable/steer it** (via model profile, §4g); this changes eval numbers — fold it into the post-1c re-baseline run (§7; frozen-baseline preservation was dropped per owner Decision 1, so no synthetic-step carve-out is needed).
2. **Cheap summarizer model.** `SummarizingCompaction` currently inherits the run model (DeepSeek); harness examples use a cheap `gpt-4o-mini`-class model. **Recommended default: lean cheap** — candidate/payload fidelity now lives in the typed `SessionState` registry (§4e), which weakens the argument for an expensive summarizer; flag the cost/quality delta but default to the cheap summarizer.
3. **`InputGuard` default-on timing.** **Recommended default: keep default-off, action = `block` (not `replace`)**; flip default-on only after the false-positive surface + guard-on eval evidence land. Adopting official `pydantic-ai-shields` as a real gate is a separate dependency decision (default: not now).
4. **`points_count` ownership (§4a).** **Recommended default: derive `COUNT(points.id)` in the resolver query** (no schema migration, no `enrich.ts` rewrite). Alternative: add a maintained `points_count` column to `upsertBangumi` — deferred.
5. **`/v1/chat` migration shape (§4c).** **Recommended default: route `/v1/chat` through the unified runtime/session boundary** (reuse session load + selection validation + `response_builder` projection; keep only the Vercel streaming envelope). Alternative: a documented standalone Vercel selection/session protocol — more surface, more duplication.
6. **Direct-gate thresholds (§7).** **Recommended default: the initial numbers above (request ≤12, tool-calls ≤6, repeated-identical=0, p95 ≤6), CONFIRMED by a measurement-only PR + owner sign-off before Phase 1c gating turns on.**
7. **Phase 1 shape.** **Recommended default: the phased split in §6** — Phase 0 (security) → 1a (additive catalog) → 1b (additive session-state persistence + RuntimeStage mapping with compat reads) → **1c (the ONE atomic switch)** → 1d (graceful limits + loop gates, then measure→raise the cap in a follow-up). The §9.4-era "catalog → tools+output+prompt+validator → session state → limits" order is **corrected** to **catalog → SessionState (persistence + registry) → tools+output+prompt+validator → limits**, because `SessionState` is a *foundation* for §4b (resolve writes `pending_clarification`), §4c (the validator oracle is `pending_clarification.candidate_ids`; `response_builder` hydrates from `ordered_candidates`), and the registry (the sole `result_ref` home). The old catalog-then-tools order would not compile.

## Revision log (v2)

Each entry maps a change to the review finding(s) it closes. Findings reference the reconciled brief (RECONCILED 1–8), Codex P1-1..P1-8/P2-1, and sonnet P1-1..P1-4/P2-5..P2-9/P3.

- **§4a rewritten to a deterministic algorithm** (dedup-by-work_id via `GROUP BY`, ranking tuple, tie-at-top = ambiguity threshold, `MAX_CANDIDATES=6`, stable order, enrichment `air_date→year`/`points_count`, `fetchBangumiSubjects` N-subject MISS source + normalized-name-exact threshold, `upstream_unavailable`, resolved-vs-empty-vs-not_found separation, 11 unit tests; dropped `format`/`season` as no-storage). Closes RECONCILED 1, Codex P1-1, sonnet P2-5.
- **§4e rewritten to a ref-keyed registry holding full payloads** (`search_results: dict[ResultRef, SearchPayloadState]` + `routes: dict[RouteRef, RoutePayloadState]`; ref gen/lifetime/scope/eviction/stale-ref; `PendingClarification` sole oracle, `GeocodeStaging` staging-only; `AgentResult.session_state` carrier; persistence delta + explicit CLEAR transition replacing the sticky OR; `SessionState` attaches as a field on `ToolState`). Closes RECONCILED 2, Codex P1-2, sonnet P1-4/P2-7/P2-8.
- **§4b/§4c tool outcomes are discriminated unions** (no impossible combos) + **complete clarify validation** (reason==pending.reason, ordered-equal candidate_ids, reason-specific cardinality, reject-when-no-pending, `anime_not_found` + `needs_direct_input` reasons, `clarification_reason` on the outcomes, `candidate_ids` before-coercion kept). Closes RECONCILED 3, Codex P1-2/P1-3, sonnet P2-6.
- **§4c server-owned `RuntimeStage` map on `AgentResult`** + the atomic consumer-migration table (AgentResult.intent, response_builder, chat merge + pending-detection, persistence, analytics, eval, output models) + the clarify-**selection** request contract (`selected_candidate_id` + `clarification_id` + server validation + stale-click rejection). Closes RECONCILED 4, Codex P1-4. *(The single-`selected_candidate_id` contract is superseded by the v2.2 multi-select list.)*
- **§7 eval preservation** = synthetic `clarify`-named step (frozen baselines byte-identical) + geocode-step confirmation + versioned evaluator + additive `agent_redesign_v1.json` + direct thrash red-line gates (request/tool-call/repeat/p95) + both-direction sign-off audit enumerating all 72+7 v3 and 84 runtime_journey clarify cases by reason + alias-seeding precondition. Closes RECONCILED 5, Codex P1-6, sonnet P1-1/P1-3. *(The frozen-baseline preservation half — the synthetic step, byte-identical baselines, and the per-case sign-off audit — is superseded by the v2.2 Decision 1 re-baseline.)*
- **§6 re-phased** = SECURITY Phase 0 (minimal alias allowlist + translation sanitize/usage-share) → 1a additive catalog → 1b additive/versioned session-state persistence + RuntimeStage compat reads → 1c ONE atomic switch (incl. dead-`ui` removal as part of it) → 1d graceful limits + loop gates then measure→raise; §9.4 order corrected to catalog → SessionState → tools+output+prompt+validator → limits. Closes RECONCILED 6, Codex P1-5/P1-8, sonnet P1-2.
- **§4f source cap on the model-facing `_model_summary` return only** (never `build_search_payload`); `items` duplicate removed only after consumer migration + contract tests. Closes RECONCILED 7, Codex P1-7.
- **§4d cache-neutral dynamic wiring** (`instructions=` static/locale only; volatile session context into a trusted user/history part at the runner boundary) + the "candidate_ids is the sole permitted ID echo" resolution + the `web_search`-no-merge rule (principle #9). Closes RECONCILED 8, Codex P2-1, sonnet P2-9.
- **§4h partial-result fully specified** (typed deterministic `partial` stage/status/schema/persistence/SSE) + keep-cap-then-measure resolves the circular limit dependency; **`on_step` → `StepEvent` value object**. Closes Codex P1-8, sonnet P3.
- **P3 folds:** QA/greet 4-name maze collapsed to the single `general_qa` stage + dead `answer_question` `_UI_MAP` key removed; dead handlers (`execute_greet_user`/`execute_answer_question`/`run_clarify`/`_run_ephemeral`) flagged for deletion in the atomic switch; `SessionState` attach-point stated (field on `ToolState`). Closes sonnet P3.
- **§9 owner decisions each carry a recommended default** (MiMo thinking = verify+disable; summarizer = lean cheap; InputGuard = default-off + block; Phase 1 = the §6 split). Closes the brief's owner-default requirement.
- **Status → Draft v2.**

## Revision log (v2.1)

Each entry maps a change to the v2→v2.1 dual RE-REVIEW finding it closes (Codex xhigh P1-1..P1-5/P2-6/P2-7/P3-8; sonnet P1/P2/P3-a..d). Both reviewers agree the core architecture is SOUND and all 8 v1 blockers are substantively closed; these are TARGETED, phase-layered touch-ups.

- **Phase 0 — exact model-alias allowlist enumerated (§4g/§6).** Added the server-owned `MODEL_ALIASES` map (`default|deepseek|mimo`, derived from `base.py:51-53` domain_keys + `settings.py:124/132` raw specs), each alias → `{fixed model spec, fixed base_url, credential env ref}`; unknown alias OR any `@`/scheme/URL-bearing string → typed `ModelAliasError` → **HTTP 400** (never 500, never pass-through to `parse_model_spec`); `model=None` unchanged; named the 6 tests (unknown→400, raw-URL→400, each alias→expected spec, None→default). Closes **Codex P1-5**.
- **Phase 1a — MISS-path Bangumi subject field names corrected (§4a/§6).** `BangumiSubject` now reads `date` (fallback `air_date`) + `images.{large,common,…}` via the SHARED parser (`parse.ts:101,105` `coverFromImages`/`pickStr(["date","air_date"])`), NOT `air_date`/`image`; `points_count` owner named — **derive `COUNT(points.id)` in the resolver query** (the enrich UPSERT `enrich.ts:71-82` does not maintain it); added the subject-parse unit test. Closes **Codex P2-6 / sonnet P3-c**.
- **Phase 1c — normative TOTAL clarify transition table (§4b/§4c/§4e).** Added the total table over every clarify-producing outcome × {producer, union variant, pending payload written atomically, accepted next request, consume action, CLEAR/revision}; rule that EVERY clarifying outcome writes `pending_clarification(reason, ordered_candidates=[] for no-candidate, fresh revision)` before returning — explicitly covering `ResolveNotFound→anime_not_found` + `NearbyMissingLocation→missing_location` (previously unwritten → validator ModelRetry-loop); **DROPPED `needs_direct_input`** from both enums + §4c cardinality + §5 UI (dead, no producer); **split `NearbyNeedsPlace` into `NearbyPlaceAmbiguous` (≥2 ids) + `NearbyPlaceUnresolved` (no id field)** so `place_ambiguity + []` is unrepresentable. Closes **Codex P1-2 / sonnet P1**.
- **Phase 1c — `selected_route.py` added to the atomic consumer table (§4c/§6/§7).** New migration row: drop `RouteResponseModel(intent=,data=)` (both §4c-deleted) → compact `RouteResponseModel(message=)`; write route into `SessionState.routes[ref]`; construct `AgentResult(intent="plan_selected", session_state=…)`; silent-empty-itinerary contract-test guard (response_builder hydrates `data.route` from `session_state.routes`). Closes **Codex P1-3b / sonnet P2**.
- **Phase 1c — `/v1/chat` migration specified (§4c/§6/§7).** Recorded that `chat.py:129` calls `VercelAIAdapter` directly / never builds `PublicAPIRequest`/`AgentResult` / never loads `x-session-id` pending; chose the default = **route `/v1/chat` through the unified runtime/session boundary** (delete the body-scan `_scan_parts_for_clarify`/`_detect_clarify_context`; load persisted pending; map selection into the same server validation; build the DataChunk from `session_state` + server-owned `runtime_stage`), with a standalone-Vercel-protocol fallback; added to the migration table. Closes **Codex P1-3a**.
- **Phase 1c — frozen-v3 `data_keys` compatibility projection (§7).** Pinned the ground truth (NO dataset carries `data_keys`; `DataKeysPresent` short-circuits to 1.0 before reaching `_available_data_keys`, so removal is provably score-neutral); still specified the exact SessionState/tool_state → legacy logical-key projection table (`results/route/candidates/options/question/status`), the `NonemptyResults` `tool_state["search_nearby"].row_count` dependency, and an AC to PIN representative evaluator vectors (search/route/candidate-clarify/no-candidate-clarify) before claiming byte-identical. Closes **Codex P1-1 / sonnet P3-b**.
- **Phase 1c — `clarification_id` typed `int | None` (§4c/§6/§7).** Matches `pending_clarification.revision: int` (a `str` field made `str==int` always False → every valid selection silently rejected); server coerces `int()` if the transport is string-only. Closes **sonnet P3-a**.
- **Phase 1d — distinct `PartialResponseModel` (§4c/§4h/§6).** Replaced the `QAResponseModel`-shaped partial (which mapped to `general_qa`) with a distinct `PartialResponseModel` → `_STAGE_BY_OUTPUT[...]="partial"`; specified runner-owned `success_override`/`status` on `AgentResult` (success is otherwise step-derived); specified the deterministic response_builder projection when several refs exist (`last_result_ref` primary + newest route). Closes **Codex P1-4**.
- **Phase 1d — concrete direct-gate thresholds (§7).** Gave initial numbers (request ≤12/case, tool-calls ≤6/case, repeated-identical=0, p95 ≤6) + dataset scope (full v3 + journey; p95 over regressed-MiMo+v3) + fail semantics (per-case/​p95 breach = red-line merge blocker) + a mandatory measurement-only PR → owner sign-off before Phase 1c gating turns on. Closes **Codex P2-7**.
- **Cosmetic folds.** `last_result_ref` documented as an anaphora hint ONLY — `plan_route` requires an explicit `search_result_ref` and the tool NEVER defaults (§4b/§4d/§4e); removed the dead `_UI_MAP` `"unclear"` key alongside `answer_question` and cross-referenced the new `"partial"` key in the §4c `_UI_MAP` cleanup row (§4c/§4i). Closes **Codex P3-8 / sonnet P3-d**.
- **Status → Draft v2.1.**

## Revision log (v2.2)

Each entry maps a change to the owner decision (2026-07-16) it implements. THREE decisions: (1) RE-BASELINE the eval; (2) LOOSE MISS-path clarify; (3) MULTI-SELECT clarify via a deterministic server handler. SPEC changes only — no architecture move; the §4b union shapes, §4c validator guard, §4e oracle rules, and the Phase 0/1a/1b boundaries all stand.

- **Decision 1 — §7/§8/§6-1c rewritten from preservation to RE-BASELINE ("没必要兼容 / 直接做到最好的方案").** DROPPED the `_available_data_keys` SessionState→legacy-key compatibility projection (§7) — Phase 1c now removes `output.data` cleanly and `data_keys` is recomputed from the new SessionState-sourced key vocabulary. DROPPED the "runner synthesizes a `clarify`-named step to keep frozen chains green" requirement (§7/§4h) — it existed only for baseline preservation; the runner MAY still emit a REAL clarify step for genuine SSE/analytics value (§4h rewritten), and evaluator chains are re-derived from real trajectories (evaluator version bump REQUIRED). RED LINE (§7/§8) changed from "byte-identical baselines" to: build the clean design → after 1c lands, run the full eval → present the NEW-vs-OLD comparison (expected: thrash failures DOWN, routing/nonempty UP) → **owner confirms the new baseline AS A WHOLE** (no per-case `expected_stage` sign-off; the v2.1 `clarify_case_audit.csv` per-case audit is dropped — §7 #1 gate rewritten). KEPT: the direct thrash red-line gates (request ≤12/case, tool-calls ≤6/case, repeated-identical=0, p95 ≤6) + the calibration PR. §6 Phase 1c SIMPLIFIED: projection + synthetic-step bullets removed; evaluator-update + post-1c "run eval → establish new baseline → owner confirms" steps added. Also updated: §4c consumer-table eval rows, §8 "Frozen baselines"→"Re-baselined eval" bullet, §9.1, §4a eval note, TL;DR markers. (Owner pre-approved the re-baseline; §8 sign-off given.)
- **Decision 2 — §4a MISS path loosened from EXACT tie to deterministic NAME-SIMILAR.** The MISS rule is now: `similar` = fetched Bangumi subjects whose normalized `name` or `name_cn` is a substring-containment match with the normalized query in EITHER direction (`normalizeAlias(subject.name).includes(q) || q.includes(normalizeAlias(subject.name))`, likewise for `name_cn`; empty-string guards; the predicate is stated precisely so implementation does not guess), capped at `MAX_CANDIDATES=6` in relevance order; `similar ≥2 → needs_disambiguation` (e.g. "凉宫" → pick among the several 凉宫ハルヒ works), `==1 → resolved(similar[0])`, `==0 → resolved(subjects[0])` head-pick, `0 subjects → not_found`. Thrash-safety paragraph rewritten: the rule is DETERMINISTIC (the catalog computes the candidate set; the model never judges) and clarify is a ONE-STEP TERMINAL output with no `ModelRetry` loop — thrash came from model judgment + looping, NOT clarify frequency; the old "anything looser would explode the clarify partition" caveat is MOOT under Decision 1's re-baseline. The HIT (alias-index) path stays PRECISE (exact tie) — stated in §4a. §4a unit tests updated (exact-match tests → fuzzy/name-similar + cap + empty-string-guard tests); the predicate + caps flagged as eval-tunable against the NEW baseline. **Downstream flag (§6 Phase 1a): the already-built 1a resolver implements the TIGHT rule and MUST be AMENDED to the loose rule before 1c wires it** (clean — 1a is additive and not yet consumed). §4b `resolve_anime` note + §4a eval note reconciled.
- **Decision 3 — MULTI-SELECT clarify as a deterministic server handler (NOT CodeMode), bundled into 1c.** §4c selection contract rewritten to a LIST: `PublicAPIRequest.selected_candidate_ids: list[str]` (len ≥1; single-select = a list of 1 — ONE uniform path; REPLACES v2.1's single `selected_candidate_id`) + `clarification_id: int`; the server validates EVERY id ∈ `pending_clarification.candidate_ids` AND `clarification_id == revision`, rejects stale/invalid wholesale (any non-candidate id or revision mismatch), dedups duplicates, and enforces reason-specific selection cardinality (anime 1..N; place exactly 1; free-text reasons reject any selection). NEW handler `execute_multi_selection(candidate_ids, …)` — analogous to `execute_selected_route`, dispatched from `_run_pipeline`, BYPASSES `animichi_agent.run`, and explicitly NOT CodeMode (merge/dedup/route is deterministic app code — principles #2 "compute in the data layer" + #10 "no skills/CodeMode"; the prior CodeMode spike was killed): parallel `pointsByWorkId` fetches (`asyncio.gather`) → the §4e-defined deterministic merge/dedup op (union in selection order, first-occurrence dedup by stable point id — franchise works share spots — stable ordering) → ONE combined `SearchPayloadState(kind="multi", anime_ids=[…])` in `SessionState.search_results[ref]` → the same deterministic route op over the merged set → `AgentResult(intent="plan_multi", …)` with `_UI_MAP["plan_multi"]="RoutePlannerWizard"`. §4c transition table `anime_ambiguity` row: consume action → `execute_multi_selection(selected_candidate_ids)` → merged search + route; CLEAR pending + bump revision on valid selection (place row updated to the plural field, exactly-1). §4e: `SearchPayloadState.kind` gains `"multi"` + `anime_ids`; the merge/dedup specified as a defined deterministic op; CLEAR-transition wording updated. §5: clarify card = MULTI-SELECT (checkboxes); the wire carries `selected_candidate_ids` (list) + `clarification_id`; `plan_multi` row added. §4c consumer table: `_run_pipeline` selection-dispatch row added; chat pending-detection + `/v1/chat` migration updated to the plural field. Thrash-safety unchanged: ZERO model round-trips anywhere in the selection path. §6 Phase 1c bullets + §7 eval items + §8 contract pins updated (multi-selection validation + merge-determinism tests).
- **Status → Draft v2.2.**

## Revision log (v2.3)

Each entry maps a change to the v2.2→v2.3 FOCUSED dual review of the three owner decisions (sonnet a055ed1d + Codex xhigh task-mrn2b52u, 2026-07-16, both *needs-revision-TARGETED*; reconciled brief items 1–9 = sonnet P1-1/P2-1/P2-2/P3-1..3 + Codex P1-A/P1-B/P1-C/P2-D/P2-E/P3-F). **Both reviewers CONFIRMED the three v2.2 decisions are structurally sound and cleanly integrated** — v2.3 fills in the NEW multi-select machinery's failure/eval/persistence contracts. NO re-architecture; the §4b unions, §4c validator guard, §4e oracle rules, and the phase boundaries all stand. Two owner inputs of 2026-07-16 are folded in: the **GLOBAL principle "no historical baggage — the cleanest design wins every decision"** (consistent with Decision 1's re-baseline), and the **route-persistence decision (normalized join table)**, which overrides the brief's hedged nullable-column default.

- **Item 1 [Codex P1-A + sonnet P2-1] — `execute_multi_selection` TERMINAL MATRIX (§4c/§4e).** Step 1 re-grounded against the real endpoint: `pointsByWorkId` returns a plain `SearchResult` (`search.ts:130` = `hitResult`, published points only — NO typed `upstream_unavailable`, NO ingest), so failure handling lives AT the handler (`asyncio.gather(..., return_exceptions=True)`; a thrown fetch = `fetch_failed`; `rows=[]` — including an un-ingested Bangumi-only MISS candidate — is a valid EMPTY work and **never triggers ingest from this handler**). Added the TOTAL terminal matrix T1–T6: success / MIXED-empty / MIXED-failed (route over the contributors + the new `SearchPayloadState.omitted_work_ids`, §4e) / ALL-empty → a **typed empty terminal with NO route** (mirrors the selected-route silent-empty RED guard; `RouteOk.point_count ge=1` keeps an empty itinerary unrepresentable) / ALL-failed → a typed error mirroring `selected_route._error_result` / ROUTE-TOO-LARGE → a typed "narrow your selection" terminal (>500 merged points pre-checked at the handler per `MAX_ROUTE_POINT_IDS`, `router.ts:55`; >50 clusters via a typed catch of `routeTooManyClusters`, `lib/route.ts:54` + `api/route.ts:76`) — never a crash, never a raw 400/500 pass-through. **Pending rule pinned:** cleared only when a route ships (T1–T3); PRESERVED on T4/T5/T6 + every invalid request (T4 preserves because UNSELECTED candidates were never fetched — re-picking can succeed; no permanent latch, the §4e clear transition still applies). `AgentResult.status` gains `"empty"/"too_large"/"error"` on this server-composed path. Boundary tests pinned: 500/501 points, 50/51 clusters, all-empty, mixed, zero-ingest assertion (§4c/§6-1c/§7/§8).
- **Item 2 [sonnet P1-1, BLOCKER] — selection dispatch BY REASON + the NEW `execute_place_selection` (§4c/§5/§6-1c).** The §4c consumer-table dispatch row no longer sends ALL `selected_candidate_ids` to `execute_multi_selection` — both clarify reasons arrive on the SAME field, so dispatch is keyed by `pending_clarification.reason`: `anime_ambiguity → execute_multi_selection`; `place_ambiguity → execute_place_selection`, a NEW deterministic sibling handler (agent-bypassing, NOT CodeMode): validate the exactly-one id ∈ pending place candidates → **staged coords** from `ordered_candidates` (`OrderedCandidate` gains `lat`/`lng` for gazetteer candidates, §4e — no re-geocode on consume) → the same deterministic nearby-search op → `SearchPayloadState(kind="nearby")` → `intent="search_nearby"` (no new `_UI_MAP` key) → clear/bump; thrown search failure mirrors T5 (pending preserved). Transition-table place row + §5 rows/selection-loop updated; added to the §6 Phase-1c bullets; `current_anime` untouched by a place choice.
- **Item 3 [Codex P1-B] — eval-harness D3-awareness (§7).** The stage→data-key vocabulary is now an exact table — **`clarify → reason + candidates`** (the phantom `question` key is gone: `PendingClarification` carries `{reason, candidate_ids, ordered_candidates, revision}`), **`plan_multi → results AND route`** (the §4c dual projection). NEW "Eval-harness D3-awareness" subsection: `AgentInput` (`evaluators.py:43-51`) gains `selected_candidate_ids` + `clarification_id` + a `seeded_pending` serialized-PendingClarification fixture; the loader maps the same keys; `task()` dispatch (`eval_harness.py:279`) gains a `_selection_task` that seeds `SessionState`, runs the SAME server validation, and dispatches by the seeded reason to the deterministic handlers with `MockCatalogClient` (never `run_animichi_agent`). **`plan_multi` trajectory scoring is a function of the selected count:** chain `("search_bangumi",) × N + ("plan_multi",)`, min-steps `N + 1`; place-selection chain `("search_nearby",)`. **`NonemptyResults` pinned:** route-producing cases inspect the produced route's `RoutePayloadState.source_ref` registry entry (`row_count > 0` AND non-empty `ordered_points`) — a route over an empty source can never score nonempty. Two new verification ACs (source_ref inspection; dispatch-by-reason).
- **Item 4 [Codex P1-C + OWNER DECISION 2026-07-16] — route persistence = the normalized `route_anime` JOIN TABLE (§4c/§6-1c/§7/§8).** `maybe_persist_route` (`persistence.py:270`) added to the §4c consumer-migration table: today it persists ONLY `intent=="plan_route"` with a REQUIRED single `bangumi_id` (:278/:298-303) → a `plan_multi` route would silently vanish (and `plan_selected` already does). Per the owner's override of the brief's "nullable `bangumi_id` + `anime_ids` in JSON" default: an **additive migration creates `route_anime(route_id FK ON DELETE CASCADE, bangumi_id FK, PK(route_id, bangumi_id))`, backfills from `routes.bangumi_id` (verified nullable `TEXT REFERENCES bangumi(id)`, migration `20260402120000:121-132`), then DROPS the single column + its index — ONE source of truth, no dual-write, no legacy path.** The gate widens to `intent ∈ {plan_route, plan_selected, plan_multi}`; association ids derive from the typed `SessionState` source payload (`kind="bangumi"` → 1; `kind="multi"` → `anime_ids` minus `omitted_work_ids`, selection order; `kind="nearby"` → the DISTINCT touched works, replacing today's silent bail-out; `plan_selected` → the routed rows' distinct works) — the `plan_params`/`infer_bangumi_id` dict-digging is deleted. `save_route(session_id, anime_ids: list[str], …)` + `get_user_routes` return the joined `anime_ids`; persistence tests pin 1/1/N/0..M across all four shapes + backfill preservation.
- **Item 5 [sonnet P2-2 + Codex P2-D] — over-clarify INFORMATIVENESS GUARDS (§4a/§6-1a/§7).** Exact equality always counts; new deterministic guards on the containment predicate: `MIN_QUERY_LEN=2` (a sub-2-char normalized query matches by exact equality ONLY — `"k"` never substring-clarifies, the title "K" still resolves), and reverse containment (`q.includes(n)`) additionally requires `MIN_SIMILAR_LEN=2` AND `MAX_REVERSE_RATIO=3` (a long model-extracted sentence cannot swallow "K"/"C"/"86"). Token boundaries REJECTED as the mechanism (CJK has none) — the length-ratio bound is the cross-locale deterministic guard. "凉宫" preserved (2-char FORWARD containment, no ratio bound). Constants eval-tunable with `MAX_CANDIDATES`/`BANGUMI_FETCH_N`. Four new §4a unit cases + a §7 eval item; the §6-1a resolver amendment now SHIPS the guards with the loose rule (never bare).
- **Item 6 [Codex P2-E] — REQUEST-MODE exclusivity (§4c/§5/§6-1c/§7/§8).** A request is exactly one of three mutually exclusive modes — `selected_point_ids` XOR `selected_candidate_ids` XOR plain text — checked BEFORE any dispatch; mixed modes rejected typed; `clarification_id` required IFF candidate-selection mode (each without the other is invalid); candidate ids normalized + first-occurrence-deduped BEFORE the cardinality check (`["A","A"]` = a valid place single-select); **every invalid/ambiguous request preserves `pending_clarification` untouched** (no clear, no bump). Echoed in the §5 wire contract, the §6-1c adapters bullet, §7 eval items, and the §8 pins.
- **Item 7 [sonnet P3-2 + Codex P3-F] — runner clarify-step PINNED to ALWAYS (§4h/§7).** The §4h "MAY" is resolved: the runner **always** records a genuine terminal `clarify` StepRecord when the final output is `ClarifyResponseModel` (recorded after `validate_output` passes; a `ModelRetry`-rejected attempt records nothing) — so the eval chains are deterministic (`[resolve_anime, clarify]` / `[geocode, clarify]`). **Gate accounting added:** runner-synthesized StepRecords (the terminal clarify record, SSE thinking steps) are EXCLUDED from the tool-call ≤6 and repeated-identical=0 gate counts — the direct thrash gates count MODEL-initiated tool calls only.
- **Item 8 [sonnet P3-1] — `response_builder` `plan_multi` DUAL projection (§4c consumer row).** The migration row now states both halves: `intent=="plan_multi"` → project `data.results` from the merged `last_result_ref` AND `data.route` from the newest route ref (matching §4c step 4 / §5 / the §7 data-key table).
- **Item 9 [sonnet P3-3] — `current_anime` after `kind="multi"` + cosmetic log tags (§4e / v2 log).** Pinned: `execute_multi_selection` sets `current_anime=None` for a ≥2-work selection (no single identity; anaphora falls back to the merged `last_result_ref`), and sets it to the work for a single-select (list of 1) — the uniform path's only cardinality-conditional; `execute_place_selection` never touches it. The two v2 revision-log entries carrying superseded designs (the single `selected_candidate_id` contract; the frozen-baseline preservation half) now carry explicit "(superseded by v2.2 …)" tags.
- **Status → Draft v2.3.**

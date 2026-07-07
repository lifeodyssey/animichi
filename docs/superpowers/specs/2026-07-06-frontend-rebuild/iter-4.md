# Iteration 4 — 残す (Keep): しおり

Detail level: **pre-build refinement**. Story count: 9 (originally 7 product/enabler stories + S4.8/S4.9 added by SD-26 phase 2, see below).

Suggested dependency order: S4.5 (share-token enabler) / S4.7 (R2 enabler) can go first → S4.1 → S4.2 → S4.3 → S4.4; S4.6 depends on S4.7. S4.8 (image-search phase 2 coarse-screen + rerank pipeline) can be developed in parallel with the 対比図/しおり main line, sharing S4.7's image data pipeline; S4.9 depends on S4.8.

**Data access path (final, SD-2)**: both S4.5 and S4.7 go through `workers/users` oRPC + Neon, not a direct RLS connection (RLS is Neon-native defense-in-depth per SD-31) — consistent with main spec §2's "global convention: user-domain data access path."

**Image pipeline (final, X6)**: all resizing/compression/compositing of user photos happens client-side on canvas; R2 only stores the final artifact; shared items strip EXIF (GPS privacy) by default, with EXIF pass-through remaining opt-in.

**SD-26 phase-2 (image-search precision matching) scheduling note**: phase 1 (LLM vision coarse-recognizes the anime) already shipped in Iteration 1 and is independently releasable; this iteration ships phase 2 (within-anime shot-angle precision matching), sharing a reference-image data pipeline with 対比図 and the Iteration-3 Walk shot-angle feature — building the index once, along the way, has the lowest marginal cost (verbatim from the SD-26 final decision). **D1-D6 pipeline-supplement details (backfilled from SD-26) are folded into S4.8/S4.9 below.**

---

### S4.1 しおり layout family (ticket 切符 / single-panel 一枚看板 / album-grid アルバム格子 / poster-fallback ポスター)

**Scope**: build the 4 layouts (ticket 切符 / single-panel 一枚看板 / album-grid アルバム格子 / poster-fallback ポスター), with photo-count-driven selection logic.

**Design basis**: `しおり share 状态总览.html` (layout family); `しおり demo.html` (live layout switching as photos are checked one by one).

**Core AC**:
- Happy path: different photo counts correctly switch to the corresponding layout (ticket/panel/grid) -> browser
- Empty: zero photos selected falls back to the poster-fallback layout, not a broken empty ticket -> browser
- Error: an unusually large photo count still converges to some valid layout (album-grid's high-density mode), without crashing -> unit

**Changed files**: `apps/web/src/components/shiori/layouts/{Ticket,PosterSingle,AlbumGrid,PosterFallback}.tsx`, `apps/web/src/lib/shiori/layoutSelector.ts`.

**Dependencies**: none (this iteration's foundation).

---

### S4.2 しおり generation screen (planned version / completion-commemorative version) + EXIF stripped by default (X6)

**Scope**: auto-compose a しおり from route + check-in data (no manual editing required), producing either a **planned version** (no ✓) or a **commemorative version** (with ✓ + completion rate) depending on the route's data state (main spec §8.2 Q2 default).

**Design basis**: `しおり share 状态总览.html` (2 generation screens); `spec-route-detail.md` §3 (CTA copy evidence, Q2 default already decided); main spec X6.

**Core AC**:
- Happy path: a completed route auto-generates a commemorative-version preview with ✓ and completion stats (walking time N min · N km · time window), with zero manual input -> browser
- Happy path: an incomplete/planned route generates a planned-version preview with no ✓ -> browser
- Empty: a route with zero check-ins that also isn't "today" still generates some valid planned-version preview, not a blank one -> browser
- **X6 hard AC**: any user photo content flowing into a しおり image has its EXIF (GPS) stripped by default before it's rendered into an exportable image; retaining it requires an opt-in checkbox -> unit
- i18n: the planned-version/commemorative-version labels and stats copy render in ja/zh/en -> unit

**Changed files**: `apps/web/src/components/shiori/ShioriGenerator.tsx`, `apps/web/src/lib/shiori/compose.ts`, `apps/web/src/lib/image/exifStrip.ts`.

**Dependencies**: S4.1.

---

### S4.3 `/s/:id` public share page (SSR) + SW network-first verification (X7)

**Scope**: a public, read-only share page, rendered via selective SSR (G3), showing a "✓ author completed this" badge + anime frame × real photo side-by-side comparisons + a 「自分用にアレンジ」("customize for myself") CTA deep-linking into chat's A2b flow; mobile completed/planned states + a desktop state.

**Design basis**: `しおり share 状态总览.html` (3 public-page variants); `user-journey.md` §3.1 (public share-page description); main spec X7.

**Core AC**:
- Happy path: requesting `/s/:id` for a completed route already contains the route title and the ✓ badge in the server-rendered HTML before any client-side JS runs (at the view-source level) -> browser
- Happy path: the 「自分用にアレンジ」CTA navigates into chat and pre-fills the A2b reference-context card -> browser
- Empty: a nonexistent/revoked share token renders an equivalent of "このページは見つかりません" ("this page could not be found") 404, not a broken half-page -> browser
- **X7 hard AC**: with the service worker (S3.6) already active, requesting `/s/:id` never returns stale cached HTML — verified with a browser test that toggles network conditions to confirm network-first behavior -> browser
- i18n: the page renders in ja/zh/en per locale/query -> unit

**Changed files**: `apps/web/src/routes/s/$shareToken.tsx` (SSR loader), `apps/web/src/components/share/*`, `apps/web/src/sw.ts` (extended network-first rule covering this route).

**Dependencies**: S4.2, S4.5 (share-token data source).

---

### S4.4 Dynamic OG rendering pipeline (1200×630, share-page launch template) + 対比図 into the image sitemap (backfilled from SD-27 seo-geo-plan.md §4)

**Scope** (**revised**: the earlier version's spec, written against `user-journey.md` §6.6's "9:16 portrait satori+resvg しおり visual," has been superseded by the SD-27 landing package — the authoritative spec is now the standard **1200×630** OG size, with copy localized per page language and artifacts cached in R2; the technology choice — Satori-family `workers-og` vs. CF Images — is left to the executor, not locked in). This iteration delivers the **shared dynamic-OG rendering infrastructure**; the first concrete template is the `/s/:id` share page (route thumbnail + completed-stop count). The anime-page template (cover + spot count + frame-comparison collage) isn't built until `/anime/:id` ships in iteration 5 — this story's rendering pipeline leaves a pluggable template-registration mechanism for `iter-5.md` (S5.1) to plug its concrete template into (not rebuild the pipeline).

**Design basis**: `docs/superpowers/specs/2026-07-06-seo-geo-plan.md` §4 "sitemap system + new-title SLA + dynamic OG"; iteration 0's static OG (S0.8) is the fallback — this story adds a dynamic layer on top of it, not a replacement.

**Core AC**:
- Happy path: requesting the OG-image endpoint for a completed route returns a valid 1200×630 PNG showing the route thumbnail + completed-stop count, with copy rendered in the requested page's language -> integration
- Happy path: the generated OG image artifact is cached into R2; a repeat request for the same share token hits the cache instead of re-rendering -> integration
- Empty: a route with no representative scene frame falls back to a generic brand-gradient background, not a broken image -> unit
- Error: if OG rendering fails (the renderer throws), it falls back to S0.8's default static OG card, not a 500 -> integration
- Extensibility (for the iter-5 hookup): the rendering pipeline is organized around "template registration" (the share-page template being this iteration's only implementation); adding the anime-page template later requires no changes to the core rendering/caching logic -> unit
- **対比図 into the image sitemap** (backfilled from SD-27 seo-geo-plan.md §4/§7): once a 対比図 artifact is uploaded and confirmed via S4.7, a build/deploy-time script auto-generates its `sitemap-images.xml` entry from the Neon `comparison_uploads` table (R2 public URL + associated page URL) — not hand-maintained -> integration

**Changed files**: `apps/web/src/routes/s/$shareToken/og-image.tsx` (edge-rendered route, templated), `apps/web/src/lib/og/renderOgImage.ts` (shared rendering + R2 caching), `apps/web/src/lib/og/templates/shareRoute.ts`, `scripts/generate-image-sitemap.ts` (new).

**Dependencies**: S4.3, S4.7 (image-sitemap data source).

---

### S4.5 Share-token backend enabler (`workers/users` oRPC + Neon, SD-2 final)

**Scope**: issuing and publicly resolving route share tokens.

**Design basis**: no visual mockup.

**Backend enabler (final)**: a new Neon table `route_shares` (`id`, `route_id` FK, `share_token UNIQUE`, `created_by` user_id, `created_at`, `view_count`); `workers/users` gets two new kinds of endpoints — an authenticated `users.shares.create` (owner-only) + a **public** `users.shares.resolve` (looks up by token, no JWT required, read-only, aimed at anonymous visitors); `apps/web`'s `/s/:id` SSR loader calls this public oRPC endpoint directly server-to-server (not a browser-to-Neon direct connection).

**Core AC**:
- Happy path: creating a share for a route you own returns a token; resolving that token via the public endpoint returns the route summary with no auth required -> integration
- Empty: resolving a nonexistent token returns a clean "not found" response, not a 500 -> unit
- Error: attempting to create a share for a route you don't own is rejected (403) -> integration

**Changed files**: `workers/users/src/db/schema.ts` (new `route_shares`), `workers/users/src/api/shares.ts` (new, includes the public read-only sub-route), `packages/contract/src/users-contract.ts` (new share contract).

**Dependencies**: S2.8.

---

### S4.6 対比図-creation flow (client-side canvas pipeline, X6)

**Scope**: CMP-0 confirm framing → 1 on-site photo (getUserMedia ghost overlay) → 2 choose a photo → 3 composite (canvas) → 4 done, 5 states total; HEIC warning; EXIF opt-in.

**Design basis**: `対比図作成 状态总览.html`; `対比図作成 demo.html` (real getUserMedia + canvas compositing); main spec X6, X10.

**Core AC**:
- Happy path: the flow runs from CMP-0 through CMP-4, and the resulting comparison composite is produced entirely on the client via canvas (the compositing itself never makes a server round trip) -> browser
- Empty: without camera permission granted, gracefully degrades to the "choose a photo" (upload an existing photo) path, rather than a dead end -> browser
- Error: selecting a HEIC file shows the documented warning ("save as JPG" guidance), not a silent rendering failure -> browser
- **X6 hard AC**: source-photo resizing/compression happens client-side before any upload; the final composite strips EXIF by default unless the user opts in -> unit
- Via the adapter layer (X10): all `getUserMedia` access goes through `platform.camera` -> unit

**Changed files**: `apps/web/src/components/comparison/*`, `apps/web/src/lib/comparison/canvasComposite.ts`, `apps/web/src/platform/camera.ts`.

**Dependencies**: S4.7 (final-artifact upload).

---

### S4.7 Image-upload R2 enabler (presign worker route)

**Scope**: a presigned-upload flow for user-generated 対比図/しおり material.

**Design basis**: no visual mockup.

**Backend enabler (final)**: the root Worker (`worker/app.ts`) gets a lightweight new route that issues short-TTL presigned PUT URLs scoped to the `/uploads/{user_id}/` prefix of the `seichijunrei-assets` R2 bucket (authenticated via JWT); on successful upload, `apps/web` records the metadata through a `workers/users` oRPC endpoint (a new Neon table `comparison_uploads`: `id`, `user_id`, `point_id`, `r2_key`, `exif_opt_in`, `created_at`).

**Core AC**:
- Happy path: requesting a presigned URL and directly PUT-ing an image to R2 succeeds, and the resulting `r2_key` is recorded via `workers/users` -> integration
- Empty: a user with zero prior uploads can still successfully request their first presign, without erroring -> unit
- **Security AC**: a presigned URL issued for user A's prefix cannot be used to write into user B's prefix (the path is server-determined; the server never trusts a client-supplied path parameter) -> integration

**Changed files**: `worker/r2Presign.ts` (new), `worker/app.ts` (route wiring), `workers/users/src/db/schema.ts` (new `comparison_uploads`), `workers/users/src/api/uploads.ts` (new).

**Dependencies**: S2.8, S0.4 (R2 bucket already provisioned).

---

### S4.8 Image search phase 2: within-anime shot-angle precision matching (embedding coarse-screen + LLM vision rerank, backfilled from SD-26)

**Scope**: phase 2 of the two-phase image-search architecture (SD-26) — phase 1 (LLM vision zero-index coarse anime recognition) already shipped in Iteration 1 and is independently releasable; this story delivers the shot-angle-level (機位) precision-matching pipeline once candidates have already been narrowed to a "single series" scope. **Architecture confirmation (SD-26 final decision, revised after data verification)**: the Anitabi data [verified: a 68-spot sample check on 君の名は。("Your Name")] only has an anime-frame field, with **no real-world reference-photo field** (`origin`/`originLink` are only screenshot-source attribution) — meaning anime2real (anime frame ↔ real photo) is the only cross-domain matching path that currently exists; a same-domain real2real fast path doesn't exist yet at launch. Consequently:
- **Embedding coarse-screening is standard but only a first pass**: the union of the series (all works belonging to the same series per the series-aware resolve logic) → top 20-30 candidates. Starting model: **Gemini Embedding 2**, truncated to 1536 dimensions + `halfvec` storage (Neon pgvector); a system-owned key, **not drawn from the BYOK quota** (unrelated to the user's BYOK key — this is internal retrieval infrastructure).
- **LLM vision rerank is the main workhorse** (not a subordinate step to the coarse screen): it performs an anime2real reasoning-based comparison (not a vector-distance comparison) on the embedding-coarse-screened candidates, because only reasoning-based comparison can bridge the anime-to-real domain gap; processed in batches, **10-20 images per batch**; the vision call uses the user's BYOK key only when it has been capability-probed `vision_capable`, otherwise it falls back to the platform Gemini model selected by quota tier (SD-26 D4/D5 — the full decision tree lives in `iter-1.md`'s S1.3, referenced here, not redefined).
- **No ANN index is built (an explicit non-goal, not an oversight)**: at the currently measured scale — 10 to 600 points per anime, 1000+ once a series is merged ([verified] the full 青ブタ series at 1031, Summer Pockets at 374) — a `bangumi_id`/series-filtered pgvector brute-force scan stays in the millisecond range at this scale, well below the point (50-100k rows) where HNSW-style ANN indexing starts paying off; `halfvec` plus dimension truncation pushes that crossover point out even further. Full-catalog cross-series search (the scenario where an ANN index might actually be warranted) is tracked under the frozen DD-11/DD-12 and is out of scope for this iteration.
- **Offline A/B evaluation matrix (hard AC, the final choice is decided by measurement, not guesswork)**: an offline evaluation across the {Gemini Embedding 2, Qwen3-VL-Embedding (if a hosted API is available), Voyage 3.5} × {emb-only, LLM-only, hybrid} combinations — **9 combinations, or 6 if Qwen3-VL turns out unavailable** — producing an accuracy/latency/cost comparison report, with the final configuration written into code config (not left as an open discussion).
- **Unified tool signature (backfilled from SD-26 supplement D1)**: the precision-rerank pipeline is exposed externally through a single tool, `match_scene(image, scope: {bangumi_ids} | {geo, radius})`; this story (within-anime precision matching) uses the `scope: {bangumi_ids}` variant, sharing the same tool signature and the same downstream rerank-pipeline code with S4.9 (GPS-based reverse discovery, the `scope: {geo, radius}` variant) — the agent only ever sees one tool (SD-7's "no added orchestration-layer philosophy").
- **Rerank batch cap and degradation (backfilled from SD-26 D3)**: a single query's LLM vision rerank is capped at **2 batches** (10-20 images each); on timeout or exceeding the batch cap, the request doesn't block the user — it returns the embedding coarse-screen's top-3 candidates directly, labeled as a "degraded result" (never passed off as a rerank result).
- **Low-confidence routing (backfilled from SD-26)**: when the rerank's best match falls below the confidence threshold, the pipeline doesn't force an assertion — it routes to the existing `clarify` tool to ask the user for clarification (reusing the existing D1-D9 exception-state design, no new mechanism needed).
- **Vision-supply decision tree (details in iter-1, referenced here)**: the BYOK-vs-platform vision-model selection, capability probing, and canary judgment logic are defined in `iter-1.md`'s S1.3 (写真検索, "photo search," phase 1) / S1.11 (BYOK) stories; this story's rerank calls directly reuse that same supply decision and credential-selection path without redefining it.

**Design basis**: no visual mockup (a purely backend retrieval pipeline); inputs §11, SD-26 row (the complete image-search two-phase final decision text).

**Core AC**:
- Happy path: given a query image + a known series scope, the embedding coarse screen returns the top 20-30 candidates across every spot in that series (including spots belonging to other anime in the same series union), at **p95 ≤ 1.5s for a series-union scan of ≤1,100 embeddings** (initial value; executor may tune with evidence) -> integration
- Happy path: candidates from the embedding coarse screen, after LLM vision rerank (in batches of 10-20), return a ranked best match + a confidence score -> integration
- Empty: when the candidate series hasn't been embedding-indexed yet (cold start / a brand-new anime), the rerank pipeline gracefully degrades to a direct vision batch scan of every spot in that series, rather than erroring or returning empty -> unit
- Performance threshold (a verification assertion for the "no ANN index" decision): at series-merged scale (up to ~1200 points), pgvector brute-force scan query latency stays locked within the coarse-screen p95 ≤ 1.5s regression threshold (the same initial value asserted in the happy-path AC above; executor may tune with evidence); exceeding it logs an alert and triggers a DD-12 (ANN indexing) re-evaluation, rather than silently degrading -> integration
- **Offline A/B evaluation matrix (hard AC)**: run the {Gemini, Qwen3-VL (if available), Voyage 3.5} × {emb-only, LLM-only, hybrid} offline evaluation, produce a quantified report (accuracy/latency/cost), and land the report's conclusion as the actual model/strategy configuration in use (not merely a documented recommendation) -> eval
- **Evaluation-set scale (hard AC, backfilled from SD-30 L3)**: the offline A/B evaluation corpus is structured as **~10 anime titles × 7 shot-angles (機位) × 2 query modalities ≈ 140 labeled pairs** (an anime-frame query and a real-scene-photo query), landing within the SD-30 L3 **100-150** target band -> eval
- **Canary AC (backfilled from SD-26 D5)**: the rerank prompt requires the model to first report how many images it received; when the model's reported count doesn't match the number actually sent, that vision supply is judged unreliable, this request falls back to the platform model, and the capability flag is updated -> integration
- **Low-confidence-routing AC**: a query whose rerank best-match confidence falls below the threshold is routed to `clarify` instead of forcibly returning an unreliable match -> integration
- **Batch-cap degradation AC**: a query that exceeds the 2-batch rerank cap or times out during reranking returns the embedding coarse-screen's top-3 candidates labeled as a "degraded result," rather than hanging or erroring -> integration

**Changed files**: `apps/agent/agent/infrastructure/vision_search/coarse_screen.py` (new, **query-side only**: embed the user photo + brute-force vector scan — index *building* lives in the catalog ingestion pipeline per SD-26 D2, the agent only consumes), `apps/agent/agent/infrastructure/vision_search/visionRerank.py` (new, rerank; also implements the 2-batch cap, canary check, and low-confidence routing), `apps/agent/agent/agents/tools/match_scene.py` (new, the `@agent.tool` registration exposing the unified `match_scene(image, scope: {bangumi_ids} | {geo, radius})` signature, internally orchestrating coarse_screen → visionRerank), `apps/agent/agent/tests/eval/vision_search_ab.py` (new, offline A/B evaluation, including the ~140-pair labeled corpus), Neon `spot_embeddings` table migration (a `halfvec(1536)` column, via the SD-1 tool chain).

**Dependencies**: S4.7 (the shared image data pipeline); iteration 1's series-aware resolve (series attribution).

---

### S4.9 Reverse-discovery layer 2, completed + flywheel-3 check-in photos unlock the real2real fast path (backfilled from SD-26)

**Scope**: the three reverse-discovery layers (SD-26 final decision) — the recognition path for when you recognize a scene on-site but don't know which anime it's from: layer 1 (LLM world-knowledge direct recognition, already obtained for free in iteration 1) → **layer 2 (GPS nearby-search coarse screen + vision rerank, completed by this story)** → layer 3 (full-catalog vector search, a future item frozen under DD-11). Layer 2's coarse-screen key is already usable as of iteration 1 (the existing `search_nearby` tool, switched to a `ST_DWithin` geo query); this story completes layer 2's **rerank** half (reusing S4.8's vision-rerank pipeline), turning layer 2 into a fully usable recognition path rather than a coarse-screen-only one. **Flywheel-3 strategic-asset confirmation (SD-26 data-verification revision)**: since Anitabi has no real-world reference-photo field (see S4.8's background), **check-in photos are the only source of real-world reference photos** available; this story delivers a "per-spot unlock" mechanism — once a given spot's count of **human-reviewed/approved** check-in photos crosses a threshold, that spot gains a real2real (real ↔ real) fast path (faster and more accurate than anime2real cross-domain reasoning); otherwise it keeps using S4.8's anime2real path. **Only photos that have passed the flywheel-3 human review gate (SD-23) count toward the unlock — auto-ingestion of raw check-in photos into the reference index is prohibited (SD-26 D2).** Because the flywheel-3 review pipeline is itself frozen under DD-7, if that review pipeline is not yet built when iteration 4 is scheduled, this unlock ships **dormant**: the decision code and telemetry are in place, but no spot can cross the threshold until reviewed photos exist, so every spot keeps using the anime2real path in the meantime.
- **Unified tool signature (backfilled from SD-26 D1)**: this story (GPS reverse discovery) shares the same `match_scene(image, scope: {bangumi_ids} | {geo, radius})` tool signature and downstream rerank pipeline with S4.8 (within-anime precision matching); this story uses the `scope: {geo, radius}` variant, using a GPS radius rather than a series membership as the coarse-screen boundary.

**Design basis**: no visual mockup; inputs §11, the SD-26 row's "three reverse-discovery layers" + the flywheel operating manual (§11) "flywheel-3 UGC→catalog" section on the strategic role of check-in photos.

**Core AC**:
- Happy path: when a query image can't be directly recognized by layer 1 (LLM world knowledge) but the request carries GPS coordinates, layer 2 coarse-screens nearby candidate spots via `ST_DWithin`, then hands them to S4.8's vision-rerank pipeline to confirm the final match -> integration
- Empty: without GPS permission/coordinate data, gracefully degrades to a layer-1-only result (never pretends to have layer-2 candidates, never blocks the flow) -> unit
- **real2real fast-path unlock**: once a given spot's count of **human-reviewed/approved** check-in photos (flywheel-3 review gate, SD-23 — raw un-reviewed photos never count) crosses a preset threshold (**≥5 reviewed photos**; initial value, executor may tune with evidence), subsequent recognition requests for that spot are flagged eligible for the real2real fast path (distinct from the default anime2real cross-domain path); spots below the threshold keep using S4.8's default path. When the flywheel-3 review pipeline (DD-7) is not yet built, the unlock is dormant — the test asserts that with zero reviewed photos no spot is ever flagged eligible -> integration
- **Low-confidence routing**: same as S4.8 — when layer 2's rerank confidence falls below the threshold, it doesn't force an anime-identity assertion; it routes to `clarify` to ask the user for more detail (e.g. a more precise location description), reusing S4.8's exact low-confidence handling path -> integration
- Telemetry completeness (echoing iteration 1's full-signal telemetry checklist — the SD-26 five-piece set under the now-complete layer 2): the five fields `query_type`/`gps_available`/`layer_hit` (should be recordable as 2)/`candidates_shown`/`user_confirmed` are all correctly recorded on a layer-2 hit, for DD-11's (layer-3 trigger decision) future re-check -> unit

**Changed files**: `apps/agent/agent/agents/tools/search_nearby.py` (coarse-screen key switched to `ST_DWithin`), `apps/agent/agent/infrastructure/vision_search/real2realUnlock.py` (new, unlock-decision logic), `apps/agent/agent/infrastructure/telemetry/visionSearchEvents.py` (five-piece telemetry extension).

**Dependencies**: S4.8; iteration 1's `search_nearby` tool and the (already-defined) image-search five-piece telemetry set (this story completes its layer-2 recording path).

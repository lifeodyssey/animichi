# Iteration 2 — Handoff: Details + List

Detail level: **fully detailed**. Story count: **10** (exceeds the "3-8" guideline; originally 8 product stories + the S2.9 sessions-migration story added by SD-3④, plus S2.10 (Railway topology estimation, backfilled from SD-28 layer 2) added in this patch round — see main spec §3).

Suggested dependency order: S2.8 (`workers/users`' initial build-out, recommended first) → S2.1 → {S2.2, S2.3} → {S2.4, S2.5, S2.6} → S2.7. S2.9 (sessions migration) can run in parallel with the product stories, scheduled by the Coordinator based on staffing. S2.10 (railway topology estimation) is a self-contained backend data pipeline that nothing else in this iteration depends on for its own completion, and can be developed independently in parallel with everything else.

**Impact of the SD-interview final conclusions on this iteration (see main spec §2)**:
- **SD-2 (final, not under discussion)**: the access path for user-domain data (saved/listed routes) is **API-first** — a newly built `workers/users` TS service exposing oRPC routes at `/v1/users/*`, with data landing in **Neon**, and contracts placed in `packages/contract`; `apps/web`'s `supabase-js` is used **only** for auth (to obtain the JWT) and does **not** query any data table directly, nor does it rely on RLS. The earlier rev 1-4 draft's provisional framing of "currently written against a tentative direct-RLS design" is now void — this file has been written against the SD-2 final decision from the outset.
- **SD-3②④**: new user-domain tables are created in Neon (not Supabase); migrating the data in the existing `sessions` table to Neon is an independent story in this iteration (S2.9).
- **`workers/users` is a brand-new service**, with no existing skeleton to lean on the way `workers/catalog` has one — S2.8 needs to fully mirror `workers/catalog`'s oRPC + Drizzle + CI + deployment pattern rather than invent a new one (see the risk register in main spec §9).
- **SEO/GEO content-attribution verification (backfilled from SD-27, `2026-07-06-seo-geo-plan.md` §7 iteration-mapping table) — ruling now final (C3; see backfill-conflicts.md)**: that landing package's "iteration mapping" table once placed "anime-page TVSeries/Movie JSON-LD + fact-summary block v1 + ImageObject/license + hreflang bootstrap" under the "2 Details + List" row. But the pages this iteration actually ships are `/routes/:id` (route detail) and `/routes` (My Route list) — both are user-private pages, outside SD-27 A's page matrix (not server-rendered, not in the sitemap, hreflang carries no meaning for them); the `/anime/:id` anime page doesn't get built until iteration 5. On this basis, the row's attribution was judged very likely to be a typo (it should map to "5 Discovery + Homepage," where `/anime/:id` actually ships and where SD-27 explicitly states the programmatic-SEO main battlefield lives). **Resolution (C3 ruling = adopted, user sign-off 2026-07-06)**: the corresponding SEO story content has been moved into `iter-5.md` (S5.1/S5.6); this file adds no SEO story of its own. The typo in the `seo-geo-plan.md` §7 mapping table has been corrected (the iteration-2 row now reads "private pages, no SEO surface").

---

### S2.1 Route detail shell + data-illuminated states

**User story**: As a user viewing my own route detail page at different points in time, I want the same page to light up different elements depending on the data (today = gold bar, completed = badge), instead of switching between three separate modes — so it reads like a living document, not three patched-together screens.

**Design basis**: `spec-route-detail.md` §1 "Concept (overturning the three-state model)"; `路线详情 状态总览.html`.

**Releasable statement**: `/routes/:id` renders appbar → hero → map card → timetable → sticky dock; the weekday state keeps chrome to a minimum, the today state shows a gold bar under the appbar reading 「きょうは巡礼日!→歩くモードへ」("Today's a pilgrimage day! → to Walk Mode") and auto-expands the map, and the completed state shows a 完走 (pilgrimage-completed) hero badge (完走 5/5 ✓) plus a full-row ✓ and an auto-appearing 対比図 (comparison composite) section.

**AC**:
- Happy path: a route dated for today renders a gold bar under the appbar, and the map auto-expands -> browser
- Happy path: a fully completed route renders the 完走 hero badge, with every timetable row showing ✓ -> browser
- Empty: the weekday state (neither today nor completed, with some historical check-ins) shows no gold bar, while still preserving partial historical ✓ marks (a living document doesn't rewrite history) -> browser
- Error: the priority rule (completed > today > weekday) is correctly applied when a route is "both today and completed" (shows the completed state, not two banners at once) -> unit
- i18n: the gold-bar copy and the completed-badge copy render correctly in ja/zh/en -> unit
- Generative-component contract (backfilled from SD-13): `GoldBar` is a product-specific generative component (see inputs §3 A4 catalog); if reused by the Chat generative-UI registry, its payload must carry a `schema_version` field (additive-only evolution, no breaking changes) and the component itself must be partial-tolerant (rendering the established skeleton slot when fields are missing, never crashing); Storybook needs a "missing-field state" story and a "legacy payload state" story -> unit

**Changed files**: `apps/web/src/routes/routes/$routeId.tsx`, `apps/web/src/components/route-detail/Hero.tsx`, `apps/web/src/components/route-detail/GoldBar.tsx`, `apps/web/src/lib/route-detail/dataState.ts`.

**Dependencies**: S1.5 (route data shape); S2.8's oRPC contract (can be developed in parallel, aligned at integration time).

---

### S2.2 MODE toggle (FLIP) + map-pin language + gold route pill

**User story**: As a user, I want to be able to switch at any time between a compact "idle" view and an expanded-map view, with pins clearly marking visited/current/unvisited status, so I can both skim quickly and navigate in depth.

**Design basis**: `spec-route-detail.md` §2 MODE, §5 Map (pin-is-the-picture).

**Releasable statement**: tapping/dragging switches between idle ⇄ map-expanded with a 360ms FLIP transition; map pins render as 48px framed pin-photos (済 ["done"] teal badge / 現在 ["current"] 58px gold ring ★ / a plain white numbered marker for not-yet-visited); a gold route pill shows progress N/5.

**AC**:
- Happy path: switching to map-expanded fills the map within 360ms and the timetable collapses into a 352px sheet -> browser
- Happy path: pin states render the specified visual language correctly for visited/current/unvisited -> browser
- Empty: a route with no check-ins yet shows every pin as a plain white numbered "not-yet-visited" marker, and zero progress doesn't break -> browser
- Error: rapid repeated toggling (double-tap) doesn't produce a half-transitioned broken state (debounce/guard) -> browser
- Multi-turn: after a check-in event fires, the MODE state (expanded/idle) is correctly preserved, not unexpectedly reset -> integration
- Generative-component contract (backfilled from SD-13): `MapCard` is a product-specific generative component (see inputs §3 A4 catalog); if reused by the Chat generative-UI registry, its payload must carry `schema_version` (additive-only evolution) and the component must be partial-tolerant (rendering a skeleton slot rather than crashing when spot/pin data fields are missing); Storybook needs a "missing-field state" story and a "legacy payload state" story -> unit

**Changed files**: `apps/web/src/components/route-detail/MapCard.tsx`, `apps/web/src/components/route-detail/ModeToggle.tsx`, `apps/web/src/components/map/RoutePinLayer.tsx`.

**Dependencies**: S0.4, S2.1.

---

### S2.3 Gold CTA logic + sticky dock + Walk entry point #2

**User story**: As a user, I want the page's single gold CTA to always say the right thing for the moment (share on a weekday / go walk today / make a keepsake しおり after completing) — and I want this to be an actually-working 「歩くモードで出発」("Depart in Walk Mode") entry point (one of the three entry points Q4 requires).

**Design basis**: `spec-route-detail.md` §3 Gold CTA.

**Releasable statement**: the gold CTA's copy/action switches with the data state (weekday = share the しおり / today = go to Walk Mode / completed = make a commemorative しおり); the cream secondary CTA (編集する, "edit") jumps to the Chat A2b reference-edit flow; the sticky dock's gradient handoff is correct.

**AC**:
- Happy path: for a route dated today, the gold CTA reads "歩くモードへ" ("to Walk Mode"), and clicking it navigates to the Walk target route (this iteration only verifies navigation intent / that the route target exists — the real Walk screens ship in Iteration 3, so a placeholder here is acceptable) -> browser
- Happy path: for a completed route, the gold CTA reads "記念しおりを作る" ("make a commemorative しおり") (deep-linking to the しおり flow's entry point from Iteration 4 — a placeholder here is acceptable) -> browser
- Empty: the cream secondary CTA (編集する) gracefully disables when the route has no chat origin to reference back to -> unit
- Error: if the data state changes mid-press (e.g. a check-in happens to complete the route right then), the CTA never gets stuck showing stale/incorrect copy -> browser
- i18n: all three CTA copy variants render in ja/zh/en -> unit

**Changed files**: `apps/web/src/components/route-detail/StickyDock.tsx`, `apps/web/src/components/route-detail/GoldCta.tsx`.

**Dependencies**: S2.1.

---

### S2.4 At-scale states (accordion/multi-day/shot-angle (機位) sheet) + spec-route-detail default confirmations

**User story**: As a user with a route that has many stops (≥7), spans multiple days, or has several candidate photos for some stop, I want the timetable to auto-organize (an accordion by time-of-day / segmented by day / a shot-angle sheet) instead of turning into an unreadable wall of text.

**Design basis**: `spec-route-detail.md` §7 At-scale states (G4); main spec §8.1's two default decisions (segment-header total-walking-time = shown; ★-target linking to Walk = not wired this iteration).

**Releasable statement**: a single-day route with ≥7 stops collapses into a time-of-day (morning/afternoon/evening) accordion, with each segment header showing "stop count + total walking time + time span"; a multi-day route is segmented by day (past collapsed with ✓ / today expanded with the gold bar / future collapsed at 75% opacity); a row with more than one candidate photo for its stop shows "N shots ▸" opening a shot-angle browser sheet.

**AC**:
- Happy path: a 9-stop single-day route renders a morning/afternoon/evening accordion, each segment header showing stop count + total walking time + span -> browser
- Happy path: a multi-day route only expands today's segment (with the gold bar); past/future segments correctly stay collapsed -> browser
- Empty: a route with exactly 1 stop skips the accordion/day-segmentation entirely (no empty accordion shell rendered) -> unit
- Error: a stop with 0 candidate photos never renders a broken "N shots ▸" entry point (shows only the plain representative frame) -> browser
- **Default confirmation (§8.1)**: segment headers show total walking time; the ★ target does not link to Walk (the detail page's ★ only takes effect within the page itself) -> unit

**Changed files**: `apps/web/src/components/route-detail/TimeOfDayAccordion.tsx`, `apps/web/src/components/route-detail/DaySegments.tsx`, `apps/web/src/components/route-detail/SpotPhotoSheet.tsx`.

**Dependencies**: S2.1, S2.2.

---

### S2.5 Desktop R-DESK layout + clipboard/share adapter (X10)

**User story**: As a user planning on a large desktop screen, I want a three-column layout (hero+timetable / large map / QR+highlights rail), and I want the QR/copy-link handoff for cross-device continuation to go through the platform adapter layer.

**Design basis**: `spec-route-detail.md` §6 Desktop R-DESK 1440.

**Releasable statement**: at ≥1440px viewport, a three-column R-DESK layout renders (430 hero + thumbnail timetable | central large map | 270 rail with QR handoff + 3 名場面 [famous scenes] + N→shot-angle browser + CC BY-NC-SA attribution); QR/copy-link handoff goes through the platform clipboard adapter.

**AC**:
- Happy path: at ≥1440px viewport, a correctly-proportioned three-column grid renders, with the QR code linking to the mobile route URL -> browser
- Happy path: clicking "リンクをコピー" ("copy link") copies the route URL via `platform.clipboard.copy()`, not a direct call to `navigator.clipboard` -> unit
- Empty: below 1440px, falls back to the mobile single-column layout, without producing a broken half-rendered three-column state -> browser
- Error: a clipboard-write failure (permission denied) shows a "press and hold to copy" fallback prompt, not silent unresponsiveness -> browser
- Via the adapter layer (X10): a unit test asserts the component's copy logic only ever calls `platform.clipboard.copy()`, with no code path that directly `import`s or calls `navigator.clipboard` (the same underlying behavior as the happy-path AC above, but this AC asserts it from the "code structure" angle rather than the "observed behavior" angle) -> unit

**Changed files**: `apps/web/src/components/route-detail/RDeskLayout.tsx`, `apps/web/src/platform/clipboard.ts`, `apps/web/src/components/route-detail/QrHandoff.tsx`.

**Dependencies**: S2.1, S2.2.

---

### S2.6 Commemorative 対比図 section entry point

**User story**: As a user, I want to see a "commemorative 対比図" section on the route detail page — either showing the comparison composites I've already generated, or a clear 「+対比図を作る」("+ make a 対比図") entry point deep-linking into the 対比図-creation flow.

**Design basis**: `spec-route-detail.md` §8 Commemorative 対比図 section.

**Releasable statement**: an empty 対比図 section shows a dashed 「+対比図を作る」card, deep-linking with the correct parameters (`?url=frame-h360&pid&bid&g`) into the Iteration 4 対比図-creation flow (that flow itself ships in Iteration 4 — this iteration only wires up the entry point and the empty-state rendering).

**AC**:
- Happy path: a route with generated comparison composites renders the pair grid (anime frame × real photo) -> browser
- Empty: a route with 0 comparison composites renders the dashed 「+対比図を作る」placeholder card, with correct deep-link parameters -> browser
- Error: since the deep-link target doesn't exist yet this iteration (対比図 creation ships in Iteration 4), clicking it must not 404 — it should lead to a graceful "coming soon" placeholder rather than a broken navigation -> browser
- i18n: the section header "対比図 N/5・shot-angle browser↗" renders correctly per locale -> unit

**Changed files**: `apps/web/src/components/route-detail/ComparisonSection.tsx`.

**Dependencies**: S2.1.

---

### S2.7 マイルート (My Route) bookshelf (variant A) + desktop MY-DESK

**User story**: As a user with multiple planned/past routes, I want a bookshelf-style list (with one hard rule: only one route can ever be "today's gold pick"), including an empty state for when I have zero routes.

**Design basis**: `マイルート 状态总览.html` (variant A, bookshelf, finalized; variant B, planner-table, archived), `マイルート demo.html`.

**Releasable statement**: `/routes` lists the user's saved routes as bookshelf cards; if there is a route for today, exactly one of them shows the gold-framed 「きょう」("today") treatment (structurally enforced, not just a visual coincidence); zero routes shows the specified empty state; desktop shows the MY-DESK layout variant.

**AC**:
- Happy path: a user with 3 saved routes (one for today) sees that one gold-framed, the rest as plain cards -> browser
- Empty: a user with zero saved routes sees the specified empty state (not a blank list) -> browser
- Error: if bad data causes two routes to both be flagged "today," the UI enforces the "gold pick is unique" rule (gold-frames only the most-recently-updated one, treats the other as a plain card — never renders two gold cards) -> unit
- i18n: empty-state copy and card labels render in ja/zh/en -> unit
- Multi-turn: after a route's `status` transitions to `completed` (the `routes` table state defined in S2.8) and the user returns to `/routes`, that card's completed status reflects correctly without a manual refresh -> integration
- Generative-component contract (backfilled from SD-13): `BookshelfCard` is a product-specific generative component (see inputs §3 A4 catalog); if reused by the Chat generative-UI registry, its payload must carry `schema_version` (additive-only evolution) and the component must be partial-tolerant (rendering a skeleton slot when fields are missing); Storybook needs a "missing-field state" story and a "legacy payload state" story -> unit

**Changed files**: `apps/web/src/routes/routes/index.tsx`, `apps/web/src/components/my-routes/BookshelfCard.tsx`, `apps/web/src/components/my-routes/EmptyState.tsx`, `apps/web/src/components/my-routes/MyDeskLayout.tsx`.

**Dependencies**: S2.8 (data source).

---

### S2.8 `workers/users` service build-out + route save/list oRPC enabler (SD-2 final)

**User story**: As a user, I want to be able to save a route from chat and then see it in マイルート afterward, and I want the results of my anonymous actions to automatically attach to my account once I log in.

**Design basis**: no visual mockup; `user-journey.md`: "anonymous-state routes are held against the anonymous session and reattached to the account after login."

**Backend enabler (SD-2/SD-3② final decision, not provisional)**:
- Build a new TS service `workers/users` (fully mirroring `workers/catalog`'s existing pattern: Hono + oRPC + Drizzle — do not invent a new pattern).
- On the Neon side, create the table via the SD-1 tool chain (Drizzle schema → atlas-provider-drizzle → `atlas migrate`): a `routes` table moves into Neon (with `user_id`, `title`, `status TEXT CHECK (status IN ('draft','saved','completed'))`, `saved_at`, `updated_at`).
- oRPC routes at `/v1/users/routes` (list/save/delete), with the contract going into `packages/contract` (a new file, e.g. `src/users-contract.ts`).
- Auth: requests carry the Supabase-issued JWT as a bearer token; `workers/users` validates it and takes `sub` to resolve the Neon-side `user_id`; `apps/web`'s `supabase-js` is used only to obtain this JWT (`getSession()`) — it does not query any data table.
- Anonymous route claiming: after login, `apps/web` calls `/v1/users/routes/claim` (or an equivalent endpoint), and the server reassigns the `user_id` of routes tied to the anonymous session to the logged-in user.
- The root Worker (`worker/app.ts`) needs a new forwarding rule for `/v1/users/*` (mirroring the existing pattern that forwards `/v1/*` to CONTAINER, but forwarding instead to the new `workers/users` service binding).
- CI/deploy: `.github/workflows/ci.yml` gets a new `ci-users` job (reusing `_ts-ci.yml`, `component: users`); `deploy.yml` gets a new deployment step (in the same order as `workers/catalog`, ahead of the root Worker).
- **Does not use** Supabase RLS as the access path (SD-2 explicitly overturns the earlier rev 1-4 draft's provisional approach); **no** data endpoints are added to `apps/agent`.

**AC**:
- Happy path: saving a route from chat (triggered per S1.7) creates/updates a record via `/v1/users/routes`, and it is then visible in the マイルート list -> integration
- Empty: for a brand-new user with zero saved routes, the `/v1/users/routes` list query returns an empty array without erroring -> unit
- Error: a request carrying another user's JWT that tries to read/write a route it doesn't own is rejected (403) by `workers/users` — not implicitly denied at the Neon layer -> integration
- Claiming: routes from an anonymous session are immediately attached to the account right after magic-link login completes, via the claim endpoint, with no need for the user to redo any selection -> integration
- **Auth boundary**: any request to `/v1/users/*` without a valid JWT gets a flat 401 — anonymous reads/writes of user data are never allowed (this is a different trust model from Chat's anonymous access, and the two must not be conflated) -> unit
- **CI/deploy wiring**: the `ci-users` job runs and passes on changes under `workers/users/**`; `deploy.yml`'s new deployment step runs in the correct order (before the root Worker) -> integration

**Changed files**: `workers/users/**` (new service: `src/index.ts`, `src/router.ts`, `src/db/schema.ts`, `src/api/routes.ts`), `packages/contract/src/users-contract.ts` (new), `worker/app.ts` (`/v1/users/*` forwarding rule + service binding), `wrangler.toml` (new `[[services]]` USERS binding), `.github/workflows/ci.yml` (`ci-users` job), `.github/workflows/deploy.yml` (deployment step), `apps/web/src/lib/data/routes.ts` (oRPC client wrapper), `apps/web/src/lib/data/claimAnonymousRoutes.ts`.

**Dependencies**: S1.7 (the moment that triggers a save); S0.9's `docs/ops/migrations.md` (reference for the SD-1 tool chain).

---

### S2.9 Sessions data migration, Supabase → Neon (SD-3④)

**User story**: As an operator, I want the existing `sessions` table's data migrated from Supabase to Neon, so it stays aligned with SD-3's "data plane moves to Neon" direction and old/new data no longer stays split across two databases.

**Design basis**: no visual mockup; SD-3④ (near-zero prod data volume, a one-off script, not a zero-downtime dual-write).

**Backend enabler**: a one-off migration script reads the full set of rows from Supabase's `sessions` table, creates the corresponding table structure in Neon via the SD-1 tool chain, writes the rows, and reconciles row counts; once migration completes, the Supabase-side `sessions` table is marked frozen (no further writes, the same treatment as SD-3③); `apps/agent`'s session read/write path switches over to Neon. **Per the C1 ruling (2026-07-06 user decision), this same one-off script also migrates any existing rows in the legacy `routes` table** (prod volume is near-zero for this table too, per SD-3④'s premise) — this is folded into this migration script's scope rather than opened as a separate story, since S2.8 has already created the `routes` table's new home in Neon and a second migration vehicle is unnecessary.

**AC**:
- Happy path: after the migration script runs, the Neon-side `sessions` table's row count matches the Supabase source table's row count (a full reconciliation, not a sample) -> integration
- Empty: when the Supabase `sessions` table is empty (a brand-new environment), the migration script runs cleanly with no rows and does not error -> unit
- Error: when the migration script encounters a historical row with a format mismatch (e.g. a corrupted `state` JSONB field), it logs that row to a failure list and keeps processing the rest, rather than aborting the whole script -> unit
- Data integrity: after migration, a deterministic sample of rows (every Nth row by primary key, with N sized to yield ≥50 rows, or all rows if the table has fewer than 50) gets a field-level content comparison (not just a row count) to confirm the `state`/`metadata` JSONB content wasn't corrupted -> integration
- **Legacy `routes` migration (per C1 ruling)**: any existing rows in the legacy Supabase `routes` table are migrated into the Neon `routes` table (created by S2.8) within this same script run, with row counts reconciled the same way as the `sessions` migration -> integration

**Changed files**: `scripts/migrate-sessions-to-neon.ts` (new; extended to also cover the legacy `routes` table's rows per the C1 ruling), `apps/agent/agent/infrastructure/` (session read/write path switched to the Neon client), `supabase/migrations/` (freeze annotation).

**Dependencies**: S2.8 (`workers/users`/Neon tooling already built).

---

### S2.10 Railway topology estimation (SD-28 layer 2)

**User story**: As a user planning or viewing a route, when two pilgrimage-spot stops require a railway transfer between them, I want to see a "good-enough" transfer estimate (line names + approximate duration + transfer count) instead of being left with only a straight-line distance in the timetable — and I don't want this estimate gated on waiting for a minute-accurate live timetable to ship.

**Design basis**: no visual mockup; inputs §10, SD-28 row (the route-planning layered plan, final version).

**Transit/walk switch threshold (initial value; executor may tune with evidence)**: a leg becomes a transit leg (rather than a walking leg) when the estimated walking time between the two stops is **> 25 min** OR the straight-line distance is **> 1.5 km**; otherwise it stays a walking leg.

**Releasable statement**: when adjacent stops in the route-detail timetable cross the transit/walk switch threshold above (far enough apart to require a railway transfer), a `TransitLeg` (`mode: "transit"`) summary line auto-renders reading "A駅→B駅:X線→Y線,約N分・乗換M回" ("Station A → Station B: Line X → Line Y, approx. N min, M transfers"); all of this data comes from the self-built topology graph this story computes offline — it never depends on a third-party API call at runtime. Minute-accurate timetables are reached via a Jorudan (primary) / Google Maps deep link out to the user's own trip-planning tool of choice.

**Backend enabler (SD-28 layer-2 final decision)**:
- **Data ETL**: ① the five ekidata.jp tables (`company`/`line`/`station`/`join`/`station_g_cd`; terms have been checked and are clear — commercial use, processing, and displaying derived results are all explicitly allowed, only "redistribution without processing" is restricted, and **there is no attribution obligation**; the free tier has no shinkansen station data); ② 国土数値情報 (National Land Numerical Information) N02, Reiwa-7 fiscal-year edition (baseline date 2025-12-31, published 2026-04) = line LineString geometry (for drawing lines on the map) + shinkansen subgraph completion + official geographic validation; **CC BY 4.0 mandates attribution** (unlike ekidata, this source must be credited — a footer attribution line + a processing statement).
- **Graph construction**: nodes = stations; edge A = same-line physical adjacency from the `join` table (weight = inter-station time = distance ÷ a per-category speed table, with separate default speeds for shinkansen / JR conventional lines / private railways / subway / tram); edge B = transfer edges linking stations sharing the same `station_g_cd` (a 5-point penalty + expected wait time); Dijkstra's algorithm computes shortest paths over the resulting graph.
- **Output**: the route planner's leg model gets a new `TransitLeg` type (`mode: "transit"`), rendered with the copy template "A駅→B駅:X線→Y線,約N分・乗換M回".
- **Precise timing**: not computed within this graph — handled via a Jorudan (primary target) / Google Maps deep link, handing the moment-of-travel use case off to the user's own trip-planning tool (layer-3 timetable-accurate transfers are tracked under DD-21, currently frozen).
- The ETL's output is a static data asset (the topology graph is only a few MB), produced offline and shipped with the build or committed to the repo — no Neon table is required for this, and there is no runtime dependency on any external API.

**AC**:
- Happy path: given any two pilgrimage-spot coordinates, the topology graph resolves each to its nearest station, and the resulting `TransitLeg` renders a summary with line name(s) + duration + transfer count -> browser
- Coverage (hard AC): the nearest-station coverage rate across every spot in the full catalog is **≥99%** (i.e. the ETL's station dataset is dense enough to resolve a nearest station for almost every spot, not leaving a large share unresolved) -> unit
- Accuracy (hard AC, eval-first): across a frozen fixture of **20 named popular-anime routes** — the route list plus Jorudan reference values captured once and dated in the fixture-file header, with a documented manual-refresh protocol in that header (the comparison figures are not re-fetched live at test time) — the estimated duration compared against Jorudan's captured real-world figures has a P80 error **≤ ±10 minutes** -> eval
- Attribution (hard AC): any rendered map railway line drawn from N02 data correctly shows a footer attribution line + processing statement (the CC BY 4.0 mandatory-attribution clause, handled distinctly from ekidata's no-attribution-required clause — this must never be dropped) -> browser
- Telemetry: the `transit_leg_shown` / `deeplink_clicked` events fire correctly when a transfer summary renders and when a user clicks the deep link, respectively (feeding DD-21's future re-check of the "do users actually want precise timing" signal) -> integration
- Empty: when two stops fall below the transit/walk switch threshold (estimated walking time ≤ 25 min AND straight-line distance ≤ 1.5 km — close enough that walking is preferable), no `TransitLeg` renders — the existing walking-leg display is preserved -> unit
- Error: when a requested coordinate falls outside the topology graph's coverage (too far from any known station), it gracefully degrades to showing no transfer summary, rather than rendering bad data or crashing -> unit

**Changed files**: `scripts/build-station-topology.py` (new, ekidata.jp + N02 ETL pipeline), `apps/agent/agent/infrastructure/transit/topologyGraph.py` (new, graph construction + Dijkstra), `apps/agent/agent/infrastructure/transit/stationIndex.py` (new, spot → nearest-station index), `apps/agent/agent/agents/route_optimizer.py` (extended, adds the `TransitLeg` output type), `apps/agent/agent/tests/eval/transit_estimate_accuracy.py` (new, 20-route comparison against Jorudan), `apps/web/src/components/route-detail/TransitLegRow.tsx` (new, renders the summary + deep-link button + N02 attribution footer).

**Dependencies**: none (a self-contained backend data pipeline that can be built ahead of the rest of this iteration's stories); its output is consumed by S2.1/S2.4's timetable rendering (a consumption relationship, not a blocking dependency — the timetable keeps rendering plain walking legs until the topology data is ready).

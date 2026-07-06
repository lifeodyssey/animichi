# Iteration 3 — Walk (歩く)

Detail level: **pre-kickoff refinement** (story list + 3-5 core ACs + enablers + design references; full-template detail is left for the Coordinator to fill in before scheduling this iteration). Story count: **10** (originally 8 product stories + S3.9 `conversation_messages` data migration, added per SD-3④, see main spec §③ + S3.10 OSRM walking-route polylines, added in this patch round, backfilled from SD-28 layer 1).

Suggested dependency order: S3.7 (check-in table, can start independently) → S3.1 → S3.2 → {S3.3, S3.4} → S3.6 → S3.5 (S3.5's offline variant depends on S3.6's cache; no cycle) → S3.10 (extends S3.6's offline bundle with route polylines) → S3.8 (asset production can run in parallel throughout). S3.9 can run in parallel with the product stories.

**Data access path (confirmed, SD-2 / main spec §②)**: S3.7 is a user-domain data enabler via `workers/users` oRPC (`/v1/users/*`) + Neon; `apps/web`'s `supabase-js` is used only for auth — this is the final architecture, with no remaining "might get overturned" uncertainty.

**GPS precision truncation (P9, backfilled from SD-21, confirmed)**: P9 was marked "proposal pending discussion" in main spec §②; it has since been finalized by SD-21 (2026-07-06, user-confirmed) — the observability layer (Logfire traces) truncates coordinates to roughly hundred-meter precision (3 decimal places), the storage layer (the check-in record itself) keeps full precision, and the scrub logic shares the same implementation point as X3 (BYOK key scrub). The corresponding item in S3.3 moves from "unconfirmed" to a hard AC, and **must be in effect before Walk ships** (it cannot land as a post-Walk patch).

---

### S3.1 Graduation transition (F0-F5)

**Scope**: Implement the full transition storyboard for the jump from the route detail page / chat into Walk Mode (a scene-cut moment for "clearly going somewhere").

**Design basis**: `Graduation 转场 - Storyboard.html` (F0 night-before → F1 prep 0-120ms → F2 main move 120-480ms → F3 landing 480-650ms → F4 complete 650-850ms → F5 boundary rules); already adopted in main spec §8.4.

**Core ACs**:
- Triggering the transition from the route detail page's "歩くモードへ" CTA plays it for the documented duration (~850ms total) and lands in Walk Mode -> browser
- With `prefers-reduced-motion` enabled, shows the instant-cut specified by the F5 boundary rules instead of forcing the full animation -> browser
- Interrupting the transition mid-flight (e.g., back button) doesn't leave a stuck overlay behind -> browser
- The transition doesn't introduce any CLS regression that Lighthouse can detect -> browser

**Changed files**: `apps/web/src/components/transitions/GraduationTransition.tsx`, `apps/web/src/routes/routes/$routeId/walk.tsx` (entry-point wiring).

**Dependencies**: S2.3 (Walk entry point #2 already placeholdered), S1.5 (route card's reserved Walk entry-point slot #1).

---

### S3.2 Walk Mode core shell

**Scope**: Build the Walk Mode main-screen skeleton — progress dots, a pinned enlarged card for the current stop (walk-hero, large-type stop name + current index "3/7"), and the next-stop row.

**Design basis**: `Walk 状态总览.html` (final W-B′ full-bleed direction); `Walk demo.html`.

**Core ACs**:
- Opening Walk Mode for a route shows progress dots reflecting the current check-in count, plus the current stop's walk-hero card -> browser
- A route with zero check-ins correctly shows stop 1 as the hero with all progress dots empty -> browser
- When the current-index stop's data is missing/corrupted, degrades to a "情報を読み込めませんでした" card instead of crashing the whole screen -> browser
- i18n: "いまここ N/M" and the next-stop copy render correctly across ja/zh/en -> unit

**Changed files**: `apps/web/src/routes/routes/$routeId/walk.tsx`, `apps/web/src/components/walk/ProgressDots.tsx`, `apps/web/src/components/walk/WalkHero.tsx`, `apps/web/src/components/walk/NextStopRow.tsx`.

**Dependencies**: S3.1.

---

### S3.3 Walk actions (Maps deep link / check-in / nearby sheet) + platform adapter layer + GPS precision truncation (confirmed, backfilled from SD-21/P9)

**Scope**: The "🧭 Mapsで開く" deep link (J12), the "✓ ここに来た!" check-in (vibrate + undoable toast, J13), and the "📍 近くにあと N スポット" sheet (J11) — all routed through the X10 platform adapter layer (haptics/geo); observability-layer handling of precise GPS coordinates (P9, confirmed per SD-21).

**Design basis**: `user-journey.md` §6.5 (the four-item mapping table); `Walk demo.html` (real check-in vibrate + undo); SD-21 (confirmed, supersedes main spec's original "proposal unconfirmed" tag).

**Core ACs**:
- Tapping "ここに来た!" triggers `platform.haptics.vibrate()`, advances progress, and shows an undoable toast (a **5000ms** undo window; initial value, executor may tune with evidence) -> browser
- "Mapsで開く" opens the system map app via a coordinate deep link -> browser
- When a stop has no other anime points nearby, the sheet shows empty-state copy instead of a broken empty list -> browser
- Undo-window boundary (mocked clock): tapping undo just before the 5000ms window expires correctly reverts the check-in (progress -1, sync-queue entry removed); tapping just after expiry no longer reverts it (the check-in has committed) -> integration
- Via the adapter layer (X10): check-in vibration and the geolocation used for "近く" always go through `platform.haptics`/`platform.geo`, never calling `navigator.*` directly -> unit
- **Hard AC (confirmed, backfilled from SD-21/P9, must be in effect before Walk ships)**: precise GPS coordinates involved in check-in / the nearby sheet must never enter Logfire traces — observability-layer location data is truncated to roughly hundred-meter precision (3 decimal places) before being written to a trace; the **storage layer** (the check-in record itself, and the actual coordinates used for the "近く" computation) keeps full precision, unaffected; an integration test asserts that coordinate fields in Logfire-captured spans never exceed 3 decimal places of precision, while coordinates in database/API responses remain full precision -> integration

**Backend enabler**: reads/writes check-in data (see S3.7); P9's scrub logic shares the same implementation point as X3 (BYOK scrub).

**Changed files**: `apps/web/src/components/walk/CheckInButton.tsx`, `apps/web/src/components/walk/MapsDeepLink.tsx`, `apps/web/src/components/walk/NearbySheet.tsx`, `apps/web/src/platform/haptics.ts`, `apps/agent/agent/infrastructure/observability_scrub.py` (new or extended — GPS truncation logic; reuse it if it's the same module as S1.11's X3 scrub middleware).

**Dependencies**: S3.2, S3.7.

---

### S3.4 構図をくらべる (composition comparison)

**Scope**: The shot-comparison sub-view — a semi-transparent overlay of the anime frame plus an opacity slider against the real scene; when a scene frame is missing, reuses Iteration 1's D9 gradient-placeholder pattern.

**Design basis**: `user-journey.md` §6.5 J10; `Walk demo.html` (opacity slider).

**Data-pipeline linkage (backfilled from SD-26, task #7)**: The anime frames / shot-angle reference images this story uses share the same reference-image data pipeline as Iteration 4's image-search stage 2 (対比図 shot-angle matching) — the two don't build separate indexes; whichever lands first carries the pipeline infrastructure, and whichever lands second simply reuses it. If Iteration 4 stage 2's reference-image index isn't ready yet when this iteration is scheduled, this story starts out using the static frame assets from the current design export (no index dependency); once stage 2 ships, it automatically gets a fuller set of candidate frames without needing to rework this component's rendering logic.

**Core ACs**:
- Opening "構図をくらべる" from the walk-hero card shows an available opacity slider comparing against the anime frame -> browser
- A stop with no reference frame shows the D9 gradient + episode-number text fallback, not a blank overlay layer -> browser
- If camera permission is denied (for the live-camera variant, if used), degrades to static-comparison-only mode, not a dead screen -> browser
- Via the adapter layer (X10): camera access always goes through `platform.camera` -> unit

**Changed files**: `apps/web/src/components/walk/CompositionCompare.tsx`.

**Dependencies**: S3.2; the data pipeline is shared with Iteration 4's image-search stage 2 (not a hard blocking dependency — see the linkage note above).

---

### S3.5 Environment variants (bright-sunlight / night / offline; canvas labels 強光/夜間/離線)

**Scope**: Layer three environmental visual variants on top of S3.2's core shell — bright-sunlight (larger type / higher contrast / thick white borders), night, and offline. (The state names are English; 強光/夜間/離線 are the Chinese source labels quoted from the design canvas, not UI copy.) **Until live environmental sensing is designed, these three variants are driven by explicit user/test toggles** — there is no automatic ambient-light/network detection wired in this story. Auto-trigger from live sensing is a future item, out of scope here.

**Design basis**: `user-journey.md` §3.4's on-the-ground environmental constraints (J14); `Walk 状态总览.html`'s 3 environment states.

**Core ACs**:
- Toggling the bright-sunlight mode (explicit user/test toggle) bumps the walk-hero stop name's type size and contrast per spec -> browser
- Toggling night mode applies the specified color changes without violating the ≥4.5:1 contrast requirement -> browser
- With no mode toggled on, renders the standard daytime variant (the default state) -> browser
- Toggling the offline environment state still renders the full shell from cached data (integrates with S3.6), not a network-error screen -> browser

**Changed files**: `apps/web/src/components/walk/EnvironmentVariants.tsx`, `apps/web/src/styles/walk-environment.css`.

**Dependencies**: S3.2, S3.6.

---

### S3.6 Offline in one shot (SW + cache + check-in queue)

**Scope**: Register a service worker that caches the route bundle (JSON + frame images + per-stop static map PNGs, reusing X1's pmtiles range-request infrastructure); an offline check-in queue (IndexedDB) that flushes on reconnect via online/visibilitychange; forward-declared SW routing rules that exclude the future SSR routes.

**Design basis**: `user-journey.md` §3.4's "weak network / offline" constraints; the G6 "in one shot" ruling; X1 (pmtiles range reuse), X7 (SW network-first forward-declared rules).

**Core ACs**:
- After the route bundle is pre-cached, opening Walk Mode in airplane mode still renders the full shell and all stop data -> browser
- Offline check-ins queue locally and flush via a real network call (to `workers/users`'s oRPC endpoint) once connectivity returns -> integration
- A route segment that was never pre-cached (never visited online) shows a clear "この区間はオフラインで見られません" notice, not a broken shell -> browser
- Flush conflicts (the same check-in already synced from another device) resolve via an idempotent upsert key, producing no duplicate rows -> integration
- **X7 forward-declared rule**: the SW's route-matching rule table already includes `/s/:id` and `/anime/:id` (even though these two routes aren't live yet), tagged network-first and excluded from the Walk offline cache scope; a unit test directly asserts the contents of the route-matching table -> unit

**Backend enabler**: reuses S3.7's check-in endpoint; adds a client-side IndexedDB schema (not a backend resource).

**Changed files**: `apps/web/src/sw.ts`, `apps/web/src/lib/walk/routeBundleCache.ts`, `apps/web/src/lib/walk/offlineCheckinQueue.ts`.

**Dependencies**: S3.2, S3.3, S0.4 (pmtiles range reuse).

---

### S3.7 Check-in persistence backend enabler (`workers/users` oRPC + Neon, confirmed per SD-2)

**Scope**: Provide persistent storage and idempotent sync support for check-in records.

**Design basis**: No visual mockup.

**Data access path (confirmed, SD-2)**: User-domain data, accessed via `workers/users` oRPC (`/v1/users/*`) + Neon, not via a direct Supabase RLS connection.

**Backend enabler (confirmed)**: A new Neon table `walk_checkins` (built via the SD-1 toolchain: Drizzle schema → atlas-provider-drizzle → atlas migrate) — fields: `id`, `route_id` FK, `point_id` FK, `user_id`, `client_id UUID UNIQUE` (for offline idempotency), `checked_in_at TIMESTAMPTZ`, `synced_at TIMESTAMPTZ`; `workers/users` gets new oRPC routes (e.g. `users.checkins.upsert`/`users.checkins.list`), authenticated via JWT bearer; `apps/web` calls them through the oRPC client (`upsert` uses `client_id` as the idempotency key), with no new agent-side endpoints; `packages/contract` gets a new `WalkCheckin` zod contract (input/output schema, rather than the "table-row mirror" the RLS-era design once assumed).

**Core ACs**:
- After inserting a check-in via `workers/users`'s oRPC endpoint, a subsequent read sees it immediately -> integration
- Querying a route with zero check-ins returns an empty array, not null/a crash -> unit
- Resubmitting the same offline-queued check-in (same `client_id`) after it has already synced successfully is a safe no-op (upsert), producing no duplicate rows -> integration
- Auth boundary: requests to the check-in endpoint without a valid JWT are rejected outright — anonymous check-in writes are never allowed (a different trust model from Chat's anonymous access) -> unit

**Changed files**: `workers/users/src/db/schema.ts` (new `walk_checkins` table definition), `workers/users/src/api/checkins.ts` (new), `packages/contract/src/users-contract.ts` (new `WalkCheckin` contract), `apps/web/src/lib/data/checkins.ts` (oRPC client call wrapper).

**Dependencies**: S2.8 (the initial `workers/users` build-out, completed as part of Iteration 2's groundwork; this story adds a new set of endpoints on top of it, not rebuilding the service).

---

### S3.8 Fox 8-frame trot sprite asset (G8)

**Scope**: Generate an 8-frame (or 4-frame minimum-viable) trotting-loop sprite sheet per the locked spec (512×512/frame, transparent background, fixed ground baseline y=430, no baked-in shadow), and wire it into a CSS `steps()` animation for the Graduation/Splash loading scenes.

**Design basis**: `fox-walk-spec.md` (full document: 8-frame gait table + consistency lock + generation prompt template); the G8 ruling.

**Core ACs**:
- The generated sprite sheet follows the consistency-lock rules (orange fur / cream muzzle / teal-blue scarf, pure right-facing side view, fixed baseline), visually checked against `fox-trot.svg`'s proportions -> browser
- If only a 4-frame minimum-viable version can be produced, the `steps(4)` fallback still produces a readable trotting loop (not a stuttering one) -> browser
- If the sprite sheet fails to load (404), falls back to the existing single-frame `fox-trot.svg`, not a broken image -> browser
- **User sign-off required (G8 mandatory manual AC)**: generated assets are only considered done once the user has reviewed and signed off on them -> browser (manual verification)

**Changed files**: `docs/design/2026-07-06-design-sync/assets/fox/fox-walk-sheet.png` (or 8 separate PNGs), `apps/web/src/styles/fox-animation.css`, `apps/web/src/components/transitions/GraduationTransition.tsx` (wiring, reuses S3.1).

**Dependencies**: none (asset production can run in parallel); consumed by S3.1, S0.7.

---

### S3.9 `conversation_messages` data migration: Supabase → Neon (SD-3④)

**User story**: As an operator, I need the existing `conversation_messages` (and `sessions`) table data migrated from Supabase to Neon, to align with SD-3's "data plane belongs to Neon" direction.

**Design basis**: No visual mockup; SD-3④ (near-zero prod data volume, one-off script).

**Backend enabler**: A one-off migration script reads all rows from Supabase's `conversation_messages`, creates the corresponding table structure in Neon (via the SD-1 toolchain), writes the data, and verifies it; once migration completes, the Supabase-side table is marked frozen; `apps/agent`'s message read/write path switches to the Neon client.

**Core ACs**:
- Happy path: after the migration script runs, the Neon-side `conversation_messages` row count matches the Supabase source table's row count (full reconciliation) -> integration
- Empty: when the Supabase source table is empty (a brand-new environment), the migration script runs cleanly with no rows and doesn't error -> unit
- Error: historical rows with mismatched formats are logged to a failure list and processing continues for the rest, without aborting the whole run -> unit
- Data integrity: after migration, a deterministic sample of rows (every Nth row by primary key, with N sized to yield ≥50 rows, or all rows if the table has fewer than 50) gets field-level content comparison (not just row counts), confirming message content / `parts` structure isn't corrupted -> integration

**Changed files**: `scripts/migrate-conversation-messages-to-neon.ts` (new), `apps/agent/agent/infrastructure/` (message read/write path switches to the Neon client), `supabase/migrations/` (freeze annotation).

**Dependencies**: S2.9 (sessions migration — recommended to go first so the migration-script infrastructure can be shared); S2.8 (`workers/users`/Neon toolchain already built).

**Attribution check (backfilled from SD-3④, pending Coordinator ruling at the time this was written)**: SD-3④'s original text names three categories of existing data to migrate together — "sessions / messages / routes." Sessions (`sessions`) are already covered by Iteration 2's S2.9; messages (`conversation_messages`) are this story. But whether pre-migration "routes" history data exists in production (distinct from the route-save/list *feature* Iteration 2 builds fresh) had no corresponding explicit migration story visible in iter-2.md/iter-3.md at the time. `supabase/migrations/` does confirm pre-existing route-related tables (`20260402124000_operational_tables.sql`, etc.), so this migration item may have been a genuine gap rather than "nothing to migrate." This file does not overstep into modifying iter-2.md; it only records the open question here, for whichever Coordinator schedules that iteration to verify whether an S2.x/S3.x-level routes migration story needs to be added.

**Update (this patch round)**: this question is no longer open. Per the ✅ ruling in `docs/superpowers/specs/2026-07-06-backfill-conflicts.md` (C1 = option a), any pre-existing `routes` rows get folded into S2.9's migration script as one added line — no separate story is opened for it. Landing that line inside S2.9's script is iter-2.md's owner's responsibility; this file's content otherwise stands unchanged.

---

### S3.10 OSRM self-hosted walking-route polylines (backfilled from SD-28 layer 1)

**Scope**: Give Walk Mode real walking-path polyline rendering on the map, plus obstacle-detour detection (cases like two stops that are only ~100m apart in a straight line across a river but require an actual ~1km walk around it), with more precise walking-time estimates as a side benefit. Self-hosted OSRM (or Valhalla), fed by the OSM Geofabrik Japan extract (ODbL license).

**Re-review note (rationale for moving this out of Iteration 1, backfilled from SD-28's final version)**: This capability was originally scoped into Iteration 1, as part of `route_optimizer`'s walking-time estimate. On re-review it moves into this iteration instead. Rationale: on the time-precision axis, the haversine × 1.3 detour coefficient (Iteration 1's layer 0, already shipped) is already good enough for planning-stage estimates — the walking-time error it produces is already smaller than the error inherent in the dwell-time estimate itself. OSRM/Valhalla's real value isn't a more precise number; it's rendering a walking path that actually exists on the map, and catching geography-driven detours (the river/rail blockage case above) — a capability the planning stage (Iteration 1) never needed but the Walk on-the-ground navigation stage does. Shipping it in Iteration 1 would have been over-engineering. This story is scoped to degrade gracefully: if the self-hosted OSRM/Valhalla deployment isn't ready or reachable by ship time, Walk Mode keeps working on the haversine × 1.3 estimate alone (already shipped in Iteration 1) — so this story never blocks this iteration's releasability.

**Design basis**: No visual mockup; `user-journey.md` §6.5 J10/J12 (on-the-ground view / navigation deep link); SD-28 (final version, user-confirmed 2026-07-06).

**Core ACs**:
- Happy path: the walking path rendered on the Walk Mode map is a real street-following polyline returned by OSRM, not a straight line between two points -> browser
- River/rail blockage case (fixed fixture: two named stops on opposite banks of the Kamo river ~120m apart straight-line — coordinates frozen in the test fixture — with an expected OSRM on-foot detour in the **800–1400m** band; initial values, executor may tune with evidence) correctly renders the detour path instead of a line cutting through the obstacle; when OSRM is offline/unreachable this fixture falls back to a haversine × 1.3 straight-line estimate -> integration
- Offline (OSRM unreachable, or this segment's polyline was never cached) Walk Mode falls back to the haversine × 1.3 distance/time estimate instead of blocking core offline functionality (integrates with S3.6) -> unit
- Data source: the self-hosted OSRM (or Valhalla) instance runs on OSM Geofabrik Japan extract data (ODbL license), with no dependency on any pay-per-call third-party routing API -> integration (deployment-verification in nature)

**Backend enabler**: Self-hosted OSRM/Valhalla instance (infrastructure); exposes a walking-polyline query endpoint consumed by the route detail page and Walk Mode.

**Changed files**: `infra/` (OSRM/Valhalla self-hosted service definition; exact shape left to pre-kickoff refinement), `apps/agent/agent/agents/route_optimizer.py` (wires in the polyline query, supplementing/replacing the existing haversine estimate), `apps/web/src/components/walk/WalkRouteLine.tsx` (new, polyline rendering), `apps/web/src/lib/walk/routeBundleCache.ts` (extended — polyline data joins the same offline-cache bundle, integrates with S3.6).

**Dependencies**: S3.2 (Walk Mode core shell, the rendering host); S3.6 (offline cache — the polyline data rides the same route bundle, extending its cache format).

# Iteration 6 — Workbench (工作台) (Chat Phase 2 desktop two-column layout)

Detail level: **pre-kickoff refinement**. Story count: 6.

Suggested dependency order: S6.1 → S6.2 → {S6.3, S6.4} → S6.5 → S6.6.

**Architectural premise**: this iteration reuses the generative UI registry established in Iteration 1 (the components don't change — only their mount point moves from "in the stream" to "the right-hand column"); it doesn't redesign the components — see `generative-ui.md`'s "Phase 2 (after the loop closes)" and the two-phase staging decision in `spec-chat-page-design.md` §2.

**Generative UI constitution (backfilled from SD-13, confirmed)**: main spec §②'s original "proposal unconfirmed" tag has since been finalized by SD-13 (Step1, user-confirmed 2026-07-06 to "follow industry best practice"); its three rules apply equally to this iteration's new components — ① **append-only card stream** (never rewrites historical cards, carries forward design E1); ② **additive-only versioning**: component payloads carry `schema_version`, with lifecycle governance copied from MCP's deprecation policy (Active → Deprecated → Removed, ≥12-month deprecation window); ③ **partial-tolerant rendering**: components can be missing fields, falling back to a skeleton slot. `presentation_hint` is a server-side suggestion with the frontend having final say, and unknown values degrade gracefully to a generic card rather than erroring.

**Scope of applicability**: S6.5 (DraftEditMode) and S6.6 (AnchorDelegation) are registry components the agent may select for rendering via `presentation_hint`, so they must follow the versioning rules above from the moment they're created, and get Storybook stories for both the partial state and legacy-payload state (sharing the test infrastructure already built in Iteration 1 — see P10); the corresponding items have already been added to both stories' core ACs. S6.2 (persistent map), S6.3 (Lightbox), and S6.4 (group-sync) are pure client-side interaction components whose rendering version isn't determined by the agent payload, so they aren't bound by this constraint; confirming that distinction at the Reviewer-checklist level is enough — no extra story is needed.

---

### S6.1 Desktop two-column shell (F1-F4)

**Scope**: The left/right two-column skeleton for ≥1024px viewports — the right column's empty state (F1, quiet dashed frame), the right column's skeleton (F2), and reflow on resize (F4).

**Design basis**: `工作台 - 地图常驻方案.html`; `spec-chat-page-states.md` §F (F1-F4).

**Core ACs**:
- Happy path: at ≥1024px with no route yet, the right column shows the F1 quiet dashed-frame empty state while the left column works normally -> browser
- Happy path: the right column only shows the F2 skeleton (map band + card skeletons) while a visual tool (search / `plan_route`) is actually running; a plain-text turn never triggers it -> browser
- Empty: the F1 empty state shows no teaching overlay / hint bubble whatsoever (follows the "keep the UI quiet" principle) -> browser
- Error: resizing the window across the 1024px breakpoint mid-conversation (F4) correctly reflows the right-column components back into their original position in the message stream, without losing scroll position -> browser

**Changed files**: `apps/web/src/components/chat/workbench/WorkbenchLayout.tsx`, `apps/web/src/components/chat/workbench/EmptyPanel.tsx`.

**Dependencies**: S1.1-S1.5 (reuses Phase 1 components; the registry doesn't change).

---

### S6.2 Persistent right-column map + bidirectional hover anchoring (E3)

**Scope**: The right column continuously shows the map; bidirectional hover highlighting between left-column messages/stop rows and the right-column map pins.

**Design basis**: `工作台 - 地图常驻方案.html`; `spec-chat-page-states.md` §E3.

**Core ACs**:
- Happy path: hovering a left-column message/stop row makes the corresponding right-column pin bounce and highlight, and vice versa -> browser
- Empty: hovering a message with nothing to anchor to (e.g. a plain-text reply) produces no effect at all (no error, no ghost highlight) -> unit
- Error: rapidly hovering multiple rows in succession produces no highlight flicker / race condition (debounced) -> browser

**Changed files**: `apps/web/src/components/chat/workbench/PersistentMap.tsx`, `apps/web/src/lib/chat/workbench/anchoring.ts`.

**Dependencies**: S6.1, S0.4 (MapLibre).

---

### S6.3 Lightbox shot-angle browser (機位)

**Scope**: A full-screen lightbox browser for points with multiple photos — page through frames one at a time, with episode timestamps.

**Design basis**: `user-journey.md` §6.5 J10 (layered multi-photo disclosure); `工作台 - 地图常驻方案.html` (lightbox).

**Core ACs**:
- Happy path: opening a point with multiple candidate shots shows the full lightbox, paging through frames one at a time with episode timestamps -> browser
- Empty: a point with only 1 photo skips the multi-page lightbox chrome (shows the single image directly) -> browser
- Error: a 404 on a frame inside the lightbox degrades to the D9 gradient placeholder, rather than a broken image appearing mid-browse -> browser

**Changed files**: `apps/web/src/components/chat/workbench/SpotLightbox.tsx`.

**Dependencies**: S6.1.

---

### S6.4 エリア (area) / 話数 (episode) group sync

**Scope**: Keep the grouping key (エリア (area) ⇄ 話数 (episode)) synchronized between the left-side reference and the right-column cards.

**Design basis**: `user-journey.md` §6.9 (the desktop three-tier digestion pattern for "lots of content"); the established grouping rules in `spec-chat-page-states.md`.

**Core ACs**:
- Happy path: switching the GroupToggle (エリア/話数) on the left re-sorts the right-column cards into the same grouping key in sync -> browser
- Empty: when the data has only a single area/episode (nothing to group), shows one ungrouped section rather than an empty grouping shell -> unit
- Error: switching groups mid-scroll preserves the user's current reading position instead of jumping back to the top -> browser

**Changed files**: `apps/web/src/components/chat/workbench/GroupToggleSync.tsx`.

**Dependencies**: S6.1, S6.2.

---

### S6.5 SP8 large-scale draft-edit mode

**Scope**: Results with >100 points automatically flip into "draft edit" mode (agent preselects 8 items + a horizontally-scrolling 名場面 (iconic-scene) TOP strip + collapsed area group headers).

**Design basis**: `spec-chat-page-states.md` SP8; `journey-走查.md` §2 (scale tiers).

**Core ACs**:
- Happy path: results with >100 points automatically switch to draft-edit mode (agent preselects 8 items + horizontally-scrolling 名場面 TOP + collapsed area group headers), not a flat list -> browser
- Happy path: tapping "入れ替え" on a preselected item offers 3 nearby candidates in the same area / similar time cost for a local swap (not a full reselect) -> browser
- Empty: the boundary case of exactly 100 points is handled deterministically by one clear rule (picks one mode or the other), never flickering between the two -> unit
- Error: swapping an item with zero nearby candidates shows a clear "代替候補なし" notice, not a broken empty swap menu -> browser
- Contract governance (backfilled from SD-13): this component's payload carries `schema_version`, following additive-only evolution (Active → Deprecated → Removed, ≥12-month deprecation window); Storybook establishes both a partial-tolerant-state story and a legacy-payload-state story for this component -> unit/browser

**Changed files**: `apps/web/src/components/chat/workbench/DraftEditMode.tsx`, `apps/web/src/lib/chat/workbench/nearbySwapCandidates.ts`.

**Dependencies**: S6.1, S1.4 (reuses the point-card component).

---

### S6.6 SP9 anchor delegation

**Scope**: The user flags 1-3 "絶対行く" (definitely-going) anchor points, leaving the rest for the agent to fill in around those anchors plus the time budget.

**Design basis**: `spec-chat-page-states.md` SP9; `user-journey.md` (turning "choose 8 out of 300" into "name 2 must-visits and delegate the rest").

**Core ACs**:
- Happy path: after flagging 1-3 anchors, choosing "残りはおまかせで埋める" (leave the rest to you) triggers an agent turn (with the pipeline choreography) that fills in the rest of the draft around the anchors and time budget -> integration
- Empty: choosing "おまかせ" (your call) with zero anchors still produces a valid draft (equivalent to the agent's default preselection behavior) -> unit
- Error: when the flagged anchors are mutually incompatible (e.g., too far apart for the time budget), shows a warning chip instead of silently generating an infeasible route -> browser
- Contract governance (backfilled from SD-13): this component's payload carries `schema_version`, following additive-only evolution (Active → Deprecated → Removed, ≥12-month deprecation window); Storybook establishes both a partial-tolerant-state story and a legacy-payload-state story for this component -> unit/browser

**Changed files**: `apps/web/src/components/chat/workbench/AnchorDelegation.tsx`.

**Dependencies**: S6.5.

# Animal Island Full Frontend Redesign

## Context

A batch of Codex design probes (`docs/design/redesign-probes/`) has been generated and reviewed by 4 independent review agents. Design judgments are **locked** (this spec does not re-litigate them). The probes cover: guest-homepage v2 (4-section), a 16-state storyboard, 11 component isolates, and the fox mascot v2. This spec converts the locked decisions into an executable, test-annotated work breakdown grounded in real codebase reconnaissance of the `feat/ssr-cloudflare` worktree.

The frontend is mid-migration to consuming the published npm package `animal-island-ui-tailwind` (consumed in `frontend/package.json` as `"animal-island-ui": "file:../../../../../animal-island-ui-tailwind"`). The redesign's foundation wave must finish that migration cleanly before surface work begins.

## Goals

- Frontend consumes `animal-island-ui` as the **single source of truth** for primitive UI components and design tokens; local `frontend/components/ui/` is reduced to (a) thin re-export shims for package components and (b) app-specific composites the package does not provide.
- A first-class `BeforeAfter` component (anime↔real split with Anime/Real corner badges), registered in `frontend/components/generative/registry.ts`, reused in the homepage hero and Spot Detail (state 07).
- A `FoxGuide` component that **enforces** the fox placement policy (emotional surfaces only; never high-task-density functional pages) by construction.
- Guest homepage rebuilt as a single continuous scroll: rebuilt Hero (cream pill search + gold CTA + fox peek + ROUTE PREVIEW + anime↔real split hero visual + one-tap example search) → How it works → Popular routes → Save-sync.
- A unified app header (single nav set) shared across all logged-in app states.
- The 3 high-task operation surfaces (`SelectionTray`, `SpotListStack`, `ItineraryTimeline`) hardened against real long data with full state matrices (hover/focus/loading/empty/error/long-text/overflow/mobile).

## Non-Goals

- **No backend changes.** PydanticAI agent, tools, `public_api.py`, `models.py`, retriever, DB schema, and `RuntimeResponse` contract are frozen. UI consumes existing `lib/types` discriminated unions (`isSearchData`/`isRouteData`/`isClarifyData`/`isQAData`/`isTimedRouteData`) as-is.
- **No deploy/CI changes.** `wrangler.toml`, `worker/entry.js`, OpenNext config, tag-based deploy flow untouched.
- **No new product features / new routes.** Surfaces map to existing routes (`/`, `/chat`, `/search`, `/anime/[bangumiId]`, `/settings`) and existing storyboard states. No new agent intents.
- **No i18n key removals.** New copy adds keys to all three dictionaries (`ja`/`en`/`zh`); existing keys are not renamed unless a task explicitly migrates a string.
- **No dark mode.** Light theme only (per `frontend/AGENTS.md`).
- **Not re-judging design taste.** Visual direction is locked by the prior review; tasks reference probe images as the visual contract.

## Architecture

### Current state (reconnaissance findings — authoritative)

- **Package is already a dependency** (`file:` link) and partially consumed. Already-migrated shims (each a 2-line re-export from `animal-island-ui`): `button.tsx`, `input.tsx`, `select.tsx`, `switch.tsx`, `typewriter.tsx`. Package also exports (and could back) `Card`, `Checkbox`, `Tabs`, `Tooltip`, `Modal`, `Radio`, `Loading`, `Divider`, `Table`, `Icon`, `CodeBlock`, `Collapse`, `Footer`, plus several non-app components (`WeddingInvitation`, `Phone`, `Time`, `Cursor`).
- **Local Radix/base-ui composites NOT in the package** (real implementations, kept): `sheet.tsx`, `accordion.tsx`, `tabs.tsx`, `tooltip.tsx`, `checkbox.tsx`, `toggle.tsx`, `toggle-group.tsx`, `scroll-area.tsx`, `separator.tsx`, `skeleton.tsx`, `badge.tsx`, `image-compare.tsx`, `card.tsx`. These exist because the app needs Radix composition APIs (e.g. `Sheet`, `ScrollArea`, `Accordion`) the package does not export.
- **Token system is dual and hand-synced.** `frontend/app/globals.css` line 1 imports `./animal-island-ui.css` — a **38KB vendored build copy** of the package's compiled CSS that defines `--animal-*` tokens (`--animal-primary-color`, `--animal-warning-color`, etc.). `globals.css :root` then defines the app's own `--color-*` semantic tokens and shadcn aliases, hand-aligned to the `--animal-*` values (e.g. `--color-primary: #19c8b9` mirrors `--animal-primary-color: #19c8b9`). The CTA button class in `globals.css` consumes `--animal-warning-color` directly. The package exposes a proper CSS entrypoint via its `exports["./style"]` map → `dist/index.css`.
- **`ImageCompare` already exists** (`frontend/components/ui/image-compare.tsx`, draggable slider with `leftLabel`/`rightLabel`) and is already used in `LandingPage.tsx`. The locked `BeforeAfter` motif (static split + persistent Anime/Real badges, registry-registered, reusable in state 07) is a **distinct** component; the hero may keep the draggable slider OR consume `BeforeAfter` — Task A4 decides and unifies.
- **Header nav is already data-driven** via `SharedHeader`'s `navItems?: NavItem[]` prop, but no single shared nav set is passed; the unification is wiring + a shared constant, not a rewrite.
- **`SelectionBar` has no overflow/empty handling** (confirmed: simple overlay, count + clear + plan-route, `disabled` when `count < 2`). The richer tray is net-new.

### Locked architecture decision: npm package consumption model

**Decision: "Re-export shim + composite split, single CSS entrypoint."**

1. **Primitives owned by the package** are consumed only through 2-line re-export shims in `frontend/components/ui/` (the existing pattern for `button`/`input`/etc.). App code keeps importing from `@/components/ui/*` so call sites never change; the shim is the swap point. Rationale: preserves the 27 existing `@/components/ui` importers, keeps a single seam for future package upgrades, and matches the established convention.
2. **App-specific composites** (`Sheet`, `ScrollArea`, `Accordion`, `Skeleton`, `Separator`, `Toggle`/`ToggleGroup`, `Badge`, and `BeforeAfter`) **stay local** and Radix/base-ui-backed, because the package does not export composition-grade equivalents. They are explicitly documented as "app layer, not package candidates" so future migration passes do not churn them.
3. **CSS single source of truth:** replace the hand-vendored `frontend/app/animal-island-ui.css` import with the package's published CSS entrypoint (`import "animal-island-ui/style"`). The app's `--color-*` semantic layer and shadcn aliases in `globals.css :root` remain (they are app-owned mappings), but the `--animal-*` token layer comes from the package at install time, eliminating the 38KB hand-synced drift artifact. A contract test asserts the `--animal-*` → `--color-*` alignment so a package bump that moves a value fails CI instead of silently desyncing.
4. **Token alignment is asserted, not assumed.** A unit test reads the resolved CSS variables and asserts the documented equalities (e.g. `--color-primary === --animal-primary-color`, `--color-cta` aligns to `--animal-warning-color`). This is the ratchet that makes the package the source of truth safely.

This decision is Wave 0 and gates everything else.

## Layout/Design Decision

- Visual contract images (locked, do not regenerate):
  - Homepage hero + sections: `docs/design/redesign-probes/guest-homepage-image-review-v1/homepage-sections-v2/01-hero-corrected.png`, `02-how-it-works.png`, `03-popular-routes.png`, `04-save-sync.png`.
  - 16-state storyboard: `docs/design/redesign-probes/state-storyboard-v1/01..16-*.png` + `state-index.md` (state→component→action map).
  - Peak-value states to polish first: `07-spot-detail.png` (anime↔real), `10-final-itinerary.png` (timeline).
  - Fox v2 assets (named to poses): `frontend/public/images/landing/fox-guide-v2/fox-a-city-guide.png` (welcome), `fox-c-ai-navigator.png` (AI working), `fox-e-scene-compare.png` (compare), `fox-d-backpack-traveler.png` (travel/empty), `fox-f-icon-mark.png` (favicon/stamp).
  - anime↔real source pairs already in repo: `hero-kimi-anitabi-real.jpg` / `hero-kimi-banbi-reference.jpg`, `suga-shrine-*` set.
- Unified nav set (from storyboard states 05/08): マップ / スポット / 旅の記録 / コレクション (rendered per-locale via dictionary keys).
- Section rhythm: single continuous scroll, unified cream background, 48px inter-section spacing, one shared fixed header.

## Three Hard Gates

These are non-negotiable acceptance gates for the whole iteration; the Coordinator should treat any failure as iteration-blocking.

1. **Hero rebuild gate (Wave 1):** Homepage hero matches `01-hero-corrected.png` structure — cream pill search, gold `#f0b429` CTA, fox peek, ROUTE PREVIEW card, anime↔real split as the primary visual — AND the search box supports one-tap example search (clicking an example fills the input and triggers the search/redirect path). No `readOnly` dead input on the example path.
2. **Header unification gate (Wave 2):** Exactly one nav definition (a shared constant) is rendered by the app header across all logged-in app states (05/08/10/14/15). No per-page divergent nav arrays. Guest header may differ (login CTA) but uses the same component.
3. **Component state-matrix gate (Wave 2):** `SelectionTray`, `SpotListStack`, and `ItineraryTimeline` each ship with the full state matrix verified against real long data (counts/edge cases enumerated per task). A "pretty screenshot" with no empty/overflow/error/mobile handling does not satisfy the AC.

## Task Breakdown

> Every AC line ends with `-> {test type}` (unit | integration | eval | browser | api). Per repo Quality Ratchet, every task carries ≥1 happy-path, ≥1 null/empty/boundary, and ≥1 error-path AC. User-facing tasks add an i18n AC. Coverage floors may only ratchet up (current: lines≥72, statements≥68, functions≥61 [config value; CLAUDE.md cites 62 — see Risk R5], branches≥59).

---

### Category A — Infrastructure / Wave 0 (foundation; gates everything)

#### Task A1: Adopt package CSS entrypoint, retire vendored `animal-island-ui.css`
- **Scope:** Replace `@import "./animal-island-ui.css"` in `globals.css` with the package's published CSS (`import "animal-island-ui/style"` in the appropriate layout/global entry, per OpenNext/Next CSS rules). Delete the 38KB vendored `frontend/app/animal-island-ui.css`. Keep app-owned `--color-*` and shadcn alias layers in `globals.css :root`.
- **Files changed:** `frontend/app/globals.css`, `frontend/app/layout.tsx` (or wherever global CSS is imported), delete `frontend/app/animal-island-ui.css`, `frontend/vitest.config.ts` (asset/css inline stub already lists `animal-island-ui` — verify still valid).
- **AC:**
  - [ ] Happy path: app renders with package CSS; CTA button still resolves `--animal-warning-color` (gold) and primary resolves teal `#19c8b9` -> browser
  - [ ] Boundary: resolved `--animal-*` token set present in document with no missing-variable fallbacks (every `--animal-*` referenced in `globals.css` resolves) -> unit
  - [ ] Error path: build fails loudly (not silent blank styles) if the package CSS export is unresolved/missing -> integration
  - [ ] i18n: font-face stack for ja/en/zh glyphs (Noto/Nunito/Zen Maru/Noto Sans SC) still loads from package fonts entry -> browser

#### Task A2: Token-alignment contract test (package = source of truth)
- **Scope:** Add a test that resolves CSS variables and asserts documented equalities so a package token bump fails CI instead of desyncing. Document the alignment map.
- **Files changed:** `frontend/tests/design-token-alignment.test.ts` (new), `frontend/DESIGN.md` (alignment map note), `frontend/AGENTS.md` (note: package owns `--animal-*`).
- **AC:**
  - [ ] Happy path: `--color-primary` === `--animal-primary-color`; `--color-cta` aligned to `--animal-warning-color`; `--color-error-fg` aligned to `--animal-error-color-active` -> unit
  - [ ] Null/empty: test fails with a clear message if any asserted variable resolves to empty string -> unit
  - [ ] Error path: introducing a deliberate mismatch (fixture) makes the assertion fail (test proves it can fail) -> unit

#### Task A3: Component-ownership audit + shim normalization
- **Scope:** Codify the consumption model: confirm the 5 existing shims, document the local composites as "app layer", and (where the package already exports an equivalent the app can adopt without API loss — e.g. `Card`) convert to a shim; otherwise leave local and annotate. No behavioral change to call sites.
- **Files changed:** `frontend/components/ui/*` (shim normalization only where lossless), `frontend/components/ui/README` note OR `frontend/AGENTS.md` "Component Architecture" section (ownership table), `frontend/components/generative/registry.ts` (unchanged unless a converted component is referenced).
- **AC:**
  - [ ] Happy path: every `@/components/ui/*` import still resolves and renders identically post-normalization (27 importers unaffected) -> integration
  - [ ] Boundary: a component with no package equivalent (`Sheet`) remains local and is documented as app-owned (audit list complete: package-backed vs local) -> unit
  - [ ] Error path: a shim pointing at a non-exported package symbol is caught at type-check (build fails) -> integration

#### Task A4: `BeforeAfter` first-class component + registry registration
- **Scope:** Create `BeforeAfter` (static split, persistent Anime/Real corner badges, locale-aware labels, optional draggable mode reusing `ImageCompare` internals) under `frontend/components/generative/`. Register in `registry.ts`. Decide hero relationship: hero adopts `BeforeAfter` (preferred) so there is one motif component.
- **Files changed:** `frontend/components/generative/BeforeAfter.tsx` (new), `frontend/components/generative/BeforeAfter.stories.tsx` (new), `frontend/components/generative/registry.ts` (register), `frontend/components/ui/image-compare.tsx` (extract shared internals if needed), `frontend/lib/dictionaries/{ja,en,zh}.json` (Anime/Real label keys if not already present).
- **AC:**
  - [ ] Happy path: renders both images with Anime + Real badges; default split visible; consumed by registry lookup -> browser
  - [ ] Null/empty: missing/empty `rightSrc` (real photo absent) falls back to anime-only with a graceful placeholder, no broken `<img>` -> unit
  - [ ] Error path: broken image URL triggers `onError` fallback (placeholder + alt text), component does not collapse height -> unit
  - [ ] i18n: badge labels render per locale (動画/実写, Anime/Real, 动画/实景) from dictionaries -> unit

#### Task A5: `FoxGuide` policy-enforcing component
- **Scope:** Create `<FoxGuide pose size>` mapping the 4 core poses + icon-mark to the v2 assets, with the placement policy enforced (a `surface` prop typed to an allowlist; high-task surfaces are not in the union, so misuse is a type error). Fox absolute-positioned, decorative (`aria-hidden`), `prefers-reduced-motion` respected.
- **Files changed:** `frontend/components/generative/FoxGuide.tsx` (new), `frontend/components/generative/FoxGuide.stories.tsx` (new), uses `frontend/public/images/landing/fox-guide-v2/*`.
- **AC:**
  - [ ] Happy path: `pose="welcome"` renders `fox-a-city-guide.png`; each of the 4 poses + icon-mark maps to the correct asset -> unit
  - [ ] Boundary: `prefers-reduced-motion` disables fox idle animation; fox is `aria-hidden` (not announced) -> unit
  - [ ] Error path: a disallowed surface value is rejected at type-check (policy enforced by construction); runtime guard returns null for an unknown pose -> unit

---

### Category B — Guest Homepage / Wave 1 (depends on A4, A5)

#### Task B1: Hero rebuild (Hard Gate #1)
- **Scope:** Rebuild `LandingPage` hero per `01-hero-corrected.png`: cream pill search, gold CTA `#f0b429`, fox peek (`FoxGuide pose="welcome"`), ROUTE PREVIEW card, anime↔real split as primary visual (via `BeforeAfter`). Replace the current `readOnly` input's dead-end with one-tap example search.
- **Files changed:** `frontend/components/auth/LandingPage.tsx`, `frontend/components/auth/LandingData.ts` (example queries), `frontend/lib/dictionaries/{ja,en,zh}.json` (hero copy + example labels), `frontend/components/generative/BeforeAfter.tsx` (consume), `frontend/components/generative/FoxGuide.tsx` (consume).
- **AC:**
  - [ ] Happy path: hero shows pill search + gold CTA + fox + ROUTE PREVIEW + `BeforeAfter`; layout matches probe at desktop width -> browser
  - [ ] Happy path: clicking an example chip fills the search input and triggers the search path (auth modal or `/chat` redirect with the query), not a no-op -> integration
  - [ ] Null/empty: submitting an empty search does not navigate; CTA disabled or shows inline hint -> unit
  - [ ] Error path: if the example data list is empty, hero renders without example chips and does not crash -> unit
  - [ ] i18n: hero headline/lead/CTA/placeholder/examples render per locale; no hardcoded JP literals (current code has inline `君の名は。…` — must move to dict) -> unit
  - [ ] Responsive: mobile (<768px) collapses to single column, search + CTA full-width, fox/preview hidden or stacked per probe -> browser

#### Task B2: "How it works" + "Popular routes" sections
- **Scope:** Implement sections 2 and 3 as continuous-scroll blocks per `02-how-it-works.png` / `03-popular-routes.png`. Popular routes reuse `recent-route-card` styling; data from existing `ANIME_GALLERY`.
- **Files changed:** `frontend/components/auth/LandingPage.tsx`, `frontend/components/auth/LandingData.ts`, `frontend/lib/dictionaries/{ja,en,zh}.json`.
- **AC:**
  - [ ] Happy path: 4-step "how it works" and popular-routes grid render with 48px section spacing, unified cream bg -> browser
  - [ ] Null/empty: popular-routes with 0 gallery items shows an empty placeholder, not a broken grid -> unit
  - [ ] Error path: a gallery item with a broken cover image uses `handleImageError` fallback -> unit
  - [ ] i18n: all section headings/step copy localized -> unit

#### Task B3: "Save-sync" section + section assembly
- **Scope:** Implement section 4 (save/sync value prop) per `04-save-sync.png`, optional `FoxGuide` accent, and assemble all four sections into one continuous page with the shared header/footer.
- **Files changed:** `frontend/components/auth/LandingPage.tsx`, `frontend/lib/dictionaries/{ja,en,zh}.json`, `frontend/components/generative/FoxGuide.tsx` (consume).
- **AC:**
  - [ ] Happy path: save-sync section renders; full page is a single scroll with consistent header/footer -> browser
  - [ ] Boundary: scroll-reveal animations respect `prefers-reduced-motion` (content visible without animation) -> unit
  - [ ] Error path: unauthenticated CTA click opens the login modal (no crash, no dead link) -> integration
  - [ ] i18n: save-sync copy localized -> unit

---

### Category C — Core Components / Wave 2 (depends on A; parallel-safe with each other)

#### Task C1: `SelectionTray` with full state matrix (Hard Gate #3)
- **Scope:** Net-new selection tray (evolves `SelectionBar`/`SelectionBarOverlay`) per `08-selection-review-tray.png`, reduced to be the sole focus of state 08. Must handle: 0 selected (empty), 8–12 selected overflow strategy (horizontal scroll OR wrap OR "+N more" collapse — pick one and implement), collapse/expand, CTA disabled until ≥2.
- **Files changed:** `frontend/components/layout/SelectionBar.tsx` (or new `SelectionTray.tsx`), `frontend/components/layout/SelectionBar.stories.tsx`, `frontend/lib/dictionaries/{ja,en,zh}.json`.
- **AC:**
  - [ ] Happy path: with 3 selected, tray shows chips + count + Plan Route enabled -> unit
  - [ ] Null/empty: 0 selected renders an explicit empty state (prompt to select), Plan Route disabled -> unit
  - [ ] Boundary: 12 selected triggers the overflow strategy ("+N more"/scroll) without layout break or horizontal page scroll -> browser
  - [ ] Error path: removing the last chip returns to empty state cleanly (no NaN count, no orphaned CTA) -> unit
  - [ ] i18n: count string + empty prompt + CTA localized (uses `result_panel.selected` token replacement) -> unit
  - [ ] Responsive: mobile bottom-tray is the single focal element; chips remain reachable -> browser

#### Task C2: `SpotListStack` with lazy thumbs + long-data hardening
- **Scope:** Harden the spot list (evolves `FloatingSpotList`/`SpotCard`) per states 05/06: 30+ spots scroll, thumbnail lazy-load + broken-image fallback, long-name truncation, 0-results empty state.
- **Files changed:** `frontend/components/layout/FloatingSpotList.tsx`, `frontend/components/spots/SpotCard.tsx`, `frontend/components/spots/SpotCard.stories.tsx`, `frontend/lib/dictionaries/{ja,en,zh}.json`.
- **AC:**
  - [ ] Happy path: 30 spots render in a scroll container with selectable cards -> unit
  - [ ] Null/empty: 0 results shows an empty state with retry/refine affordance -> unit
  - [ ] Boundary: a 60-character spot name truncates with ellipsis (no wrap-induced layout break); thumbnails below the fold use `loading="lazy"` -> unit
  - [ ] Error path: a broken thumbnail URL shows the fallback, card height stays stable -> unit
  - [ ] i18n: empty-state and card meta ("walking route" etc.) localized -> unit

#### Task C3: `ItineraryTimeline` long-route hardening (peak-value state 10)
- **Scope:** Harden the final itinerary timeline (evolves `RouteTimeline`/`RoutePlannerWizard`) per `10-final-itinerary.png`: 20+ stops scroll (virtualize via existing `@tanstack/react-virtual` if needed), rows without images, current-position highlight, mobile single-column. Fox **must not** appear here (policy).
- **Files changed:** `frontend/components/generative/RouteTimeline.tsx`, `frontend/components/generative/RoutePlannerWizard.tsx`, `frontend/components/generative/RouteTimeline.stories.tsx`, `frontend/lib/dictionaries/{ja,en,zh}.json`.
- **AC:**
  - [ ] Happy path: 20-stop route renders ordered stops with walk segments and times -> unit
  - [ ] Null/empty: a stop with no image renders a text-only row aligned to the timeline rail (no gap/jump) -> unit
  - [ ] Boundary: current-position stop is visually highlighted; mobile collapses to single column -> browser
  - [ ] Error path: malformed/zero-stop route data renders an empty itinerary message, not a crash -> unit
  - [ ] i18n: stop labels, durations, and the empty message localized -> unit

#### Task C4: Reusable peak components — `error-retry-ticket`, `recent-route-card`, `chat-summary-card`
- **Scope:** Promote the three strongest isolates to reusable components used by states 12 (error), 14/15 (history/saved), and chat summaries. `error-retry-ticket` wires to the existing error path (state 12).
- **Files changed:** `frontend/components/generative/` (3 new components + stories), `frontend/components/layout/ResultPanelEmptyState.tsx` (consume retry ticket where applicable), `frontend/lib/dictionaries/{ja,en,zh}.json`.
- **AC:**
  - [ ] Happy path: error-retry-ticket renders message + Retry + Edit-query actions; recent-route-card and chat-summary-card render their content -> unit
  - [ ] Null/empty: recent-route-card with missing thumbnail/0 spots renders a safe placeholder -> unit
  - [ ] Error path: Retry action invokes the provided retry callback exactly once (no double-fire) -> unit
  - [ ] i18n: all three components' copy localized -> unit

---

### Category D — App States / Wave 3 (depends on Wave 1 + Wave 2)

#### Task D1: Unified app header + nav (Hard Gate #2)
- **Scope:** Define one shared nav constant (マップ/スポット/旅の記録/コレクション, locale-keyed) and render it via `SharedHeader` across all logged-in app states (05/08/10/14/15). Remove any per-page nav divergence.
- **Files changed:** `frontend/components/layout/SharedHeader.tsx`, a shared nav constant (e.g. `frontend/lib/nav.ts` new), `frontend/components/layout/AppShell.tsx`, `frontend/lib/dictionaries/{ja,en,zh}.json`.
- **AC:**
  - [ ] Happy path: all app states render the identical 4-item nav from the shared constant -> integration
  - [ ] Boundary: active route is highlighted; guest header uses the same component with login CTA instead of nav -> unit
  - [ ] Error path: an unknown route does not break active-state computation (no thrown error) -> unit
  - [ ] i18n: nav labels localized for ja/en/zh -> unit
  - [ ] Responsive: nav collapses appropriately on mobile (sheet/drawer), no overlap with logo -> browser

#### Task D2: Spot Detail (state 07) anime↔real integration
- **Scope:** Wire `BeforeAfter` into `SpotDetail` per `07-spot-detail.png` (peak-value state): anime↔real comparison as a first-class block, add/remove spot action, nearby context. `FoxGuide pose="compare"` allowed here only if not high-task; default off per policy review — keep it out of the selection/route surfaces.
- **Files changed:** `frontend/components/generative/SpotDetail.tsx`, `frontend/components/generative/SpotDetail.stories.tsx`, `frontend/components/generative/BeforeAfter.tsx` (consume), `frontend/lib/dictionaries/{ja,en,zh}.json`.
- **AC:**
  - [ ] Happy path: spot detail shows `BeforeAfter` block + add/remove control + nearby points -> browser
  - [ ] Null/empty: a spot with no real-photo pair degrades to anime-only via `BeforeAfter` fallback -> unit
  - [ ] Error path: add/remove toggles selection state correctly and is idempotent on rapid double-click -> unit
  - [ ] i18n: detail labels and add/remove CTA localized -> unit

#### Task D3: Agent-working / clarify / no-results / nearby-permission states with FoxGuide
- **Scope:** Apply the locked fox policy to emotional surfaces only: welcome (a), AI-working (c), no-results/empty (d), nearby-permission (request). Polish states 03/04/11/13 to the storyboard. Verify fox is **absent** from 05/09/10.
- **Files changed:** `frontend/components/chat/WelcomeScreen.tsx`, `frontend/components/generative/Clarification.tsx`, `frontend/components/layout/ResultPanelEmptyState.tsx`, `frontend/components/chat/LocationPrompt.tsx`, `frontend/components/generative/FoxGuide.tsx` (consume), `frontend/lib/dictionaries/{ja,en,zh}.json`.
- **AC:**
  - [ ] Happy path: welcome shows `FoxGuide pose="welcome"`; AI-working shows `pose="ai-navigator"`; no-results shows `pose="traveler"`; nearby-permission shows fox + allow/skip/manual -> browser
  - [ ] Boundary: high-task surfaces (map-select 05, route-confirm 09, timeline 10) render with **no** FoxGuide (policy assertion) -> unit
  - [ ] Error path: nearby-permission "skip" falls back to manual location entry without error -> integration
  - [ ] i18n: all four states' copy localized -> unit

#### Task D4: History drawer + Saved pilgrimages (states 14/15) polish
- **Scope:** Apply `recent-route-card`/`chat-summary-card` to the conversation drawer (14) and saved list (15), under the unified header. Reopen/hydrate a past session works.
- **Files changed:** `frontend/components/layout/ConversationDrawer.tsx`, `frontend/components/layout/ConversationListShared.tsx`, `frontend/components/generative/` (consume cards), `frontend/lib/dictionaries/{ja,en,zh}.json`.
- **AC:**
  - [ ] Happy path: history drawer lists recent sessions as cards; selecting one hydrates the session -> integration
  - [ ] Null/empty: empty history shows an empty state, not a blank panel -> unit
  - [ ] Error path: a corrupt/partial saved entry renders a safe card (no crash) and is skippable -> unit
  - [ ] i18n: drawer/saved labels localized -> unit

---

## Verification Plan

- **Per-PR (Reviewer):** `make check` (lint + typecheck + frontend tests); confirm `ac_total == ac_with_test` for the task; confirm coverage did not drop below floors (lines≥72, statements≥68, functions≥61, branches≥59) and ratchet up if raised; confirm no suppressions (`eslint-disable`/`@ts-ignore`/etc.) and no `bg-[var(--color-*)]` (use semantic Tailwind classes); confirm any new generative component is registered in `registry.ts`.
- **Per-wave (Coordinator):** rebase remaining PRs after each merge; run `npm run build` (OpenNext bundle) to catch SSR/CSS-import regressions from Task A1.
- **End-of-iteration (Tester, against running app `make dev-local` → :3001):**
  - Hard Gate #1: load `/`, click an example chip, assert the search path fires (browser).
  - Hard Gate #2: visit each app state, assert identical nav DOM from the shared constant (browser/integration).
  - Hard Gate #3: drive `SelectionTray` to 0 and to 12 items, `SpotListStack` to 30 items with a broken thumb, `ItineraryTimeline` to 20 stops incl. an imageless stop — assert no layout break, no horizontal scroll, fallbacks visible (browser).
  - Fox policy: assert fox present on 01/03/11/13 and absent on 05/09/10 (browser).
  - i18n: switch locale ja↔en↔zh on homepage + one app state; assert no raw key leakage and no hardcoded JP literals (browser).
  - `make e2e-public` passes (no regression to existing 12 email-free Playwright tests).
- **Visual:** compare each rebuilt surface against its locked probe image; deviations require Coordinator sign-off (taste is locked, structure must match).

## Dependencies

- **Wave 0 (A1–A5)** is a hard prerequisite for everything. A1 (CSS entrypoint) and A2 (token contract) gate visual correctness; A4 (`BeforeAfter`) and A5 (`FoxGuide`) are consumed by Waves 1/2/3. A3 (ownership audit) gates safe future package upgrades.
- **Wave 1 (B1–B3)** depends on A4, A5. B1 (hero) is independent of B2/B3 and is Hard Gate #1.
- **Wave 2 (C1–C4)** depends on A (tokens/CSS, and C4 cards consume nothing from B). C1/C2/C3/C4 are mutually parallel-safe (different files).
- **Wave 3 (D1–D4)** depends on Wave 1 + Wave 2: D2 needs `BeforeAfter` (A4) + Spot Detail polish; D1 (header) needs to be the single nav before app states are finalized; D3/D4 consume `FoxGuide` (A5) and the C4 cards.
- External: package version is `0.8.2` consumed via `file:` link; no registry publish needed for this iteration. If a package source change is required (e.g. to export a missing primitive), that is a **separate** repo's work and out of scope here — instead keep the composite local (per the locked decision).

### Suggested wave structure

| Wave | Cards | Parallelism | Depends on |
|---|---|---|---|
| Wave 0 — Foundation | A1, A2, A3, A4, A5 (5 cards) | A1→A2 sequential (A2 asserts A1's CSS); A3, A4, A5 parallel after A1 | — |
| Wave 1 — Guest homepage | B1, B2, B3 (3 cards) | B1 parallel with (B2→B3) | A4, A5 |
| Wave 2 — Core components | C1, C2, C3, C4 (4 cards) | all 4 parallel | A1, A2 (A4 for C-stories that use BeforeAfter) |
| Wave 3 — App states | D1, D2, D3, D4 (4 cards) | D1 first (header is the shared seam), then D2/D3/D4 parallel | Wave 1 + Wave 2 |

Total: **16 cards across 4 waves.** Waves 1 and 2 may overlap in scheduling once Wave 0 merges (they touch disjoint files: `auth/`+homepage vs `layout/`+`generative/` core), but treat Wave 1→Wave 3 and Wave 2→Wave 3 as the binding ordering.

## Risk Assessment

- **R1 — CSS entrypoint swap (A1) under OpenNext SSR is the highest-risk change.** `frontend/AGENTS.md` warns this Next.js has breaking changes; importing package CSS through the SSR/Cloudflare bundle may behave differently than the vendored `@import`. Mitigation: A1 ships first and alone; `npm run build` (OpenNext) is part of its AC; keep the vendored file in git history for fast rollback.
- **R2 — Token desync between package and app.** If A1 lands but A2's contract test is weak, a future `animal-island-ui` bump silently shifts brand colors. Mitigation: A2 must include a self-failing fixture proving the assertion can fail.
- **R3 — `BeforeAfter` vs existing `ImageCompare` duplication.** Two comparison components could drift. Mitigation: A4 extracts shared internals; hero (B1) consumes `BeforeAfter`, not the raw slider, so there is one motif owner.
- **R4 — State-matrix tasks (C1–C3) are where "pretty probe → real bug" risk concentrates.** Probes have no overflow/empty/error/mobile. Mitigation: each C-task's ACs enumerate explicit counts (0, 12, 30, 20) and a broken-image/edge row; the Tester drives real long data at the gate.
- **R5 — Coverage `functions` floor discrepancy.** `vitest.config.ts` says `functions: 61` (with a comment "temporarily lowered — DesktopConversationSidebar tests disabled"); root `CLAUDE.md` says 62. Flag for Coordinator: confirm the true floor before review; do not lower it, and re-enable `DesktopSidebar.test.tsx.disabled` if a task touches that component so the floor can ratchet back to 62.
- **R6 — i18n literal debt.** `LandingPage.tsx` currently hardcodes Japanese literals (e.g. `君の名は。/ 須賀神社階段 · 新宿`) and inline locale ternaries. B1 must migrate these to dictionaries; missing this would ship untranslated hero text. The i18n AC on B1 covers it.
- **R7 — Fox policy is a soft constraint unless enforced by types.** A5 makes the `surface` prop reject high-task surfaces at compile time; D3 adds a runtime/test assertion that fox is absent from 05/09/10. Without A5's type enforcement, the policy will erode.
- **R8 — `lucide-react` is pinned `^1.14.0` (unusually low major).** Icon imports in rebuilt surfaces should be verified against the installed version's exports during implementation to avoid missing-icon build breaks.

## Output / File Path

Spec: `docs/superpowers/specs/2026-05-31-animal-island-full-redesign.md`

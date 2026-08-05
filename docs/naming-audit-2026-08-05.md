# Naming Audit — 2026-08-05 (round 2: serialization-boundary re-tier)

Full-repo violation inventory against `docs/naming-conventions.md` (codified
same day from a measured histogram). Scope: tracked files under `apps/`,
`workers/`, `packages/`, `infra/`, `e2e/`, `scripts/`, `db/`. Skipped: `docs/`,
generated output, `node_modules`, `.venv`. Method: `find`/`rg` histograms for
file-level names; `rg` sweeps for symbol-level semantic rules.

**Tiering gates applied before ANY L1 assignment** (round-2 fix):

1. **Serialization boundary** — a symbol is NOT L1 if it is (a) an
   object-shorthand payload key crossing a function/API boundary, (b) a
   pydantic/dataclass field on a persisted or wire model, (c) a
   platform-contract property. Such symbols are L3 (or exempt per the
   conventions doc's wire-key carve-out).
2. **Import-site sweep** — `rg "from '…<name>'"` for every file-rename
   candidate, repo-wide (not just same-package).
3. **Path-reference sweep** — file paths consumed outside their own package
   (read by path in another package's tests, invoked in CI, listed in CI
   path filters) are L2, not L1.
4. Conservative rule: uncertain tier → higher tier.

## Summary counts

| Tier | apps/web | apps/agent | workers/edge | workers/catalog | packages/contract | workers/users | infra | e2e | scripts | db | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| L1 — files | 45 | 1 | 24 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **70** |
| L1 — symbols | 8 | 20 | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **38** |
| L2 — cross-package | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **3** |
| L3 — external contract (adjudicate) | 1 | 5 | 2 | 1 | 0 | 1 | 0 | 0 | 0 | 1 | **11** |
| **Total** | 54 | 26 | 39 | 1 | 0 | 1 | 0 | 0 | 0 | 1 | **122** |

L1 = 70 file renames + 38 symbol renames = 108. Every L1 file was verified to
have zero imports and zero path references outside its own package (incl. CI
workflows and other packages' tests). No violations found in
`packages/contract` (src), `infra/`, `e2e/`, `scripts/`, `db/` (files); the
`packages/contract` entry that does exist is an L2 *consumer* of
`workers/edge/costBreaker.ts`.

Round-2 deltas vs round 1: removed `workers/catalog` L1 symbols
(`distance_m`/`station_ids`/`point_ids` — wire payload keys, not
identifiers); moved `workers/edge/entry.ts:37` `envVars` and
`apps/agent/agent/agents/session_state.py:98` `partial` to L3
(serialization boundary); corrected `catalog_adapter.py:97` (was mis-listed
as `success: bool`, actually `partial: bool = False`); added the 60
file renames the round-1 inventory omitted (27 web src modules, 6 web
tests, 27 workers/edge files — of which 3 re-tiered to L2 via the
path-reference sweep); re-tiered 3 edge files to L2 via the same sweep.

---

## L1 — internal-only (safe LSP rename; consumer sweep within package)

### L1 files — apps/web (45)

#### camelCase modules → kebab (27)

| Path | Current | Proposed |
|---|---|---|
| `apps/web/src/features/bubble-map/bubbleGeometry.ts` | bubbleGeometry | `bubble-geometry.ts` |
| `apps/web/src/features/bubble-map/bubbleMapController.ts` | bubbleMapController | `bubble-map-controller.ts` |
| `apps/web/src/features/map-spike/mapController.ts` | mapController | `map-controller.ts` |
| `apps/web/src/features/map-spike/mapLayers.ts` | mapLayers | `map-layers.ts` |
| `apps/web/src/features/map-spike/mapStyle.ts` | mapStyle | `map-style.ts` |
| `apps/web/src/features/map-spike/sourceMode.ts` | sourceMode | `source-mode.ts` |
| `apps/web/src/features/maplibre/maplibreAdapter.ts` | maplibreAdapter | `maplibre-adapter.ts` |
| `apps/web/src/features/seo/hreflangGraph.ts` | hreflangGraph | `hreflang-graph.ts` |
| `apps/web/src/features/shiori/exifStrip.ts` | exifStrip | `exif-strip.ts` |
| `apps/web/src/features/shiori/layoutSelector.ts` | layoutSelector | `layout-selector.ts` |
| `apps/web/src/features/shiori/photoIngestion.ts` | photoIngestion | `photo-ingestion.ts` |
| `apps/web/src/features/shiori/timeWindow.ts` | timeWindow | `time-window.ts` |
| `apps/web/src/lib/auth/authSession.ts` | authSession | `auth-session.ts` |
| `apps/web/src/lib/auth/neonAuth.ts` | neonAuth | `neon-auth.ts` |
| `apps/web/src/lib/auth/returnTarget.ts` | returnTarget | `return-target.ts` |
| `apps/web/src/lib/auth/sessionMigration.ts` | sessionMigration | `session-migration.ts` |
| `apps/web/src/lib/byok/byokStorage.ts` | byokStorage | `byok-storage.ts` |
| `apps/web/src/lib/chat/draftStorage.ts` | draftStorage | `draft-storage.ts` |
| `apps/web/src/lib/chat/errorClassifier.ts` | errorClassifier | `error-classifier.ts` |
| `apps/web/src/lib/chat/selectedPointsBypass.ts` | selectedPointsBypass | `selected-points-bypass.ts` |
| `apps/web/src/lib/chat/spotClusters.ts` | spotClusters | `spot-clusters.ts` |
| `apps/web/src/lib/route-detail/dataState.ts` | dataState | `data-state.ts` |
| `apps/web/src/lib/route-detail/pinState.ts` | pinState | `pin-state.ts` |
| `apps/web/src/lib/turnstile/tokenStore.ts` | tokenStore | `token-store.ts` |
| `apps/web/src/features/chat/save/createOnLogin.ts` | createOnLogin | `create-on-login.ts` |
| `apps/web/src/features/chat/save/deferredSave.ts` | deferredSave | `deferred-save.ts` |
| `apps/web/src/features/chat/save/saveTarget.ts` | saveTarget | `save-target.ts` |

#### Components / hooks / helpers (12)

| Path | Current | Proposed |
|---|---|---|
| `apps/web/src/features/chat/chat-actions.tsx` | chat-actions | `ChatActions.tsx` (exports `ChatActionsProvider`) |
| `apps/web/src/features/chat/return-target.tsx` | return-target | `ChatReturnTarget.tsx` (exports `ChatReturnTargetProvider`) |
| `apps/web/src/features/anime/route-states.tsx` | route-states | `AnimeRouteStates.tsx` (exports `AnimeErrorState`/`AnimePendingState`) |
| `apps/web/src/components/route-detail/route-states.tsx` | route-states | `RouteDetailStates.tsx` (exports `RouteDetailErrorState`/`RouteDetailPendingState`) |
| `apps/web/src/features/chat/selection/useSpotSelection.tsx` | useSpotSelection | `use-spot-selection.tsx` (hook kebab) |
| `apps/web/src/features/chat/components/useAutoFocus.ts` | useAutoFocus | `use-auto-focus.ts` |
| `apps/web/src/features/chat/selection/useRecomputeTurn.ts` | useRecomputeTurn | `use-recompute-turn.ts` |
| `apps/web/src/features/chat/save/useSaveGate.ts` | useSaveGate | `use-save-gate.ts` |
| `apps/web/src/components/landing/useTheme.ts` | useTheme | `use-theme.ts` |
| `apps/web/src/components/auth/useAuthCallback.ts` | useAuthCallback | `use-auth-callback.ts` |
| `apps/web/src/components/auth/useMagicLinkForm.ts` | useMagicLinkForm | `use-magic-link-form.ts` |
| `apps/web/tests/unit/shiori/_jpegFixtures.ts` | _jpegFixtures | `_jpeg-fixtures.ts` (kebab; underscore prefix kept) |

#### Test files — camelCase base → kebab (6)

| Path | Current | Proposed |
|---|---|---|
| `apps/web/tests/unit/byokStorage.test.ts` | byokStorage | `byok-storage.test.ts` |
| `apps/web/tests/unit/byokStorage-field-safety.test.ts` | byokStorage-field-safety | `byok-storage-field-safety.test.ts` |
| `apps/web/tests/unit/byokStorage-security-error.test.ts` | byokStorage-security-error | `byok-storage-security-error.test.ts` |
| `apps/web/tests/unit/byokStorage-source-guard.test.ts` | byokStorage-source-guard | `byok-storage-source-guard.test.ts` |
| `apps/web/tests/unit/byokStorage-ssr.test.ts` | byokStorage-ssr | `byok-storage-ssr.test.ts` |
| `apps/web/tests/unit/byokStorage-validation.test.ts` | byokStorage-validation | `byok-storage-validation.test.ts` |

Import sites for all 45 files (~150 total) verified inside `apps/web`
(features, routes, tests) via `rg`. Test-helper files `_token-helpers.ts`,
`_route-fixtures.ts`, `_chat-page.tsx`, `_i18n.tsx`, `_render.tsx`,
`_actions.ts` are compliant (kebab + underscore prefix convention) — no
change.

### L1 files — apps/agent (1)

| Path | Current | Proposed |
|---|---|---|
| `apps/agent/agent/tests/unit/chat_wire_parser.ts` | chat_wire_parser | `chat-wire-parser.ts` (TS module in a Python package; kebab per TS rule) |

Two invocation sites, both test-only, same package:
`apps/agent/agent/tests/unit/test_chat_wire_contract.py:139,149` (spawns it
as a `node --import tsx` CLI path).

### L1 files — workers/edge (24)

#### camelCase modules → kebab (4)

| Path | Current | Proposed |
|---|---|---|
| `workers/edge/edgeGuard.ts` | edgeGuard | `edge-guard.ts` |
| `workers/edge/guardStore.ts` | guardStore | `guard-store.ts` |
| `workers/edge/rateLimiter.ts` | rateLimiter | `rate-limiter.ts` |
| `workers/edge/catalogPolicy.ts` | catalogPolicy | `catalog-policy.ts` |

(Re-exported `EdgeGuard` from `entry.ts` is same-package — no external
consumer.)

#### Test files — camelCase base → kebab (20)

| Path | Current | Proposed |
|---|---|---|
| `workers/edge/anonymousIdentity.test.ts` | anonymousIdentity | `anonymous-identity.test.ts` |
| `workers/edge/authConfig.test.ts` | authConfig | `auth-config.test.ts` |
| `workers/edge/authFallthrough.test.ts` | authFallthrough | `auth-fallthrough.test.ts` |
| `workers/edge/authRateLimitScope.test.ts` | authRateLimitScope | `auth-rate-limit-scope.test.ts` |
| `workers/edge/authScheme.test.ts` | authScheme | `auth-scheme.test.ts` |
| `workers/edge/byokBudgetExemption.test.ts` | byokBudgetExemption | `byok-budget-exemption.test.ts` |
| `workers/edge/byokProbeAuth.test.ts` | byokProbeAuth | `byok-probe-auth.test.ts` |
| `workers/edge/catalogOutbound.test.ts` | catalogOutbound | `catalog-outbound.test.ts` |
| `workers/edge/containerEnv.test.ts` | containerEnv | `container-env.test.ts` |
| `workers/edge/containerRetry.test.ts` | containerRetry | `container-retry.test.ts` |
| `workers/edge/costBreaker.test.ts` | costBreaker | `cost-breaker.test.ts` |
| `workers/edge/dependabotWorkflow.test.ts` | dependabotWorkflow | `dependabot-workflow.test.ts` |
| `workers/edge/edgeGuard.test.ts` | edgeGuard | `edge-guard.test.ts` |
| `workers/edge/gatewayFallback.test.ts` | gatewayFallback | `gateway-fallback.test.ts` |
| `workers/edge/photoSearch.test.ts` | photoSearch | `photo-search.test.ts` |
| `workers/edge/rateLimiter.test.ts` | rateLimiter | `rate-limiter.test.ts` |
| `workers/edge/sessionMigration.test.ts` | sessionMigration | `session-migration.test.ts` |
| `workers/edge/testInventory.test.ts` | testInventory | `test-inventory.test.ts` |
| `workers/edge/turnstileArm.test.ts` | turnstileArm | `turnstile-arm.test.ts` |
| `workers/edge/turnstileReplay.test.ts` | turnstileReplay | `turnstile-replay.test.ts` |

### L1 symbols — apps/web (8)

| Site | Current | Proposed |
|---|---|---|
| `apps/web/src/features/shiori/ShioriGenerator.tsx:85` | `alive` (unmount guard) | `isAlive` |
| `apps/web/src/features/chat/use-turnstile-challenge.ts:22` | `live` (unmount guard) | `isLive` |
| `apps/web/src/features/maplibre/maplibreAdapter.ts:126,139,156,171` | `active` (class field) | `isActive` |
| `apps/web/src/features/maplibre/maplibreAdapter.ts:190` | `active` (`Attachment` interface field) | `isActive` |
| `apps/web/src/components/auth/useAuthCallback.ts:114` | `active` (unmount guard) | `isActive` |
| `apps/web/src/lib/auth/session.ts:37` | `active` (unmount guard) | `isActive` |
| `apps/web/tests/unit/chat/turnstile-photo-search.test.tsx:80,92` | `settled` | `wasSettled` |
| `apps/web/tests/integration/session-migration-on-login.test.ts:111` | `done` | `isDone` |

### L1 symbols — apps/agent (20)

Python bool params/vars — bare nouns, missing the is_/has_/verb-prefix
family (sites from `rg '\b<name>\s*:\s*bool\b'`):

| Site | Current | Proposed |
|---|---|---|
| `apps/agent/agent/agents/selection.py:180` | `success: bool` | `is_success` |
| `apps/agent/agent/agents/catalog_adapter.py:97` | `partial: bool = False` (function param feeding `SearchPayloadState.partial`, which stays L3) | `is_partial` |
| `apps/agent/agent/agents/agent_result.py:86` | `success: bool` | `is_success` |
| `apps/agent/agent/domain/fact_ledger.py:220` | `success: bool` | `is_success` |
| `apps/agent/agent/agents/tool_event_bridge.py:200,214` | `success: bool` | `is_success` |
| `apps/agent/agent/interfaces/anon_quota.py:50` | `exhausted: bool` | `is_exhausted` |
| `apps/agent/agent/interfaces/usage_metering.py:61` | `exhausted: bool` | `is_exhausted` |
| `apps/agent/agent/interfaces/routes/photo_search.py:154,169` | `authenticated: bool` | `is_authenticated` |
| `apps/agent/agent/interfaces/routes/photo_search_guards.py:103` | `authenticated: bool` | `is_authenticated` |
| `apps/agent/agent/interfaces/routes/byok.py:108` | `vision: bool` (`ProbeResult` field) | `has_vision` |
| `apps/agent/agent/tests/eval/direct_gates.py:92` | `enforced: bool` | `is_enforced` |
| `apps/agent/agent/tests/eval/trajectory_assertions.py:68` | `enforced: bool` | `is_enforced` |
| `apps/agent/agent/tests/eval/stats.py:188,205` | `increasing: bool` | `is_increasing` |
| `apps/agent/agent/tests/eval/eval_gate_flow.py:159,165` | `smoke: bool` | `is_smoke` |
| `apps/agent/agent/tests/eval/eval_gate_flow.py:181,266` | `capped: bool` | `is_capped` |
| `apps/agent/agent/tests/unit/test_eval_gate_equivalence.py:95` | `capped: bool` | `is_capped` |
| `apps/agent/agent/tests/eval/eval_harness.py:106` | `l3_on: bool` | `l3_enabled` (also drops `on` suffix) |
| `apps/agent/agent/tests/eval/eval_report.py:28` | `l3_on: bool` | `l3_enabled` |
| `apps/agent/agent/tests/integration/test_frontend_contracts.py:92` | `cur_event` | `current_event` (abbrev `cur`) |
| `apps/agent/agent/tests/atlas_helper.py:133` | `tmp_destination` | `temp_destination` (abbrev `tmp`; borderline — pytest-idiom) |

10 of the 20 are eval/test-only symbols — lowest risk batch. The rest are
production call-path params (no wire serialization). `session_state.py:98`
`partial` was removed from this list in round 2 — it is a persisted-model
field (see L3).

### L1 symbols — workers/edge (10)

| Site | Current | Proposed |
|---|---|---|
| `workers/edge/entry.test.ts:16` | `containerHit` (spy) | `wasContainerHit` |
| `workers/edge/entry.test.ts:37` | `catalogHit` (spy) | `wasCatalogHit` |
| `workers/edge/entry.test.ts:54` | `authCalled` (spy) | `wasAuthCalled` |
| `workers/edge/entry.test.ts:113` | `received` | `hasReceived` |
| `workers/edge/entry.test.ts:243,248,253` | `envVars` (local const) | `environmentVars` |
| `workers/edge/photoSearch.test.ts:41` | `envWith` (helper) | `environmentWith` |
| `workers/edge/entry.test.ts:47` | `envWithCatalog` (helper) | `environmentWithCatalog` |
| `workers/edge/entry.test.ts:141` | `envWithContainer` (helper) | `environmentWithContainer` |
| `workers/edge/containerEnv.test.ts:177` | `envVars` (local const) | `environmentVars` |
| `workers/edge/containerEnv.test.ts:183` | `envWithoutAppEnv` | `environmentWithoutAppEnv` |

(`entry.ts:37` `this.envVars` was removed from this list in round 2 — it is
`Container.envVars`, a platform contract property; see L3.)

---

## L2 — cross-package surface (needs consumer sweep before rename)

| Item | Site(s) | Why L2 (consumer sweep required) |
|---|---|---|
| `costBreaker.ts` → `cost-breaker.ts` | `workers/edge/costBreaker.ts` | Imported by path from `packages/contract/test/anon-limits.test.ts:12` (`fileURLToPath`). Sweep: that test + `packages/contract/src/error-registry.ts:23` comment. |
| `containerEnv.ts` → `container-env.ts` | `workers/edge/containerEnv.ts` | Read by path from `apps/agent/agent/tests/unit/test_deploy_model_env_consistency.py:13` and `test_secrets_docs_consistency.py:40`; listed in `.github/workflows/ci.yml:99` agent path filter. Sweep: both tests + CI filter + `wrangler.toml` comments (cosmetic). |
| `migrationBoundary.test.ts` → `migration-boundary.test.ts` | `workers/edge/migrationBoundary.test.ts` | Invoked by literal path in `.github/workflows/ci.yml:361` (`node --test workers/edge/migrationBoundary.test.ts`) and in the `migrations` path filter (`ci.yml:122`). Sweep: CI workflow. |

All three are single-consumer, mechanical sweeps. If a consumer outside the
listed packages appears before execution, re-tier to L3.

---

## L3 — external contract — default DO-NOT-CHANGE (owner adjudication)

### Wire/API/persisted/platform fields (real renames — adjudicate)

| Item | Site | Why external | Adjudication |
|---|---|---|---|
| `success` field | `apps/agent/agent/interfaces/schemas.py:126` (`PublicAPIResponse`) | Public HTTP response payload | Rename ⇒ API break. Needs deprecation/versioning decision. |
| `truncated` field | `apps/agent/agent/interfaces/chat_wire.py:102` (`_WireModel`) | SSE wire key consumed by `apps/web` | Keep; wire-format change requires apps/web + e2e sweep. |
| `partial` field | `apps/agent/agent/agents/tool_outcomes.py:46,52` (`SearchOk`/`SearchEmpty`) | Serialized via `model_dump(mode="json")` in `tool_event_bridge.py:240,274` into the tool-event stream | Verify consumer before touching; likely keep. |
| `partial` field | `apps/agent/agent/agents/session_state.py:98` (`SearchPayloadState`) | Persisted pydantic field on `_SessionModel` (`extra="forbid"`), round-tripped as `session_state_v2` in `session_facade.py:63-66` / `animichi_runner.py:114` | Rename breaks persisted sessions; versioned-state decision required. Matches `tool_outcomes.py` `partial` tiering. |
| `envVars` property | `workers/edge/entry.ts:37` (`RuntimeContainer.envVars`) | `Container.envVars` from `@cloudflare/containers` — the platform's env-injection contract (what gets injected into the container runtime) | Rename ⇒ container starts with wrong/empty env. Keep. |

### Framework/tool names (keep — listed for the record, not violations)

| Item | Site | Why keep |
|---|---|---|
| `configPath` | `workers/catalog/vitest.config.ts:19`, `workers/users/vitest.config.ts:6` | Vitest/`@cloudflare/vitest-pool-workers` option key |
| `tmp_path`, `tmp_path_factory` | 113 sites in `apps/agent` tests | pytest built-in fixtures |
| Migration files | `db/migrations/*.sql` | Atlas-generated timestamp_snake naming |
| `_dev` route group | `apps/web/src/routes/_dev/` | TanStack pathless route group |
| `env` prefix keys (`APP_ENV`, …) | `workers/edge` container env contract | Cross-worker env contract; sits on the `env` side of the allowlist line |

Verified compliant — no change required: `/v1/*` route paths (kebab), env var
keys (SCREAMING_SNAKE + domain prefix: `SUPABASE_*`, `MIMO_API_KEY`,
`E2E_WEB_BASE_URL`), DB tables (`locations`, `location_aliases`), Make targets
(kebab), workflow files and job names (kebab), stories (PascalCase).

---

## Proposed execution order (future cards)

| Card | Batch | Contents | Risk |
|---|---|---|---|
| G1-R1 | apps/web file renames (45) | 27 camelCase modules → kebab, 7 hooks → kebab, 4 component/provider files → PascalCase, 6 byokStorage tests → kebab, `_jpeg-fixtures.ts`; LSP rename, ~150 in-package import sites | L1, mechanical; verify with `make check` + `apps/web` unit suite |
| G1-R2 | apps/web boolean guards (8) | `isAlive`/`isLive`/`isActive` (×4)/`isDone`/`wasSettled` | L1, trivial; guards are hot paths — re-run stream tests |
| G1-R3 | apps/agent naming (21) | 20 Python bool params/abbrevs + `chat-wire-parser.ts` rename (+ `test_chat_wire_contract.py` invocation sites) | L1; 10/20 are eval/test-only; `make test` + `make test-eval` |
| G1-R4 | workers/edge file renames (24) | 4 modules + 20 test files → kebab; in-package LSP rename | L1; `pnpm run test:worker` + `node --test` lane |
| G1-R5 | workers/edge symbol renames (10) | `was*` spies, `hasReceived`, `environment*` helpers/locals | L1; same verification as R4 — can fold into R4 |
| G1-L2 | workers/edge L2 sweep (3) | `cost-breaker.ts` (contract test import), `container-env.ts` (agent path tests + CI filter), `migration-boundary.test.ts` (CI `node --test` path) | L2; sweep is 1-2 files each; run agent + contract + CI lanes |
| G2 | L3 adjudication (5 real) | `success`, `truncated`, `partial` (×2), `envVars` — wire version bump + apps/web sweep + e2e, or documented keep | Owner decision; not a mechanical card |

Order rationale: R1 first (largest surface, unlocks the conventions doc for
new code); R2/R3/R4/R5 independent of each other and of R1 — can run in
parallel after R1 lands; G1-L2 can ride along with R4 (same package) but must
touch the contract/agent/CI consumers explicitly. G2 is a decision card, not
a rename card.

---

## Self-consistency check

Every proposed name above was validated against `docs/naming-conventions.md`:

- Component/provider files: `ChatActions.tsx`, `ChatReturnTarget.tsx`,
  `AnimeRouteStates.tsx`, `RouteDetailStates.tsx` — `^[A-Z][A-Za-z0-9]*\.tsx$` ✓
- Hooks: `use-{auto-focus,recompute-turn,save-gate,theme,auth-callback,magic-link-form,spot-selection}.ts(x)` — kebab `use-*` ✓
- Other TS files: all 27 web + 4 edge module renames and 28 test renames are
  pure lowercase + `-` (domain terms kebab'd, not expanded: `byok-storage`,
  `neon-auth`, `maplibre-adapter`, `turnstile-arm`) ✓
- TS booleans: `isAlive`, `isLive`, `isActive`, `isDone`, `hasReceived`,
  `wasSettled`, `wasAuthCalled`, `wasCatalogHit`, `wasContainerHit` — is/has/was prefix ✓
- TS locals: `environmentVars`, `environmentWith`,
  `environmentWithCatalog`, `environmentWithContainer`,
  `environmentWithoutAppEnv` — camelCase, `env` expanded per allowlist rule ✓
- Python: `is_success`, `is_partial`, `is_exhausted`, `is_authenticated`,
  `is_enforced`, `is_increasing`, `is_capped`, `is_smoke`, `l3_enabled`,
  `has_vision`, `current_event`, `temp_destination` — snake_case + verb-prefix ✓
- Wire/persisted/platform names kept verbatim (`distance_m`, `point_ids`,
  `station_ids`, `partial`, `success`, `truncated`, `envVars`) — L3/exempt by
  the serialization-boundary carve-out ✓

No proposed name reintroduces an audited anti-pattern.

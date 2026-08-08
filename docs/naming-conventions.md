# Naming Conventions

Codified 2026-08-05 from a measured histogram of the tracked tree (see
`docs/naming-audit-2026-08-05.md` for the naming inventory). Rules below were
**measured, not invented** — where the repo was already dominant, the dominant
pattern won.

## Files and directories

| Artifact | Rule | Evidence (2026-08-05 scan) |
|---|---|---|
| TS/TSX directories | kebab-case | multi-word dirs: kebab wins (bubble-map, route-detail, map-spike) |
| Python directories | snake_case | chat_stream, eval_gate, neon_api (all under `apps/agent`) |
| React components / providers | `PascalCase.tsx` | 82 component PascalCase (91 incl. 9 stories) vs 7 non-conforming `.tsx` (6 component/provider + 1 hook — all in the audit inventory) |
| Hooks | `use-foo-bar.ts(x)` (kebab) | kebab hooks 28 vs camel hooks 7 |
| Test files | `kebab-case.test.ts(x)` | kebab 300 vs camel-base 27 (21 `workers/edge` + 6 `byokStorage*` in web) |
| Story files | `ComponentName.stories.tsx` | 9/9 PascalCase base |
| Other TS modules | kebab-case | multi-word non-test `.ts` modules: kebab 79 vs camel 40 |
| Python modules / functions / vars | snake_case | 396 snake, 0 uppercase, 0 dash |
| Python classes | PascalCase | 395/395 |
| TS symbols (vars, functions, local fields) | camelCase | 3 snake-case local declarations found (`distance_m` spots.ts:93, `station_ids` dijkstra.ts:38, `point_ids` test-only) — all wire-payload keys, exempt per the carve-out below; wire-mirror interface/zod fields excluded from this row |

Serialization-boundary carve-out (audit-relevant, measured from the same scan):

- **Wire/DB payload keys stay snake_case** — they mirror the DB domain
  (`distance_m`, `point_ids`, `station_ids` in object-shorthand return
  payloads and request bodies are NOT violations). Wire-mirror interface and
  zod fields (e.g. `total_distance_m`, `name_cn`, `bangumi_id` in
  `workers/catalog/src/types.ts` and `packages/contract`) are out of scope
  for the TS-symbols row: they mirror the wire contract, not local
  identifiers.
- **Persisted-model fields and platform properties are out of scope** — a
  pydantic field on a persisted/wire model, and a property supplied by a
  platform contract (`Container.envVars` from `@cloudflare/containers`),
  keep their names; they are tiered L3 (external contract) in the audit, not
  renamed.

Exceptions (framework/tool conventions, not violations):

- TanStack Router files: `routes/__root.tsx`, `routes/index.tsx`, `$param.tsx`
  segments, and pathless route groups (`routes/_dev/`).
- Underscore-prefixed files under `tests/` (`_fixtures.ts`, `_chat-page.tsx`)
  are vitest helper modules — excluded from test discovery by design.
- `__snapshots__/` dirs and `*.snap` (vitest-generated).
- `migrations/neon/` Atlas-generated files (timestamp_snake_case).
- Established domain terms used as-is (measured dominant usage, repo-wide):
  `byok`, `shiori`, `turnstile`, `maplibre` — kebab them like any word
  (`byok-storage.ts`, `maplibre-adapter.ts`), but never expand them.

## Semantic rules (identifiers)

- **Booleans read as a question.** Prefix with `is`/`has`/`can` (TS:
  `isOpen`, `hasQuota`, `canStream`), `was` for historical-result flags
  (`wasSettled`, `wasAuthCalled`), or a verb flag (Python: `include_debug`,
  `verify_identity`, `is_byok` — the measured dominant family in
  `apps/agent`). Bare nouns/adjectives (`success`, `partial`, `active`,
  `done`) are violations.
- **Event handlers** — TS props: `on*` (`onClick`, `onRetry`, measured 51/51
  of the top props); Python: `handle_*` (measured 12 vs 3 `on_*`).
- **Collections are plural** (`spots: Spot[]`, not `spot`).
- **No abbreviations in two-word names.** Allowlist: `id`, `url`, `db`, `api`,
  `i18n`, `e2e`. Banned: `env`→`environment`, `usr`→`user`, `msg`→`message`,
  `btn`→`button`, `img`→`image`, `cur`→`current`, `tmp`→`temp`.

## Naming domains

| Domain | Convention | Example |
|---|---|---|
| HTTP routes (workers `/v1/*`, web routes) | kebab-case | `/v1/photo-search`, `routes/routes/$routeId` |
| Env var keys | SCREAMING_SNAKE with domain prefix | `SUPABASE_DB_URL`, `E2E_WEB_BASE_URL`, `MIMO_API_KEY` |
| DB tables / columns | snake_case | `locations`, `location_aliases` |
| Make targets | kebab-case | `db-push-dry`, `dev-local`, `e2e-setup` |
| GH workflow files | kebab-case | `reusable-cross-stack-e2e.yml` |
| GH workflow job names | kebab-case | `agent-eval-full` |
| Wrangler bindings / route names | kebab-case | `catalog`, `photo-search` |

## Tiering (how the audit classifies violations)

| Tier | Meaning | Action |
|---|---|---|
| L1 | Internal-only — no cross-package imports, local symbols | Safe LSP rename in a future card |
| L2 | Cross-package surface (imported by another package, read by path from another package or CI, referenced by CI path filters) | Needs consumer sweep before rename |
| L3 | External contract — wire/API fields, persisted-model fields, env keys, platform properties, DB names, Make targets, wrangler names | Default DO-NOT-CHANGE; owner adjudication |

## Enforcement

`make check` (ruff + vulture + mypy + pytest — the apps/agent Python chain
only; the target runs no TS linting) does not yet enforce naming; the audit
doc lists the rename batches that future cards should apply. New code: follow the table
above; when in doubt, match the adjacent files.

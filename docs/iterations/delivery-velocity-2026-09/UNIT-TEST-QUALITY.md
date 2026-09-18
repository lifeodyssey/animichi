# Unit-test code quality review — `lifeodyssey/animichi`

Worktree `/Users/lumimamini/orca/workspaces/Seichijunrei-agent/orca-testreview-main` @ `046c5ae90`.
Read-only; nothing was run. Judgement is on the **code** of the unit tests.

**Verdict up front.** The owner's framing — "cases crammed together, tests that don't really test
anything" — is **mostly not supported** at the level of test shape. 92% of `apps/web` unit tests
assert a value or drive an interaction; `it.each` is used in 105 files; `any` appears 0 times;
suppressions 0; `.skip`/`.todo` 0; ≤5-mocks is respected almost everywhere; several suites reason
explicitly about mutation sensitivity in their own comments. The real weaknesses are different and
narrower, and they are where I would spend effort:

1. **678 of 4,549 tests (15%) assert on the text of checked-in files**, not on runtime behaviour.
2. **Nothing in `apps/web` pins what any button actually says** — 120 test files assert the rendered
   output against the app's own dictionary, and the one dictionary test only checks `length > 0`.
3. A handful of genuinely vacuous tests, all in one place: the state-ownership allowlist tests.
4. A cramming tail: ~20 tests carry 8–29 assertions and names with three conjunctions.

---

## Scope and method

Derived from each package's `test` / `test:worker` / `test:unit` script and its vitest `include`,
**excluding every glob a `test:integration` script runs** and excluding `e2e/`. Concretely:

| Package | Glob taken | Excluded as integration |
|---|---|---|
| `apps/web` | `tests/unit/**/*.test.ts{,x}` (`vitest.config.ts:12`) | `vitest.integration.config.ts` |
| `workers/catalog` | `test/**/*.worker.test.ts` | `*.integration.test.ts` |
| `workers/edge` | `test/*.test.ts` + `bundle-smoke/*.test.ts` | `agent-db-test/`, `admission-test/`, `selection-test/`, `host-integration-test/`, `api-test/` |
| `workers/users` | `test/**/*.worker.test.ts` | — |
| `workers/migrator` | `test/**/*.test.ts` | `test/integration/` |
| `packages/agent` | `test/*.test.ts` | `integration-test/` |
| `packages/contract` | `test/**/*.test.ts` | — |
| `packages/eval` | `test/*.test.ts` | — |
| `packages/prisma-geography`, `pi-session-neon` | `test/*.unit.test.ts`, `contract-types.test.ts` | `*.db.test.ts` |
| `packages/test-postgres` | `test/*.test.ts` | `test/integration/` |
| `infra` | `topology-*.test.ts` | — |

**738 files, 4,549 tests, 60,106 lines.** File list: `/private/tmp/animichi-research/_files.txt`;
scripts: `_scope.sh`, `profile.py`, `pertest.py`, `textmeta.py`, `classify.py` in the same directory.
Metrics are static (regex over test bodies); every finding below was then opened and read.

## Quantitative profile

| package | files | tests | lines | asserts/test | mocks/test | files >200L | `if`/`try` in test | `any` | suppress | `.skip` | snapshot | real sleep |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| apps/web | 331 | 2176 | 25,882 | 2.0 | 0.3 | 3 | 2 | 0 | 0 | 0 | 0 | 4 |
| workers/edge | 111 | 666 | 10,138 | 2.3 | 0.0 | 3 | 10 | 0 | 0 | 0 | 0 | 0 |
| workers/catalog | 86 | 619 | 8,653 | 1.9 | 0.2 | 2 | 7 | 0 | 0 | 0 | 1 | 0 |
| packages/agent | 55 | 137 | 2,394 | 3.0 | 0.1 | 0 | 12 | 0 | 0 | 0 | 0 | 2 |
| packages/eval | 43 | 247 | 3,615 | 2.4 | 0.0 | 0 | 14 | 0 | 0 | 0 | 0 | 0 |
| workers/migrator | 31 | 177 | 2,360 | 2.0 | 0.2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| packages/contract | 30 | 254 | 2,989 | 1.7 | 0.0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| infra | 18 | 85 | 1,452 | 2.3 | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| workers/users | 15 | 97 | 1,390 | 1.7 | 0.0 | 1 | 1 | 0 | 0 | 0 | 0 | 1 |
| prisma-geography | 9 | 50 | 565 | 1.4 | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| test-postgres | 6 | 32 | 537 | 1.9 | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| pi-session-neon | 3 | 9 | 131 | 2.2 | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **TOTAL** | **738** | **4,549** | **60,106** | **2.0** | **0.2** | **9** | **46** | **0** | **0** | **0** | **2** | **7** |

Longest file per package: `workers/edge/test/staging-baseline-reset.test.ts` 272L ·
`workers/users/test/save-saved-route-idempotent.worker.test.ts` 257L ·
`apps/web/tests/unit/chat/turnstile-gate.test.tsx` 224L ·
`workers/catalog/test/geocode-place.worker.test.ts` 208L · `packages/contract/test/vet-gate.test.ts` 200L.
Nine files exceed the ≤200-line rule; the worst overshoot is 36%.

Distribution: median 2 assertions/test; 2,029 tests (45%) have exactly one; 122 have ≥6; 41 have none
(38 of those delegate to a named assertion function — see below). Only **one** test has >5 inline
mocks. `it.each`/`test.each` appears at 187 call sites across 105 files.

**`apps/web` test-shape classification** (2,166 tests; `classify.py`):

| kind | count | share |
|---|---|---|
| asserts a value (`toBe`/`toEqual`/`toContain`/attribute/throw) | 1,551 | 72% |
| drives an interaction then asserts (`fireEvent`/`act`/`rerender`) | 425 | 20% |
| render-smoke (presence-only after a render) | 106 | 5% |
| mock-wiring only | 71 | 3% |
| no inline assertion | 13 | 1% |

The 106 "render-smoke" are mostly `accessibility/accessible-names.test.tsx` and `live-regions.test.tsx`
— accessible-name/ARIA-role contracts, which is a real user-visible contract, not a smoke test.
**The number of `apps/web` tests is carrying its weight at the shape level.**

## Vacuous or implementation-restating tests

### 1. The state-ownership allowlist tests assert the test's own constant — genuinely vacuous

`apps/web/tests/unit/state-ownership/architecture.test.ts:52-64`:

```ts
  it("keeps the map-primitive allowlist scoped to the #842 shared map family", () => {
    for (const edge of MAP_PRIMITIVE_EDGES) { ... expect(target.startsWith("features/")).toBe(true);
  it("the map-primitive allowlist is a named, documented, reviewable set", () => {
    expect(MAP_PRIMITIVE_EDGES.length).toBeGreaterThan(0);
    expect(new Set(MAP_PRIMITIVE_EDGES).size).toBe(MAP_PRIMITIVE_EDGES.length);
```

`MAP_PRIMITIVE_EDGES` is a literal array declared in the suite's own helper
(`apps/web/tests/unit/state-ownership/checker.ts:54`). **No mutation anywhere in `apps/web/src` can
turn these red.** They assert that a hand-written array in the test folder is non-empty and has no
duplicates. The sibling test on line 39 (`expect(dependencyViolations(SRC)).toEqual([])`) is the
real gate; these three are decoration. Same file also calls `vi.useFakeTimers()`
(`architecture.test.ts:29-32`) for a suite that never reads a clock.

### 2. `chat/i18n.test.ts` — 28 assertions that prove only "non-empty"

`apps/web/tests/unit/chat/i18n.test.ts:6-37` runs `it.each(LOCALES)` with 28 assertions, every one of
the form:

```ts
    expect(dict.inputPlaceholder.length).toBeGreaterThan(0);
    expect(dict.busyPlaceholder.length).toBeGreaterThan(0);
    expect(dict.send.length).toBeGreaterThan(0);
```

Mutation that goes unnoticed: change `dict.send` from `"送信"` to `"x"`, or **swap `dict.send` and
`dict.retry`** — every assertion still passes. The keys' existence is already guaranteed by the
dictionary's type, so the only added information is `length > 0`. 84 assertion executions, ~1 bit of
signal. `chat/save-copy-i18n.test.ts:67-78` repeats the shape (`length > 0` plus a
`new Set(...).size === 3` distinctness check, which catches an all-locales-identical mutation but not
a single-key one).

### 3. …and no test pins what a button says

120 of 331 `apps/web` test files import the app's own dictionary and assert the render against it —
`apps/web/tests/unit/chat/route-card-layout.test.tsx:60`,
`apps/web/tests/unit/chat/draft-adjustment.test.tsx:92`,
`apps/web/tests/unit/chat/session-expired-presentation.test.tsx:22,41`:

```ts
    expect(screen.getByRole("button", { name: dict.route.saveCta })).toBeTruthy();
```

Both sides move together. Combined with finding 2, the standing mutation is: **edit one string in
`chat-dict.ts` to `"x"` and the entire 2,176-test `apps/web` suite stays green.** Only 38 files use a
hard-coded accessible name (e.g. `home/home-route.test.tsx:35`, `shiori/poster-fallback.test.tsx:18`),
so the repo already contains both conventions and has not chosen.

### 4. 15% of all tests assert on file text, not behaviour

| package | text-asserting files | share of files | share of tests | share of asserts |
|---|---|---|---|---|
| packages/test-postgres | 3 | 50% | 44% | 49% |
| prisma-geography | 3 | 33% | 34% | 19% |
| infra | 4 | 22% | 15% | 16% |
| workers/edge | 23 | 21% | 20% | 19% |
| packages/contract | 5 | 17% | 23% | 22% |
| packages/eval | 7 | 16% | 19% | 21% |
| apps/web | 44 | 13% | 16% | 16% |
| **TOTAL** | **96** | **13%** | **678 tests (15%)** | **14%** |

Two very different things are inside that number and they deserve opposite treatment:

- **Deploy-config contracts are legitimate** — `workers/edge/test/agent-database-binding.test.ts`,
  `wrangler-toml.test.ts`, `infra/topology-*.test.ts`. There is no other seam: wrangler resolves the
  binding at deploy time. The header comment of `agent-database-binding.test.ts:1-22` argues the case
  well and even tags itself `test-type: unit`. Keep.
- **CSS and source-grep literals restate the implementation.** `apps/web/tests/unit/shiori/shiori-css.test.ts:24-33`:

  ```ts
    expect(ruleDeclaration(css, ".shiori-window", "border-radius")).toBe("50px");
    expect(ruleDeclaration(css, ".shiori-window", "font-weight")).toBe("900");
    expect(ruleDeclaration(generatorCss, ".shiori-generator__completion", "padding")).toBe("3px 10px");
  ```

  The SUT is a `.css` file and the expectation is a copy of it. It cannot fail for any reason a user
  would notice: apply the wrong class in the component and it stays green; change `50px` to `9999px`
  (visually identical pill) and it goes red. 34 `apps/web` files import stylesheets/components
  `?raw`, carrying 516 assertions. The token-contrast subset
  (`design-token-contrast.test.ts`, `chat/appbar-css.test.ts:58-60` computing WCAG ratios) is the
  defensible part — it asserts a *derived property*, not a literal.

### 5. Not vacuous, despite looking so

38 of the 41 zero-assertion tests delegate to a named assertion function and are fine — this is the
naming rule working. `apps/web/tests/unit/lib/runtime-config/runtime-config.test.ts:26-28`
(`rejectsWith`, commented "Conditional-free rejection helper"),
`workers/catalog/test/series.worker.test.ts:72` (`assertSameSeriesRelations`),
`packages/prisma-geography/test/contract-types.unit.test.ts` (`assertCompileFailure` with a specific
`TS2339` message per case). Also `expect(screen.getByRole(...)).toBeTruthy()` (433 occurrences) is
**redundant, not vacuous** — `getBy*` throws on absence, so the presence check is real. I checked for
the genuinely broken form `expect(screen.queryBy…).toBeDefined()` (which always passes, since
`queryBy` returns `null`): **zero occurrences.**

## Over-mocking

Mock density is low: 0.2 mocks/test repo-wide; `workers/edge` (111 files), `packages/eval`,
`packages/contract`, `infra` use **none**; `packages/agent` uses real harness + real session store
with only a faux model provider. Only one test exceeds 5 inline mocks.

One real evasion: four catalog cron files build an **11-mock `CronDependencies` object per test**
inside a shared factory, so the per-test mock count is 11 everywhere while a line-level counter sees
one call.

| file | mocks in factory | tests |
|---|---|---|
| `workers/catalog/test/daily-snapshot.worker.test.ts:28-46` | 11 | 7 |
| `workers/catalog/test/cron.worker.test.ts` | 11 | 13 |
| `workers/catalog/test/cron-logging.worker.test.ts` | 11 | 4 |
| `workers/catalog/test/schedule-guard.worker.test.ts` | 11 | 14 |

Mitigating: `daily-snapshot.worker.test.ts:38-41` wires the two *interesting* seams to the **real**
`publishSnapshot`/`gcSnapshots` against an in-memory store, so the test still exercises behaviour.
The other nine mocks are inert scaffolding required by the `CronDependencies` interface — the smell is
in the 11-member dependency interface, not in the test.

Mock-assertion-only tests (118 repo-wide, 99 in `apps/web`) are mostly legitimate: in
`apps/web/tests/unit/chat/use-stream-recovery.test.tsx` the hook's *entire* observable behaviour is
which collaborator it calls, and every test pairs a positive with a negative
(`expect(chat.regenerate).toHaveBeenCalledTimes(1); expect(chat.resumeStream).not.toHaveBeenCalled();`
at `:17-18`) — that is mutation-sensitive in both directions. I found no directory where every
collaborator is a mock and only wiring is tested.

## Worst offenders

| # | Location | Problem | Fix |
|---|---|---|---|
| 1 | `apps/web/tests/unit/state-ownership/architecture.test.ts:52-64` | 3 tests assert the suite's own constant; no `src/` mutation can fail them | Delete; keep `:39` |
| 2 | `apps/web/tests/unit/chat/i18n.test.ts:6-37` | 28 × `length > 0`; a key swap survives | Replace with one test asserting the actual ja/zh/en strings for the ~6 keys users act on |
| 3 | `apps/web/tests/unit/shiori/shiori-css.test.ts` (21 tests, 54 asserts) + `route-detail-css.test.ts`, `chat/card-language-css.test.ts`, `card-plane-css.test.ts`, `press-3d-css.test.ts` | Assert CSS literals copied from the sheet | Keep only derived-property tests (contrast, token-only); the rest belongs to Storybook/visual review |
| 4 | `apps/web/tests/unit/chat/session-expired-presentation.test.tsx:38-65` | 15 assertions, 5 events, 3 rerenders in one test named with three conjunctions; `:13,21,39` stack 2-3 statements per line | Split into "announces recovering status", "blocks both actions while recovering", "restores focus to resume" |
| 5 | `apps/web/tests/unit/chat/byok-storage-source-guard.test.ts:79-82` | `for` loop + `expect(a \|\| b).toBe(true)` — on failure you learn neither which module nor which half | `it.each(STORAGE_MODULES)` asserting the path matches one regex |
| 6 | `workers/catalog/test/{daily-snapshot,cron,cron-logging,schedule-guard}.worker.test.ts` | 11 mocks in scope per test (rule: ≤5) | Split `CronDependencies` (ingest / publish / import) so each test names ≤5 real seams |
| 7 | `apps/web/tests/unit/chat/use-chat-session-state.test.tsx:42`, `auth/use-auth-callback.test.tsx:172`, `chat/save-gate-failures.test.tsx:51`, `chat/basemap-mount-failure.test.tsx:38` | Real `setTimeout` sleeps (10–25 ms) — timing-dependent, violates "mock the clock" | `vi.useFakeTimers()` + `advanceTimersByTime`, as 50 other files already do |
| 8 | `apps/web/tests/unit/msw/in-flight-drain.test.ts:39-52` | Test 2 consumes a promise test 1 pushed into a module-level array — order-dependent | Order-dependence is arguably the SUT here (cross-case leakage); at minimum name the pair so a reorder fails loudly |
| 9 | `apps/web/tests/unit/chat/waiting-ritual.test.tsx:83` | `it("works before user-message data is available")` — the only non-behavioural name in 4,549 | Rename to the behaviour |
| 10 | Repo-wide: 220 type escapes (`as unknown as` ×151, `as never` ×69), worst `workers/edge/test/gateway-request.test.ts` (7) | `No Any` satisfied by letter, evaded in spirit; a wrong-shaped env double passes typecheck and lies at runtime | Build typed env/DO doubles once per worker package and forbid the casts in test dirs |

## The model to copy

**`workers/edge/test/session-adopt-boundary.test.ts`** (145 lines, 11 tests, zero mocks). It:

- names one extracted assertion after the proposition — `assertRejectedBeforeWrite(request, status, caller)`
  — and asserts **two** things per call (`response.status` and `writes.count === 0`), so "refused"
  and "refused *before writing*" are separate falsifiers;
- builds one named caller per *conjunct* of the check under test
  (`UNPREFIXED_ANONYMOUS_CALLER`, `ANON_PREFIXED_HUMAN_CALLER`, `EMPTY_USER_ID_CALLER`, `:23-28`)
  instead of one "invalid" caller that any conjunct could refuse;
- **states its mutation argument in the file** (`:118-123`): "Each test below is refusable only by its
  own conjunct: deleting that conjunct turns the named test red at the status assertion and at the
  store-write count."

Runner-up: **`packages/agent/test/`** (55 files, 0 `vi.mock`) — real harness, real session store, a
faux model provider only, and assertions on the actual prompt text including prompt-injection
sanitisation (`native-status-context.test.ts:34-39`). Runner-up for readability:
`apps/web/tests/unit/lib/runtime-config/runtime-config.test.ts` — one `PROD` canonical instance,
`rejectsWith` naming the proposition, `it.each` for the site-key variants.

## Against our own rules

| Rule | Status |
|---|---|
| ≤200 lines per test file | **9 violations** (272L worst) — 1.2% of files |
| ≤5 mocks per test | **~38 tests** violate via an 11-mock shared factory; 1 inline violation |
| No conditional logic in tests | 46 tests contain `if`/`try`; most are inside doubles or `try/finally` cleanup. Real violations are few; `byok-storage-source-guard.test.ts:81` is the clearest |
| Mock the clock | Held (50 files use fake timers); **7 real-sleep violations** |
| No `any` / no suppressions | **Clean.** 0 `any`, 0 disables. The 6 `@ts-expect-error` are in `*.type-test.ts` where removing the directive *is* the assertion (`workers/edge/test/turn-answer-part.type-test.ts:27-37`) — correct use |
| No `.skip`/`.todo` | **Clean — zero** |
| No unread snapshots | **Clean** — 2 `toMatchInlineSnapshot`, no `__snapshots__` dirs |
| Name by SUT | **179/331 (54%)** of `apps/web` unit test files have no same-named source module. Named per-AC/per-card (`anime-route-defense`, `hydration-no-double-fetch`, `orpc-ssr-isolation`). Cost: only 2 files import `ChatPage` but 167 import something under `src/features/chat/` — you cannot find a module's tests from its name |
| No `helper`/`util`/`setup` names | 3 `*.helpers.ts` (`packages/contract/test/oidc-github.helpers.ts`, `workers/migrator/test/{http-apply,migrate.worker}.helpers.ts`), 2 `function setup()` (`workers/users/test/{route-mutations,worker}.worker.test.ts`), generic `_factories.ts`/`_actions.ts`/`_render.tsx` under `apps/web/tests/unit/` |
| Fixtures before builders (`test.extend`) | **`test.extend` used 0 times.** 42 `make*` builders + `*-fixture.ts` modules — the rule's *second* choice used exclusively. Low harm |
| Parametrize instead of copy-paste | Largely held (187 `it.each` sites). Exceptions: `packages/agent/test/native-web-search-refusal.test.ts:27-37` (3 copies differing only by status code), `packages/prisma-geography/test/contract-types.unit.test.ts:23-65` (10 near-identical) |
| Line stacking to fit ≤200 | 86 instances (38 `;`-joined, 48 comma-chained `const`), concentrated in `apps/web/tests/unit/chat/*-presentation.test.tsx` |

## Recommendation

Ordered by signal recovered per hour. Each is one card.

1. **Pin the user-visible copy once.** Replace `chat/i18n.test.ts:6-37` and
   `chat/save-copy-i18n.test.ts:67-73` with a test asserting the literal ja/zh/en strings for the keys
   users act on (send, retry, saveCta, login, resume). *AC: changing any one of those strings in
   `chat-dict.ts` turns exactly one named test red.*
2. **Delete the three allowlist tests** (`state-ownership/architecture.test.ts:52-64`) and the
   `vi.useFakeTimers` block at `:29-36`. *AC: the file's remaining tests still fail when a reverse
   import is added to `src/`, and no test references `MAP_PRIMITIVE_EDGES` except through
   `dependencyViolations`.*
3. **Retire the CSS-literal tests**, keeping only derived-property checks (contrast ratios, token-only
   greps): `shiori/shiori-css.test.ts`, `route-detail/route-detail-css.test.ts`,
   `chat/card-language-css.test.ts`, `card-plane-css.test.ts`, `press-3d-css.test.ts`,
   `chat/chat-bubble-css.test.ts`, `chat/chat-chip-css.test.ts`, `chat/composer-pill-css.test.ts`.
   *AC: no assertion in `apps/web/tests/unit` compares a CSS declaration to a literal length, colour
   or radius; the contrast and token-only tests remain.*
4. **Fake the clock in the 7 real-sleep tests.** *AC: `grep -rn "setTimeout(resolve" apps/web/tests/unit
   workers/*/test` returns nothing outside deliberate deadline doubles.*
5. **Split `CronDependencies`** into ingest / publish / import groups so the four catalog cron files
   name ≤5 seams per test. *AC: no test file constructs more than 5 `vi.fn()` in one factory.*
6. **Split the four crammed presentation tests** (`session-expired-presentation.test.tsx:38`,
   `budget-presentation.test.tsx:33`, `quota-presentation.test.tsx:23`,
   `stream-interruption-presentation.test.tsx:12`) and unstack their multi-statement lines.
   *AC: no test in `apps/web/tests/unit/chat` carries more than 8 assertions, and no test name
   contains two conjunctions.*
7. **Ban type escapes in test directories.** Build one typed env/DO double per worker package.
   *AC: `as unknown as` and `as never` appear 0 times under `workers/*/test` and `apps/web/tests`.*
8. **Bring the 9 over-length files under 200 lines by splitting on behaviour**, not by stacking lines
   (per `feedback_line_limits_via_design_not_trimming`). *AC: every file in scope ≤200 lines and no
   new `;`-joined statement lines in the diff.*
9. **Adopt `session-adopt-boundary.test.ts` as the reviewer's reference.** Require new suites to state,
   in the file, which mutation each test kills. *AC: `docs/testing-strategy.md` names that file and the
   card template asks for the mutation sentence.*

Not recommended: a mass rename of the 179 topic-named `apps/web` files. The naming is a real
navigation cost, but a rename touches every file in the largest suite for no behavioural gain — fold
it into whatever card next rewrites a feature's tests.

---
Report: `/private/tmp/animichi-research/unit-test-quality.md`

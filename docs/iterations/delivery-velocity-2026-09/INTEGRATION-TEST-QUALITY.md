# Integration-test code quality — `lifeodyssey/animichi` @ `046c5ae90`

Read-only review of the **code** of every integration-style test in the repo. Nothing was run.
Worktree: `/Users/lumimamini/orca/workspaces/Seichijunrei-agent/orca-testreview-main`.

**Verdict on the standing claim ("many separate cases crammed into a single test"): true, but
local.** Across 139 files / 12 445 lines / **555 test cases / 1 891 assertions**, 58 % of cases
carry ≤2 assertions and the median case body is 8 lines. Only **81 cases (15 %) exceed 5
assertions, 18 exceed 10, and 3 exceed 20**. Those 18 are not spread evenly: 13 of them sit in
`workers/edge/host-integration-test` + `workers/edge/admission-test`, 2 more in
`packages/agent/integration-test`. In `workers/catalog` (131 cases, 2.3 asserts/case) and
`workers/users` (94 cases, 1.7) the claim is simply **not true** — those suites are fine.

---

## The integration suites (script → files)

| Package | Script | Files it runs |
|---|---|---|
| `workers/edge` | `test:integration` = `test:agent-db` + `test:native-admission` + `test:selection` + `test:native-host` | `agent-db-test/*.test.ts` (6), `admission-test/*.test.ts` (8), `selection-test/*.test.ts` (3), `host-integration-test/*.test.ts` (15) |
| `workers/edge` | `test` → `test:bundle-smoke` | `bundle-smoke/*.test.ts` (10) |
| `workers/edge` | `test:catalog-api` | `api-test/*.test.ts` (4) — deliberately opt-in staging lane (`workers/edge/AGENTS.md:34`), not in `test`/`test:integration` |
| `workers/edge` | `test:native-browser` | `host-integration-test/*.browser.ts` (2) — invoked from `e2e`'s `test` |
| `workers/catalog` | `test:integration` | `test/*.integration.test.ts` (25); `vitest.integration.config.ts` boots Docker Postgres+PostGIS in `globalSetup`, `fileParallelism: false` |
| `workers/users` | **none** | 15 `test/**/*.worker.test.ts` under `@cloudflare/vitest-pool-workers` against `test/in-memory-routes-db.ts`. No Postgres anywhere in this package — it is a unit suite by construction |
| `workers/migrator` | `test:integration` | `test/integration/*.integration.ts` (5 test files + 8 support files) |
| `packages/agent` | `test:integration` | `integration-test/{catalog,web,translation,translation-interruption}.test.ts` (4) |
| `packages/pi-session-neon` | `test:integration` | 13 `*.db.test.ts` **+ 2 `*.unit.test.ts`** |
| `packages/prisma-geography` | `test:integration` | 1 `*.db.test.ts` **+ 9 `*.unit.test.ts`** (the same 9 also run under `test`) |
| `packages/test-postgres` | `test:integration` | `test/integration/shared-container.test.ts` (1) |
| `packages/eval` | — | **no integration lane exists**; every `test/*.test.ts` is in-memory (`MemorySessionRepo`, `fauxProvider`). Out of scope, correctly so |
| `apps/web` | `test:integration` | `tests/integration/*.test.ts` (6), `globalSetup` builds the real Nitro output |
| `e2e` | `test` | 12 `*.spec.ts` + `lane-port.test.ts` + `helpers/neon-auth-origin.test.ts` + edge `test:native-browser` |

---

## Quantitative profile

Per suite (stacked = extra statements past the first on one line, type literals excluded):

| Suite | files | lines | cases | asserts | a/case | >5a | >10a | stacked | try/finally bodies |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `edge/host-integration-test` | 17 | 1 198 | 33 | 329 | 10.0 | 23 | 8 | **25** | 4 |
| `edge/admission-test` | 8 | 621 | 26 | 190 | 7.3 | 15 | 5 | 5 | **23** |
| `edge/selection-test` | 3 | 170 | 10 | 56 | 5.6 | 5 | 1 | 0 | 2 |
| `edge/bundle-smoke` | 10 | 610 | 26 | 112 | 4.3 | 4 | 2 | 4 | 0 |
| `edge/agent-db-test` | 6 | 348 | 20 | 81 | 4.0 | 3 | 0 | 2 | 3 |
| `edge/api-test` | 4 | 356 | 13 | 28 | 2.2 | 0 | 0 | 0 | 0 |
| `packages/agent` | 4 | 250 | 6 | 55 | 9.2 | 5 | 2 | **29** | 0 |
| `migrator integration` | 5 | 474 | 19 | 96 | 5.1 | 7 | 0 | 3 | 0 |
| `catalog integration` | 25 | 2 904 | 131 | 307 | 2.3 | 3 | 0 | 2 | 0 |
| `pi-session-neon` | 15 | 709 | 58 | 125 | 2.2 | 3 | 0 | 4 | 0 |
| `users worker` | 15 | 1 390 | 94 | 164 | 1.7 | 0 | 0 | 0 | 0 |
| `apps/web integration` | 6 | 628 | 24 | 50 | 2.1 | 1 | 0 | 0 | 0 |
| `e2e` | 19 | 2 485 | 85 | 273 | 3.2 | 16 | 0 | 0 | 0 |
| `prisma-geography` / `test-postgres` | 2 | 302 | 10 | 25 | 2.5 | 1 | 0 | 0 | 0 |

Assertion distribution (555 cases): ≤2 → 323 (58 %) · 3–5 → 151 (27 %) · 6–10 → 63 (11 %) ·
11–20 → 15 (3 %) · >20 → 3 (1 %).

Statement stacking repo-wide: **74 extra statements on 68 lines**, of which **68 are in 5 files**
(`reattach-contention.test.ts` 20, `agent/integration-test/web.test.ts` 16,
`translation-interruption.test.ts` 7, `agent/integration-test/catalog.test.ts` 5, rest ≤3).

Notable files:

| File | lines | cases | asserts | a/case | stacked | forbidden shapes |
|---|---:|---:|---:|---:|---:|---|
| `workers/edge/host-integration-test/reattach-contention.test.ts` | 88 | 1 | 39 | 39.0 | 20 | try/finally, `if`, `>=`, swallow, `?.`×5 |
| `workers/edge/admission-test/persistence-order.test.ts` | 62 | 1 | 24 | 24.0 | 2 | try/finally, swallow×2, `?.`×10 |
| `workers/edge/host-integration-test/interleaving.test.ts` | 83 | 1 | 27 | 27.0 | 1 | try/finally, `>=`, swallow |
| `workers/edge/host-integration-test/reconnect-during-drive.test.ts` | 56 | 1 | 18 | 18.0 | 0 | try/finally, `?.`×3 |
| `workers/edge/bundle-smoke/tool-replay-recovery.test.ts` | 79 | 1 | 17 | 17.0 | 1 | — |
| `workers/edge/host-integration-test/default-host.test.ts` | 107 | 4 | 42 | 10.5 | 0 | try/finally×2, `?.`×10 |
| `packages/agent/integration-test/web.test.ts` | 87 | 2 | 21 | 10.5 | **16** | `>=`×2 |
| `workers/edge/host-integration-test/policies.test.ts` | 58 | 2 | 20 | 10.0 | 0 | try/finally, `?.`×6 |
| `workers/edge/admission-test/admit.test.ts` | 112 | 7 | 36 | 5.1 | 0 | try/finally ×7 |
| *contrast:* `packages/pi-session-neon/test/repo.db.test.ts` | 53 | 5 | 10 | 2.0 | 0 | none |
| *contrast:* `workers/users/test/routes-api.worker.test.ts` | 116 | 9 | 15 | 1.7 | 0 | none |

### Diagnosability

Of 866 `node:assert` calls in the Node-based suites, roughly **24 % carry a message**; by suite:
`bundle-smoke` 45 %, `admission-test` 32 %, `host-integration-test` 21 %,
`agent-db-test` 15 %, `pi-session-neon` 14 %, `packages/agent` 11 %. In the long cases the
messages are missing exactly where they are most needed:
`reattach-contention.test.ts:54-57` fires eight bare `assert.equal(final.X, 1)` in a row against
a JSON counter object, so failure #17 prints `1 !== 0` with no indication of which stage of a
five-stage scenario broke. The e2e suite is the best here: `e2e/web-cwv.spec.ts:140` uses
`expect(metric, name)`, and each assertion in `e2e/web-chat-anonymous.spec.ts:129` has a comment
saying what it discriminates.

---

## Worst offenders

**1. `workers/edge/host-integration-test/reattach-contention.test.ts:11` — 1 test, 39 assertions, 50-line body.**
Entangled: (a) a lost accept leaves one `pending` admission; (b) a metadata-lock blocks reattach;
(c) contended requests queue behind it; (d) a conflicting second submit is `blocked`; (e) the SDK
callback recovers and settles; (f) quota is charged exactly once; (g) the open-operation row is
cleared; (h) the host's own reopen-failure counter reads 1. Split into
`a lost accept leaves exactly one pending admission`, `a blocked metadata read holds every
contender without starting business work`, `a conflicting submit is refused while the original
reattaches`, `the recovered callback settles the original operation and charges quota once`,
`a failed first reattachment is reported once`. What it buys: the 20 stacked statements and the
`try/finally` disappear, each failure names one obligation, and `holdNativeMetadata` becomes a
fixture rather than an inline lock manager.

**2. `workers/edge/admission-test/persistence-order.test.ts:12` — 1 test, 24 assertions.**
One test asserts the whole admission→drive→settle ordering: durable intent before quota
(`:25-29`), no bookkeeping before the commit gate (`:30-36`), accepted state after
`gate.next()` (`:38-42`), a *second* harness re-opened at `:44`, a `before_drive` hook containing
three further assertions at `:46-51`, and the settled end-state at `:56-59`. Assertions inside an
event-handler closure (`:48-50`) will not surface as this test's failure if the hook never fires —
`assert.equal(drives, 1)` is the only thing standing between that and a vacuous pass. Split by
window: `…commits durable intent and quota before the storage write`,
`…writes no accepted bookkeeping before the storage commit lands`,
`…publishes accepted state after the commit`, `a reopened host drives only an accepted operation`.

**3. `workers/edge/host-integration-test/default-host.test.ts:9` — 1 test, 22 assertions, 43 lines.**
Boots the default host and then asserts, in sequence: SSE wire shape (`:20-23`), settlement
(`:24`), the outbound model call and its host (`:26-28`), admission + usage rows (`:29-33`),
tool-result records and secret redaction (`:35-36`), cost accrual (`:38`), **the transcript API**
(`:39-46`), that browsing does not re-run a model (`:47`), and **ownership 404 after an owner
change** (`:48-50`). The last two are a different endpoint and a different security property; they
belong in `transcript browsing replays the stored turn without executing a model` and
`a conversation whose owner changed is not readable`.

**4. `workers/edge/host-integration-test/reconnect-during-drive.test.ts:8` — 1 test, 18 assertions.**
Three independent contracts: reattaching to a live turn returns the same `x-operation-id`
(`:25-27`), a *changed* body during the same turn is `409` (`:33`), and the settled turn bills
exactly one request with exact token counts (`:48-54`). The 409 case needs none of the billing
setup; split it out and it becomes a 10-line test.

**5. `workers/edge/host-integration-test/interleaving.test.ts:10` — 1 test, 27 assertions.**
Same family as #1. Additionally, 10 of its assertions are against `InterleavingReport` counters
that the *test worker* maintains (see next section), and `interleaving.test.ts:70`
(`assert.ok(report.callbacks >= 1)`) cannot distinguish the intended 1 from a runaway 50.

**6. `packages/agent/integration-test/web.test.ts:14` — 2 tests, 21 assertions, 16 stacked statements.**
`:15` `const database = await catalogPostgres(context); await seedCatalog(database.sql);` ·
`:19` `const authorizations: string[] = []; const reservations: string[] = [];` ·
`:30` `fault.mock.restore(); await harness.close(BACKGROUND_CONTEXT);` ·
`:52` `assert.equal(reservations.length, 3); assert.equal(reservations[1], reservations[2]);`.
Every one of these is two statements on one line, in a file that is otherwise under the limits —
i.e. density bought nothing and cost the reader the line-level failure location. The first case
also entangles *replay-after-crash* with *web-result attribution and tiering* (`:41-45`) and with
*authorization/reservation accounting* (`:52-54`).

**7. `workers/edge/admission-test/admit.test.ts` (and `reconcile.test.ts`, `conversation-title.test.ts`) — 23 test bodies wrapped in `try { … } finally { await native.close(); }`.**
This is a forbidden shape used purely for teardown, and it is avoidable *in this very repo*:
`workers/edge/host-integration-test/default-worker.ts:22` and `worker.ts:25` already register
`context.after(...)`. `nativeHarness()` (`workers/edge/admission-test/harness.ts:8-18`) returns a
`close` the caller must remember instead. Moving the cleanup into the fixture deletes 23 `try`
blocks, 23 indent levels, and the possibility of a leaked harness when someone forgets.

**8. `workers/edge/host-integration-test/selection-intent-loss.test.ts:8` — 1 test, 13 assertions, and it creates SQL objects inline.**
`:10-14` create a trigger + function in the test body and drop them in `context.after`. That is
database DDL the suite's `postgres.ts` already does for `host_test_settled` (`:23-30`) — a second,
inconsistent place where the suite's schema lives.

---

## Test-harness vs product

Harness code as a share of each directory: `bundle-smoke` **66 %** (1 197 harness lines vs 610 test
lines), `agent-db-test` 50 %, `host-integration-test` 41 %, `selection-test` 35 %,
`api-test` 30 %, `admission-test` 19 %.

**Mostly honest.** The bespoke workers are *subclasses of production classes*, not
re-implementations: `BusinessHost extends SessionAgent`
(`workers/edge/host-integration-test/business-host.worker.ts:55`), `AgentSession extends
SessionAgent` (`default-host.worker.ts:12`), `HostProbe extends SessionAgent`
(`bundle-smoke/session-host.worker.ts:10`). `gateway-harness.ts:18` bundles the real
`../src/entry.ts` and mints real EdDSA JWTs so the edge's own verification runs. The `/submit`,
`/reattach`, `/schedule`, `/report` routes are one-line dispatchers
(`interleaving.worker.ts:70-80`, `reattach-contention.worker.ts:32-43`) — an honest driver.

**Four places where the harness owns behaviour the product should own:**

1. `workers/edge/host-integration-test/worker.ts:39-68` — `retryDeadline`, `isRecoveryNudge`,
   `wakeKind`, `unexplainedWakes`. A taxonomy of *what each scheduled wake means* lives in the
   test. `native-host.test.ts:91` then asserts `unexplainedWakes(...) === []` — and that assertion
   passes for the wrong reason the moment production changes a wake payload key, because an
   unrecognised payload is classified `"other"`… by the same test-owned function the test is
   asking. This is the fake-boundary shape: the judge and the judged are the same code.
   The wake payload should be a typed product value; the test should compare against it.
2. `workers/edge/host-integration-test/interleaving.worker.ts:18-56` — `InterleavingReport`
   (`initialized/requests/callbacks/active/maxActive/driveCalls/sessions/harnesses`) is test-owned
   instrumentation, and it is the **main assertion surface** of both `interleaving.test.ts`
   (10 of 14 asserts) and `reattach-contention.test.ts` (12 of 26). The counters are incremented
   in overrides of `withSession`/`driveLane`; a production path that stops going through
   `withSession` changes the numbers rather than failing loudly, and two of the checks are
   `>=` (`interleaving.test.ts:70`, `reattach-contention.test.ts:64`) which cannot separate "1"
   from "many".
3. `workers/edge/host-integration-test/business-host.worker.ts:133-141` — the test worker installs
   a `before_drive` hook that itself calls the production `persistPermanentRejection(...)` with
   reason `"authorization_revoked"` and then throws. This one is *defensible* as fault injection —
   the test name says "a **recorded** permanent refusal" and the assertions are about recovery from
   that row — but it exposes a real gap: `"authorization_revoked"` is a
   `PermanentRejectionReason` variant (`workers/edge/src/agent/admission/permanent-rejection.ts:5`)
   with **zero production writers** (the three real call sites in `turn-budget.ts:55`,
   `prepare-authorized-drive.ts:10`, `native-authority.ts:29` write the other three reasons). The
   only thing keeping that variant alive is a test worker. Nothing in the suite covers *entering*
   the authorization-revoked path, because there is no product path to enter.
4. `business-host.worker.ts:91-99` — `#providerScript()` / `#toolsFor()` branch on four env vars
   (`TEST_TURN_DEADLINE_MS`, `TEST_RETRY`, `TEST_LOST_REPLY`, `TEST_REJECT`) so one double serves
   five scenarios. Each new case adds a branch to a shared file, and reading any one test now
   requires reading the whole switchboard.

---

## Tests that do not need a container

**7 files / 566 lines / 32 cases in `workers/catalog`'s Docker-Postgres arm never touch a database:**

| File | cases | what it actually needs |
|---|---:|---|
| `test/build-gazetteer.integration.test.ts` | 8 | pure functions + `vi` |
| `test/worker-entry-exports.integration.test.ts` | 9 | `mkdtemp` + a script module |
| `test/no-inline-config.integration.test.ts` | 6 | `mkdtemp` + a lint script |
| `test/integration-db.integration.test.ts` | 4 | string/config assertions about `catalogTruncateSql()` and `neonConfig` |
| `test/geocode-migration-parity.integration.test.ts` | 2 | `readFileSync` over `migrations/neon` |
| `test/snapshot-r2-adapter.integration.test.ts` | 2 | Miniflare R2 + `fakes/fake-catalog-db` — no Postgres |
| `test/gazetteer-audit.integration.test.ts` | 1 | a CSV + two domain functions |

Three of them say so in their own header comment ("Pure filesystem work, hence the Node
integration pool") — the pool was chosen for file access, not for a database, but the price is that
24 % of this arm's files and cases cannot be run without Docker.

**Plus 11 unit files dragged into container-backed arms:** `packages/prisma-geography`'s
`test:integration` glob includes `test/*.unit.test.ts` — **9 files, 556 lines, 50 cases** that also
run under plain `test`, so they execute **twice**, the second time behind a Postgres container.
`packages/pi-session-neon`'s `test:integration` likewise includes 2 `*.unit.test.ts` (7 cases).

**Plus 1 tautology:** `apps/web/tests/integration/integration-config.test.ts` (10 lines) imports
`vitest.integration.config.ts` and asserts its `globalSetup` equals the literal already written in
that file. No product code participates; it cannot fail for a product reason.

**Count: 32 + 57 + 1 = 90 cases across 19 files are unit tests wearing a container.**

---

## Against our own rules

| Rule (`AGENTS.md` / `.claude/rules/naming-ownership.md` / owner standing rules) | Violating files |
|---|---|
| **No conditional logic in tests** — `try/catch/finally` for teardown | 32 test bodies wrapped in `try…finally`: `admission-test/{admit×7,reconcile×5,conversation-title×4,fault-routing×2,committed-intent×2,conversation-list,deleted-conversation,persistence-order}`, `host-integration-test/{interleaving:57,reattach-contention:59,independent-settlement:37,recovery-endings:40}`, `agent-db-test/{native-settlement:32,native-settlement-faults:72,session-adoption:73}`, `selection-test/recovery.test.ts:22,54` |
| **No conditional logic in tests** — `if` inside a body | `reattach-contention.test.ts:77`, `admission-test/fault-routing.test.ts:26`, `catalog/import-integration.integration.test.ts:91` (an assertion that only runs when `manifest !== null`) |
| **Loose assertions that cannot distinguish right from very-wrong** | `interleaving.test.ts:70`, `reattach-contention.test.ts:64` (`>= 2`), `default-host.test.ts:31` & `native-host.test.ts:24` (`last_usage_seq > 0`), `turn-endurance.test.ts:48` (`>= 130_000`) |
| **Swallowed rejections (`?.`/`.catch(() => undefined)`) masking absent data** | `reattach-contention.test.ts:21`, `interleaving.test.ts:22`, `persistence-order.test.ts:22,60`, `persistence-windows.test.ts:31`, `selection-intent-loss.test.ts:19`; plus 49 `?.` in `host-integration-test` and 44 in `admission-test`, several directly inside assertions (`assert.equal(rows.rows[0]?.state, …)` reads `undefined` as a legitimate value) |
| **Statement stacking to meet the line limit** | `reattach-contention.test.ts` (20), `agent/integration-test/web.test.ts` (16), `translation-interruption.test.ts` (7), `agent/integration-test/catalog.test.ts` (5) |
| **≤200 lines per test file** | `e2e/web-chat-save-login-wall.spec.ts` (298), `workers/users/test/save-saved-route-idempotent.worker.test.ts` (256), `e2e/web-a11y-axe.spec.ts` (206) |
| **No `helper`/`util`/`manager`/`common` names** | directory `e2e/helpers/` (6 modules, individually well named); file names `workers/migrator/test/migrate.worker.helpers.ts` and `http-apply.helpers.ts`; generic `function setup()` in `workers/users/test/route-mutations.worker.test.ts:17` and `worker.worker.test.ts:7` |
| **Fixtures over ad-hoc constructors** | the 18-times-duplicated observer ritual (`const observer = await pool.connect(); context.after(… try/finally …); UNLISTEN *; LISTEN host_test_settled; once(observer, …)`) across 15 files in `host-integration-test`; `nativeHarness()` returning a manual `close` instead of self-registering cleanup |
| **Name the SUT / name what a builder constructs** | `workers/edge/admission-test/harness.ts:6` exports `context` (a pi `Context`) which then shadows the conventional `TestContext` name in every importing test |
| **Mocked clock** | satisfied — `e2e` uses `page.clock.setFixedTime` (`web-chat-anonymous.spec.ts:130`), `MemorySessionRepo({ now: () => 0 })` in the edge harnesses. The 6 sleeps found are all inside boot-wait helpers (`apps/web/tests/integration/startup-smoke.test.ts:45`, `catalog/test/ingest-bangumi.integration.test.ts:98`), not in assertions |
| **≤5 mocks per test** | satisfied everywhere — highest is 3 (`agent-db-test/native-settlement-faults.test.ts`) |

**Where we comply and should say so:** `packages/pi-session-neon/test/repo.db.test.ts`,
`workers/users/test/*`, `workers/catalog/test/*` and the whole `e2e` suite are one-behaviour-per-test
with SUT-shaped names. `workers/edge/host-integration-test/native-host.test.ts:54` is a model
parameterised case (`lostReplyCase(context, stage, status, cadence)`) — named for the scenario it
drives, reused by two tests, assertions carrying messages. Use it as the in-repo reference.

---

## Recommendation

1. **Give `host-integration-test` a settlement-observer fixture.** Replace the 18 duplicated
   `pool.connect()/LISTEN/once()` blocks with one exported fixture that yields `{ settled }` and
   registers its own release. *AC: no `.test.ts` in `workers/edge/**` contains the string
   `pool.connect()`, and `LISTEN host_test_settled` appears only in `postgres.ts`.*
2. **Make harnesses own their teardown.** `nativeHarness`, `reattachNative`, `attachPersistent`,
   `selection-test/fixture` take the `TestContext` and call `context.after(...)`. *AC: zero
   `finally {` outside `postgres.ts`-style setup files in `workers/edge/*-test/**`.*
3. **Split the four >15-assertion scenario scripts** (offenders 1–4) into the named tests listed
   above. *AC: no test case in the repo exceeds 10 assertions, and every resulting test name states
   one obligation.*
4. **De-stack the 5 dense files.** Owner rule: line limits are met by design. *AC: `reattach-contention.test.ts`,
   `agent/integration-test/{web,catalog,translation-interruption}.test.ts` contain no line with two
   statements, and no file grew past 200 lines to achieve it.*
5. **Replace test-owned classification with product types.** Move the wake taxonomy
   (`worker.ts:39-68`) into a typed wake payload owned by `workers/edge/src/agent/`, so
   `native-host.test.ts:89-92` compares against the product's own discriminant instead of asking a
   test function to classify test data. *AC: a mutation that adds an unrecognised key to a wake
   payload turns `native-host.test.ts` red, and `worker.ts` contains no `wakeKind`-style function.*
6. **Replace the `>=` and `> 0` assertions with exact expectations** (or with a documented range
   plus a message). *AC: `grep -rE 'assert\.ok\([^)]*(>=|> 0)' workers/edge/*-test` returns nothing.*
7. **Move the 7 container-free catalog files out of the Postgres arm** into a `test:node` lane, and
   narrow `packages/prisma-geography` / `packages/pi-session-neon` `test:integration` globs to
   `*.db.test.ts`. *AC: `pnpm --filter catalog run test:node` passes with Docker stopped, and no
   `*.unit.test.ts` runs twice.*
8. **Delete `apps/web/tests/integration/integration-config.test.ts`** — a config asserting itself.
   *AC: the file is gone and `apps/web` `test:integration` still fails if `globalSetup` is removed
   (it will: the build output would be missing).*
9. **Rename by ownership**: the `e2e/helpers/` directory, `migrator/test/*.helpers.ts`, and the two
   `setup()` constructors, after what they build. *AC: no directory, file, or exported function
   under any test directory matches `/helper|util|manager|common|misc|^setup$/`.*
10. **Add assertion messages where a case still carries >5 assertions.** *AC: every `assert.*` in
    `host-integration-test` and `packages/agent/integration-test` carries a message naming the
    obligation it checks.*
11. **Decide the fate of `PermanentRejectionReason.authorization_revoked`** — either give it a
    production writer and cover that entry path, or delete the variant and rewrite
    `policies.test.ts:7` against a reason the product actually emits. *AC: every
    `PermanentRejectionReason` variant has at least one call site under `workers/edge/src/`.*

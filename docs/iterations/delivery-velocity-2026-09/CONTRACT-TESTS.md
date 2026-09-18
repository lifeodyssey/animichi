# What our "repository contracts" actually test

Evidence base: worktree `orca-research-main` at `046c5ae90`; CI run 35307298262; every file in the
four steps of the `CI / repository contracts` job read or executed. All timings measured locally
(`ruby 4.0.7`, Apple silicon) and cross-checked against the CI step durations.

**Headline.** The job is four unrelated suites wearing one name. **45 of the 91 files** are ordinary
unit/integration tests of the delivery toolchain (real code, real fixtures, real exit codes) — good
work, mis-filed. **29** are string assertions about the text of three YAML files — these are change
detectors. **9** are repo invariants quantified over a glob or `git ls-files` — the most valuable and
cheapest files in the repository. **8** are mutation twins that prove a guard fires. The job is also
the **longest job in CI** (382 s, ahead of `affected (edge-worker)` 356 s), and **135 s of that is one
three-line test that sleeps for real.**

## What is under test today

Buckets: **A** = parse a YAML/config file, assert its strings/structure, no product code runs ·
**B** = execute a committed script/library with fixtures, assert behaviour · **C** = repo invariant
quantified over a glob or `git ls-files` · **D** = mutation twin.

### Bucket A — 29 files (26 in `.github/test`, 3 in `test/repo-config`)

Every row's SUT is the *text* of one named node in one YAML document. Deleting the file loses a
pinned decision; it cannot detect a workflow that is wrong but unedited.

| file (`.github/test/`) | SUT | what breaks in prod without it | already caught by |
|---|---|---|---|
| `cd-artifact.test.rb` | `cd.yml` + `hydrate-release/action.yml` | a consumer rebuilds instead of hydrating the sealed snapshot | `release-consumer-cli.test.rb` (B) proves seal/verify refuse tampering |
| `cd-credentials.test.rb` | `cd.yml` | a runtime secret or retired key lands in a job env | zizmor `secrets-outside-env`, `overprovisioned-secrets`, `excessive-permissions` |
| `cd-delivery-jobs.test.rb` | `cd.yml` | two deploys of one environment interleave | nothing — but see "convert" below |
| `cd-migrations.test.rb` | `cd.yml` (+1 file-exists test) | production migrates without the baseline guard | `migrate-through-worker.test.sh` (B) proves the script; the *wiring* is unproven |
| `cd-post-deploy-evidence.test.rb` | `cd.yml` + `verify-deploy-evidence.yml` | the seat workflow gets write scope | zizmor `excessive-permissions` |
| `cd-publish.test.rb` | `cd.yml` + `package.json` | an unpinned wrangler publishes | dependabot + lockfile |
| `cd-receipt.test.rb` | `cd.yml` | the container wait budget stops matching the documented 165 s | nothing; `:53 assert_equal 165, (attempts - 1) * delay` re-implements the arithmetic |
| `cd-schema-verification.test.rb` | `cd.yml` | the schema check becomes conditional and skips | `verify-catalog-schema.test.sh` (B) proves the script only |
| `cd-selection.test.rb` | `cd.yml` | CD gains a non-dispatch trigger / floating checkout ref | zizmor `dangerous-triggers`, `ref-confusion`, `unpinned-uses` (partial) |
| `cd-stage-smoke.test.rb` | `cd.yml` | a swallowed smoke failure promotes a broken staging | `workflow-execution.test.rb:19` already refutes `continue-on-error` in **every** workflow |
| `cd-stage.test.rb` | `cd.yml` | the retire→publish→migrate→schema→smoke order permutes | nothing |
| `merged-commit-lane.test.rb` | `pr-verification.yml` | a new job silently never runs on merged commits | nothing (this one is close to a C — it enumerates jobs) |
| `pr-verification-affected.test.rb` | `pr-verification.yml` | a package script drops out of the matrix | the lane going missing is invisible — real hole |
| `pr-verification-browser.test.rb` | `pr-verification.yml` | the e2e lane stops running a browser script | same |
| `pr-verification-gates.test.rb` | `pr-verification.yml` | an aggregate stops depending on a lane | ruleset required checks catch the *context*, not the `needs` |
| `pr-verification-login.test.rb` | `pr-verification.yml` | the live-login lane runs where it cannot pass | nothing |
| `pr-verification-plan.test.rb` | `pr-verification.yml` | a path leaves the routing table; that lane goes dark | nothing — and `:31-40` **duplicates the whole table** into the test |
| `pr-verification-schema.test.rb` | `pr-verification.yml` | the db lane applies a migration / unpins atlas | nothing |
| `pr-verification-workspace.test.rb` | `pr-verification.yml` | a job runs before `setup-workspace` | the job fails at runtime anyway |
| `pr-verification-zizmor.test.rb` | `pr-verification.yml` | zizmor is quietly weakened below `pedantic` | nothing; but `:9` pins `version => "1.30.0"`, so every bump edits a test |
| `setup-workspace-action.test.rb` | `setup-workspace/action.yml` | the composite stops using `--frozen-lockfile` | CI install failure, loudly |
| `release-build.test.rb` | `release-build.yml` | the snapshot is built off a non-main trigger | `release-*` B-suite proves the sealing, not the trigger |
| `release-dispatch.test.rb` | `release-build.yml` | CD is dispatched for a failed build | nothing |
| `workflow-credentials.test.rb` | **all** workflows+actions (glob) | any workflow reads `secrets.*` | zizmor `secrets-inherit` / `secrets-outside-env` / `overprovisioned-secrets` |
| `workflow-execution.test.rb` | **all** workflows (glob) | a job gains `continue-on-error` or loses its timeout | zizmor does not check timeouts; `continue-on-error` is repo policy |
| `workflow-workspace.test.rb` | **all** workflows (glob) | a job caches a pnpm store it never installs | the job fails loudly |
| `test/repo-config/lint-scope.test.rb` | every `**/.oxlintrc.json` | a package quietly widens `ignorePatterns` | globs the set but compares each to a **hardcoded baseline** (`:50`) — a new package fails until the baseline is edited |
| `test/repo-config/package-test-segments.test.rb` | every workspace `package.json` test script | a package's `test` script drops a required segment | same shape: globbed subject, hardcoded expectation (`:75`) |
| `test/repo-config/playwright.test.rb` | `e2e/playwright.config.ts` | two checkouts fight over the lane port | flaky e2e, eventually |

Three `.github/test` rows (`workflow-credentials`, `workflow-execution`, `workflow-workspace`) are A in
mechanism but **universally quantified over `Dir.glob(".github/workflows/*.yml")`** — a new workflow
joins the surface automatically. `lint-scope` and `package-test-segments` show the converse and are
worth stating as a rule: **globbing the subject is necessary but not sufficient — the expectation has
to be derived too.** Both iterate every package and then compare to a frozen literal, so adding a
package turns them red for no defect. That is still a change detector.

### Bucket B — 45 files. Keep, all of them.

Real programs, real fixtures, real exit codes. `.github/test` (28) = every `release-*` file except
`release-build` and `release-dispatch` (17), `failure-alert-{behavior,ledger,recipient}`, all five
`post-deploy-evidence*`, `edge-container-retirement`, `migrator-container-retirement`,
`workflow-python-toolchain`. `test/repo-config` (4): `dependency-hold-backs` (drives
`dependency_hold_backs.rb`'s `admits?`/`parse`), `gitleaks` (drives `GitleaksToml.read` over
hand-written TOML), `refresh-hold-backs`, `sqlfluff` (executes `make -n db-lint`, `:23`). Shell (13,
`local-gates` + `delivery` + `.github/scripts`): every one runs the real script under a stubbed `PATH`
in a throwaway tree and asserts exit codes and log text — `pre-push-affected.test.sh:1`,
`schema-preflight.test.sh:16`, `migrate-through-worker.test.sh:65`.

**These are not contract tests.** They are the delivery toolchain's unit tests. Their SUT is
`.github/lib/release/*.rb|mjs`, `.github/scripts/**`, `scripts/delivery/**`, `scripts/local-gates/**`,
`test/repo-config/*.rb`.

One is worse than mis-filed. `refresh-hold-backs.test.rb` declares its SUT as `refresh-hold-backs.rb`
(`:1`) but calls only `HoldBacks.drift_between` / `.with_carried_issues` (`:22,27,33`), both defined in
`dependency_hold_backs.rb:245,261`. That file's own `Derivation` and `Refresh` classes (`:26,:56`) —
`drift` (`:84`), `write` (`:88`), the `pnpm outdated` shell-out — are exercised by nothing, while
`dependency-hold-backs.test.rb:151` states *"`Refresh#drift` and `--write` are covered by
refresh-hold-backs.test.rb"*. A stale comment asserting coverage that does not exist is exactly what
fools a review seat.

### Bucket C — 9 files. The best files in the suite.

`workflow-invocations.test.rb` (every committed `*.test.rb|sh` is invoked by `pr-verification.yml`;
every invoked script exists; no orphan in `.github/scripts`), `workflow-variables.test.rb` (every
`vars.*` read is defined or guarded), `failure-alert.test.rb` (every unattended workflow wires the
alerter), and in `test/repo-config`: `e2e-no-skip`, `e2e-spec-coverage`, `pnpm-workspace-settings`,
`pre-push-routing`, `retired-python-agent-refs`, `wrangler-path-claims`.

These quantify over a set the repo can grow (`Dir.glob`, `git ls-files`) **and derive the expectation
from that set** rather than from a literal, and carry an explicit, reasoned exemption registry
(`retired-python-agent-refs.test.rb:11-25`). A new file joins the surface without anyone remembering
to edit the test. They cost ~5 s in total.

### Bucket D — 9 mutation twins. See §Mutation twins.

## Bucket A: config assertions — keep, convert, or delete

**The discriminator.** Ask of every assertion: *does it quantify over a set the repository can grow,
or is it pinned to one named node?* Universally quantified → it keeps holding as the repo changes and
cannot be satisfied by copy-editing. Existentially pinned → it is a change detector: it fails whenever
you edit the subject and cannot fail when the subject is wrong but unedited. Google's
["Change-Detector Tests Considered Harmful"](https://testing.googleblog.com/2015/01/testing-on-toilet-change-detector-tests.html)
names the pattern; Fowler's [Test Pyramid](https://martinfowler.com/bliki/TestPyramid.html) gives the
economics — high-level tests are *"brittle, expensive to write, and time consuming to run"*, and
*"an enhancement to the system can easily end up breaking lots of such tests"*.

**The tax, measured in our history.** 387 commits. `pr-verification.yml` has 51; **24 of them (47%)
also had to edit a file under `.github/test/`**. Of the 25 commits that touched `.github/test/`,
**24 also touched `.github/workflows/`** — the one exception (`c3b5f3a61`) edited
`cd-credentials.test.rb` to accommodate an infra change. In 10 months no commit shows one of these
files changing because it caught something on its own. The author who breaks the rule is the author
who updates the assertion in the same commit, so the test cannot dissent.
`pr-verification-plan.test.rb:31-40` is the pure form: the routing table is copy-pasted into the test,
so "the test passes" means "someone pasted the same thing twice".

**Cheaper enforcement that already exists in this repo, unused or underused.**

1. **zizmor** already runs in CI at `persona: pedantic` for 14 s and performs
   [41 audits](https://docs.zizmor.sh/audits/) including `excessive-permissions`, `secrets-inherit`,
   `secrets-outside-env`, `overprovisioned-secrets`, `unpinned-uses`, `ref-confusion`,
   `dangerous-triggers`, `template-injection`, `cache-poisoning` — covering most of
   `workflow-credentials`, `cd-credentials` and part of `cd-selection`, generically, across workflows
   that do not exist yet.
2. **actionlint** is configured (`.pre-commit-config.yaml:116`, `.github/actionlint.yaml`), passes
   clean today (exit 0), and **is in no CI job** — verified by grepping every workflow. Its 38 check
   families (unexpected keys, `needs`/matrix typing, runner labels, shellcheck over `run:`, constant
   `if:`) subsume several hand-rolled bucket-A assertions.
3. **Rulesets.** GitHub's
   [ruleset rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
   already carry the merge contract (`docs/ops/review-gate.md:11-19`). "This lane must run" is a
   *required status check context*, not a Ruby assertion about `needs:`.
4. **A policy engine.** [conftest](https://github.com/open-policy-agent/conftest) tests structured YAML
   against Rego. The ~14 bucket-A files that are genuine repo-specific safety rules ("every environment
   job holds a non-cancelling lock", "the smoke step is last and unconditional") are 20-40 lines of Rego
   running in under a second over *all* workflows — including ones added later.

**One more failure mode: a reference set that is a copy of the truth.**
`workflow-variables.test.rb:31-37` pins the output of `gh variable list` from 2026-09-16 with the
comment "no runner can ask GitHub". It fails closed for a *new* reference and silently passes when a
variable is *deleted upstream* — the exact failure `#1686` was about. Its guard half (every `vars.*`
read is refused when empty) needs no registry and should survive alone.

## Mutation twins

Nine files carry `-mutation` in the name. I verified each one's mechanism directly.

**Eight are real.** They write a mutated copy of the file under guard into a temp root and re-run the
*sibling test* as a subprocess, asserting non-zero exit with the message "mutation survived: …":
`dependency-hold-backs-mutation.test.rb:54-69`, `gitleaks-mutation.test.rb:41-42`,
`gitleaks-pin-mutation.test.rb:29-31`, `pnpm-workspace-settings-mutation.test.rb:72-73`,
`e2e-no-skip-mutation.test.rb:74-75`, `e2e-spec-coverage-mutation.test.rb:100-103`,
`failure-alert-mutation.test.rb:60,77,89`, `failure-alert-recipient-mutation.test.rb:39,48,57`.
Most also assert the **unmutated control passes** (`dependency-hold-backs-mutation:75`,
`gitleaks-mutation:48`, `pnpm-workspace-settings-mutation:79`, `e2e-spec-coverage-mutation:108`) and
several assert the failure *message* names the offender and the consequence
(`e2e-spec-coverage-mutation:102-103`). That is a correct red/green proof, and it is the only thing in
the whole job that satisfies the owner's rule that mutation testing is the only valid green light.

Two mechanical details worth knowing before treating "re-run the sibling" as one thing:

- **Copy vs. live.** Four twins copy the sibling contract into a throwaway tree and run the copy
  (`dependency-hold-backs-mutation`, `e2e-spec-coverage-mutation`, `gitleaks-pin-mutation`,
  `pnpm-workspace-settings-mutation`); two run the literal committed sibling and redirect only the
  env var it locates its inputs with (`e2e-no-skip-mutation:74-75` via `TEST_REPOSITORY_ROOT`,
  `gitleaks-mutation:40-44` via `GITLEAKS_CONFIG`). The second form is the stronger proof — it runs the
  file that will actually gate the next PR. `gitleaks-mutation` redirects `GITLEAKS_CONFIG` only, so
  that run reads a mutated TOML *and* the real `.pre-commit-config.yaml` from the live repo.
- **One twin has no control.** `gitleaks-pin-mutation.test.rb` is the only one of the six without an
  "accepts the unmutated tree" case — so a twin that went permanently red for an unrelated reason
  would still look like it was doing its job. Add the control; it is four lines.

Run counts: `gitleaks-mutation` 33 subprocess runs / 19 cases (largest), `failure-alert-mutation` 19
runs / 15 cases, `e2e-spec-coverage-mutation` 14 / 6, `pnpm-workspace-settings-mutation` 12 / 12,
`dependency-hold-backs-mutation` 8 / 8, `e2e-no-skip-mutation` 7 / 3, `gitleaks-pin-mutation` 4 / 4,
`failure-alert-recipient-mutation` 3 / 3.

**One is misnamed.** `post-deploy-evidence-mutation.test.rb` never invokes a sibling test (verified:
no `test.rb` or `RbConfig` reference in the file). It mutates the *artifact data* — `receipt.json`,
`evidence.json` — and asserts the real `verify-evidence.mjs` goes red and green again on restore
(`:48-56`). That is a good tampering test of the verifier, in the wrong clothes.

**Economics.** The eight real twins cost 17.0 s combined — 4.5% of the job — for the only efficacy
proof in it. **Keep all eight.** Rename the ninth to what it is (`post-deploy-evidence-tampering`) and
fold it into `post-deploy-evidence-verifier.test.rb`.

**The asymmetry is the real finding.** Twins exist for the cheap, already-good guards. **Not one of
the 26 bucket-A workflow assertions has a twin.** Nothing proves `cd-stage.test.rb` would fail if the
ordering rule were actually broken, or that `cd-receipt.test.rb`'s budget arithmetic would catch a
wrong `CONTAINER_ATTEMPTS`. By the repo's own standard those 29 files are unproven.

## Cost

`CI / repository contracts` = **382 s, the longest job in run 35307298262** (`affected (edge-worker)`
356 s, `browser` 290 s, `docs` 39 s). Step breakdown: workflow/action responsibilities **279 s**;
delivery scripts 23 s; repo configuration 14 s; local gate scripts 14 s; orca 2 s; setup 33 s.

Local per-file totals: `.github/test` **≈304 s**, `test/repo-config` **9.1 s**. Top 10:

| s | file | why |
|---|---|---|
| 142.6 | `release-schema-gate.test.rb` | real `sleep`, not a stub — see below |
| 26.1 | `release-migration-request.test.rb` | 11 subprocess runs of `migrate-through-worker.sh` |
| 19.2 | `release-receipt-record.test.rb` | a deliberate stubbed **3 s** sleep per read (`:157`) |
| 19.1 | `post-deploy-evidence.test.rb` | boots a real node origin per test |
| 16.0 | `post-deploy-evidence-verifier.test.rb` | node subprocess per case |
| 14.9 | `post-deploy-evidence-mutation.test.rb` | node subprocess ×2-3 per case |
| 8.9 | `migrator-container-retirement.test.rb` | 17 bash subprocesses |
| 7.3 | `failure-alert-behavior.test.rb` | 12 ruby subprocesses |
| 7.0 | `failure-alert-mutation.test.rb` | 19 sibling subprocess runs |
| 5.7 | `post-deploy-evidence-smoke-interval.test.rb` | node subprocess |

**Half the step is one test.** `release-schema-gate.test.rb:146-149`
(`test_unavailable_ledger_is_not_success`, three lines, one assertion) takes **135.6 s measured
alone**. `schema-preflight.sh:40-41` defaults to `UNAVAILABLE_ATTEMPTS=10` /
`UNAVAILABLE_POLL_SECONDS=15`; the test's environment (`:29`) overrides `BUNDLE_POLL_SECONDS` and
`STALE_BUNDLE_ATTEMPTS` but **not** the unavailable pair, and does not stub `sleep` — so it burns
9 × 15 s of wall clock to learn that a 503 fails closed. The same script's shell suite
`.github/scripts/release/schema-preflight.test.sh:26-29` already covers that exact case (*"a 503 that
never recovers fails closed"*, *"after exactly the default cap of 10 attempts"*) by stubbing `sleep`
in `scripts/delivery/schema-preflight-testbed.sh:78-85` and asserting the recorded intervals.
**That whole shell suite runs in 1.8 s.** Two suites, one SUT, one of them 80× slower and less precise.

**The suite's own toolchain is unpinned.** No `Gemfile`, no `Gemfile.lock`, no `.ruby-version`, no
`setup-ruby` in any workflow or in `setup-workspace/action.yml` — all verified. The 59 Ruby files run
on whatever Ruby the runner image ships. On a current Ruby (minitest 6.0.6, which dropped
`minitest/mock` and `Object#stub`) three fail outright: `release-selection.test.rb` (18 failures +
1 error, `Time.stub` at `:29`), `release-receipt-cli.test.rb` and `release-resolver.test.rb` (both
shell out with `ruby -rminitest/mock`). The gate that enforces this repo's pinning discipline is the
one unpinned thing in it, and it is already unreproducible locally.

## Against our own rules

- **`AGENTS.md:62` "mock the clock (no timing-dependent asserts)"** — violated by
  `release-schema-gate.test.rb:146` (135 s of real sleeping) and `release-receipt-record.test.rb:157`
  (a deliberate 3 s sleep used as a timing fixture). 155 s of the 382 s job is clock, not computation.
- **`AGENTS.md:62` "≤200 lines"** — `pre-push-affected.test.sh` (238) breaks it; `harness.rb` (291),
  `dependency_hold_backs.rb` (289), `gitleaks_toml.rb` (269) are libraries, so arguable.
  **`:63` "no conditional logic"** — clean: two hits repo-wide (`package-test-segments.test.rb:74`, an
  `if` inside an embedded JS fixture at `release-container-observation.test.rb:51`).
- **"tests named by SUT"** — every file declares a `# SUT:` header, exemplary discipline, and several
  headers contradict the filename: `release-schema-gate` → `schema-preflight.sh`;
  `release-migration-request` → `migrate-through-worker.sh`; `pr-verification-schema` → the db job;
  `post-deploy-evidence-mutation` → not a mutation; `refresh-hold-backs.test.rb` → a file it never
  calls. The `release-*` prefix names the *workflow that calls* the code, not the code.
- **"mutation testing is the only valid green-light proof"** — satisfied for 8 guards, unsatisfied for
  the 29 config assertions and every bucket-B file.
- **"contract tests do not defend against adversarial rewrites"** — `pr-verification-plan.test.rb:31-40`
  is the proof: the defence against a routing-table edit is a copy of the routing table.
- **"documentation-consistency meta-tests are deleted by default" (owner, 2026-09-08)** —
  `test/repo-config/wrangler-path-claims.test.rb` is one, and it enforces English prose with a regex
  plus a second regex for *negated* prose (`:41-43`). `retired-python-agent-refs.test.rb` is the same
  class with better justification.
- **`.claude/rules/naming-ownership.md` (no `helper`/`common`/`misc`)** — `.github/test/support/` and
  two files named `harness.rb` are the same nameless-bucket smell. Name them for what they build:
  `failure_alert_run.rb`, `deploy_evidence_origin.rb`.

## Recommendation

Ordered. Every step is independently shippable.

**1. Stop the clock (one line, −135 s, do this first).** Add `UNAVAILABLE_POLL_SECONDS => '0'` and
`UNAVAILABLE_ATTEMPTS => '2'` to `release-schema-gate.test.rb:29`. **Then delete the file** — its SUT
is `schema-preflight.sh`, which `schema-preflight.test.sh` already covers more precisely (it asserts
the *recorded sleep intervals*, which the Ruby file cannot see) in 1.8 s; fold its three unique cases
(contract binding, prisma target substitution, http-scheme refusal) into the shell suite. Stub
`release-receipt-record.test.rb`'s 3 s sleep the same way. *Evidence it is safe:* the shell suite's
case list already names every Ruby case; diff them and show the fold is total.

**2. Pin the Ruby toolchain (correctness, not speed).** Add a `Gemfile` + `Gemfile.lock` pinning
minitest, a `.ruby-version`, and `ruby/setup-ruby` to the `contracts` and `docs` jobs. Fix the three
files that already fail on current minitest. Without this the gate is one runner-image bump from
failing wholesale — and nobody can run it locally today.

**3. Move bucket B out of "contracts" (45 files, no behaviour change).** These are the delivery
toolchain's unit tests. Give `.github/lib` + `.github/scripts` + `scripts/delivery` +
`scripts/local-gates` a real test runner and a package script, name files after the program under
test (`schema_preflight_test`, `migrate_through_worker_test`, `failure_alert_test`), and let the
`affected` matrix select them by path like every other package. Keep the `workflows` path filter that
already force-adds `edge-worker` (`pr-verification.yml:169-172`). Run them **in parallel** — they are
subprocess-bound, and 45 files at ~4 cores is ≈45 s instead of ≈180 s. While doing this, either cover
`refresh-hold-backs.rb`'s `Refresh#drift`/`#write` or delete them, and remove the false coverage
comment at `dependency-hold-backs.test.rb:151`.

**4. Convert bucket A.** Of the 29:
- **Delete outright (6):** `pr-verification-workspace`, `setup-workspace-action`, `cd-publish`,
  `cd-post-deploy-evidence`, `cd-artifact`, `release-dispatch`. Each is either loud-at-runtime,
  dependabot's job, or already inside zizmor's audit set.
- **Convert to zizmor + actionlint (3):** `workflow-credentials`, `cd-credentials`, and the trigger
  half of `cd-selection`. Put **actionlint in CI** (it is already configured, already clean, and costs
  ~2 s) — that alone subsumes the structural half of several files.
- **Convert to one conftest/Rego policy file (14):** the ordering, concurrency-lock, `needs`,
  path-filter, conditionality and decisiveness rules from `cd-stage`, `cd-stage-smoke`,
  `cd-delivery-jobs`, `cd-migrations`, `cd-schema-verification`, `cd-receipt`, `cd-selection`,
  `pr-verification-affected`, `pr-verification-browser`, `pr-verification-gates`,
  `pr-verification-login`, `pr-verification-plan`, `pr-verification-schema`, `release-build`. Written
  as Rego over the parsed YAML they become *universally quantified* — a new environment job or a new
  lane is covered the moment it lands, which is precisely what the current files cannot do. Target:
  one `policy/workflows.rego` + `conftest test .github/workflows` in ~2 s.
- **Keep as-is (6):** `pr-verification-zizmor` (but move the version pin to dependabot and assert only
  `persona: pedantic`), `merged-commit-lane`, `failure-alert`, `workflow-execution`,
  `workflow-workspace` (both are glob-quantified and cost 0.07 s), `test/repo-config/gitleaks`
  (it has a twin).

**5. Keep bucket C untouched (9 files, ~5 s).** These are the model. Add a twin for
`workflow-invocations` — it is the file that keeps every other test from going dark, and it has none.
Re-derive `lint-scope` and `package-test-segments`' expectations from the tree so they join this
bucket instead of sitting in A.

**6. Keep the eight real twins; rename the ninth; give `gitleaks-pin-mutation` its control.** And add
twins for whatever survives step 4 — a Rego policy is far easier to mutation-test than a Ruby string
assertion.

**7. Delete `wrangler-path-claims.test.rb`.** It is a documentation-consistency meta-test enforcing
English prose with regex, which the owner's standing rule deletes by default. Its one durable half
(a `*/wrangler.toml` path claim must resolve) belongs in `scripts/local-gates/check-docs-paths.sh`,
which already runs in the `docs` job.

**Expected CI after steps 1-4.** `contracts` disappears as a job. What remains: a `policy` step
(actionlint + conftest + 6 kept assertions + 9 invariants + 8 twins) at **≈30 s**, plus the
delivery-toolchain tests inside the `affected` matrix at **≈45 s wall** in parallel — and only when
their paths change. Critical path drops 382 s → ~356 s (`affected (edge-worker)` becomes the longest
job); the *unconditional* per-PR cost drops 382 s → ~30 s.

**Evidence that would prove it safe.** (a) For every deleted or converted file, run its mutation
scenario against the replacement and show the same red — for the 29 files with no twin today, write
the twin *before* converting, so the conversion is proven by the red→green the repo already demands.
(b) Replay the 24 co-change commits against the new policy and show each one that *should* have failed
still fails. (c) `git log -S` over the deleted assertions, to confirm none was ever the thing that
turned a PR red.

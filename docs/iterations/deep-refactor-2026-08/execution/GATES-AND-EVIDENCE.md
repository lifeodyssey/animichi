# Gates and evidence protocol

This protocol answers one question: what observable evidence lets the next person trust that a card
is complete? It applies to all 27 cards and is stricter than “tests passed on the executor.”

## 1. Card brief contract

Create a local `TASK-BRIEF.md` in the card worktree and keep it out of Git. It must be self-contained:

1. card and issue, exact base SHA, absolute worktree, and owned files/behavior;
2. exact Spec row and `needs` copied without weakening;
3. current implementation anchors found in that checkout;
4. behavior manifest and the first red/characterization test;
5. ordered implementation and caller-migration steps;
6. exact deletion inventory, including code, tests, config, schema, docs, and remote IaC resources;
7. redacted observability fields and prohibited sensitive fields;
8. focused, package, cross-stack, drift, and structure commands;
9. one meaningful mutation and the command that must become red;
10. `Edit files with tools; do not print the patch; do not run git commands; leave changes in the
    working tree.`

The brief is complete when another executor can implement the card without reading chat history or
making a product decision.

## 2. Behavior manifest

Characterization records semantics, not current function boundaries. For each observable path list:

| Field | Required content |
|---|---|
| Trigger | Published command/request/event that starts behavior |
| Identity | public/anonymous/member/service authority and rejection boundary |
| Input classes | valid, boundary, stale, duplicate, forbidden, malformed |
| Result | typed success/error/terminal event visible to caller |
| Durable effects | exact writes, revision, ordering, quota/usage/audit effect |
| Dependency effects | model/Catalog/Neon/Users/Edge call and retry/cancellation rule |
| Concurrency | winner, replay, mismatch, stale revision, race outcome |
| Sensitive boundary | fields allowed in metrics and fields forbidden from logs/traces |
| Deletion | implementation surfaces that become unnecessary after migration |

Characterization tests may exercise the old entry but must assert public behavior. Commit them before
changing structure. After the new seam carries the behavior, move the assertion to the seam and
delete tests that exist only to patch the old helper.

## 3. Gate ladder

Run from narrowest feedback to broadest. Record command, checkout SHA, outcome, duration, and the
first useful failure line for every rung.

### 3.1 Static diff gate

Before any test:

```bash
git status --short --branch
git diff --check
git diff --stat
git diff --name-only
```

Inspect the full diff. Confirm only owned files changed, no task brief entered Git, no secret-like
value appears, and no suppression, skipped test, lowered threshold, compatibility bridge, or
unrelated formatting churn was added.

### 3.2 Focused red/green gate

Run the smallest test that observes the behavior currently being changed. It must be:

- red before a bug/target implementation where TDD requires red, or green as an immutable
  characterization of current behavior;
- green after implementation;
- independent of wall-clock timing and network unless the acceptance boundary is explicitly live;
- written against the application seam, except boundary-specific adapter/API/browser assertions.

### 3.3 Package gate

Read the current package `AGENTS.md` and use its sanctioned scripts. Do not invent a lighter command
that bypasses project configuration. Typical owners are:

| Surface | Required command family |
|---|---|
| Agent | `make test`; targeted pytest; `make test-integration`; `make test-eval` where behavior is protected by eval |
| Edge | `pnpm run test:worker` plus package type/lint command |
| Catalog / Users / Contract / Web | package-declared pnpm type, lint, unit, integration, and browser scripts |
| Migrations | repository Atlas validate/lint/diff commands against a disposable database |
| Infra / workflows | package IaC tests, workflow contracts, `actionlint`, config read-set tests |
| Browser | `make e2e-setup` then `make e2e`, or the ticket's narrower promoted Playwright project |

An adapter card cannot replace its real-adapter test with only a fake-port unit test. A browser/API
card does not duplicate the whole application state machine at transport level.

### 3.4 Cross-stack gate

Run `make check` before and after every card. The latest observed pre-campaign full integration run
was not globally green: `test_cluster_version_allows_one_current_per_work` reached PostgreSQL
`UndefinedColumn work_id` after 152 passed and 22 were skipped. Reproduce and classify that baseline
on a fresh card worktree rather than assuming it still exists or blaming a new card automatically.

Use these outcome classes:

- `PASS`: requested gate completed and all assertions passed;
- `PRODUCT_FAIL`: test reached product code and found a behavior defect;
- `PREEXISTING_FAIL`: same failure is reproduced on the untouched base with evidence;
- `ENV_BLOCK`: test body could not run because a required service, port, browser, Docker socket, or
  credential was unavailable;
- `DISCOVERY_FAIL`: the declared tests were not collected or the command did not exercise them;
- `NOT_APPLICABLE`: the card does not touch that surface and the brief states why.

A focused pass never converts a broader failure or environmental block into green. Fix a regression
inside the card; track a verified pre-existing failure separately without suppressing it.

### 3.5 Coverage and generated-drift gate

- Codecov patch coverage is at least 95% on the exact PR head.
- Repository/package coverage floors do not decrease.
- Generated Python, Contract artifacts, snapshots, lockfiles, and schema manifests regenerate to a
  clean tree where the card owns them.
- Source-structure checks fail if a retired path, vocabulary, wrapper, table, permission, or runtime
  mapping returns outside an exact historical/SAFE-1 allowlist.

## 4. Mutation protocol

Coverage proves execution; mutation proves the test protects a rule. Every card names at least one
rule whose deliberate violation must fail.

1. Start from the green intended diff and record `git status`.
2. Save the target file outside the worktree or prepare an exact reverse patch. Never use
   `git checkout --`/`git restore` on a file containing uncommitted executor work.
3. Apply one minimal semantic mutation: remove an owner predicate, reverse ordering, bypass CAS,
   restore an old path, weaken an issuer check, omit a manifest field, or reopen ingress early.
4. Run the narrow acceptance command. Record non-zero exit and the assertion that detected it.
5. Restore the exact intended content, verify no collateral diff, and rerun the same command green.
6. Run `git diff --check` and compare the final diff to the pre-mutation snapshot.

An import error, syntax error, linter failure, or unrelated test failure is not a killed semantic
mutation. If the mutation survives, improve the replacement test before review.

## 5. Deletion proof

Each card builds a table before editing:

| Retired surface | Current owners/callers | Replacement owner | Zero-match scope | Exact allowlist |
|---|---|---|---|---|

After migration, run `rg` over source, tests, workflows, configs, migrations, docs, and generated
artifacts. A successful delete proves both:

1. no executable caller, route, import, schema object, grant, secret reference, remote trigger, or
   test can reach the old behavior; and
2. the replacement caller and adapter are exercised, so zero matches did not simply delete a
   capability.

History under `docs/archive` may remain only when the card names it as an exact allowlist. Live docs
and package context must describe the final target, not both architectures.

## 6. Evidence ledger

Keep working evidence under `orchestra/cards/<CARD>/log/`. Before PR, summarize it in
`orchestra/cards/<CARD>/evidence.md` and the PR body:

```text
Card / issue:
Worktree / branch:
Base SHA / final SHA:
Executor model / session:
Behavior manifest commit:
Implementation commits:
Files changed and deletions:
Gate table: command | outcome class | duration | evidence path
Mutation: rule | change | red assertion | restored green command
Coverage: patch percent | report SHA
Generated/structure proof:
Reviewer / verdict / findings disposition:
PR checks head SHA:
Staging evidence, if any:
Known unrelated failures or limits:
```

Never record token, cookie, DSN, credential, user identity, prompt, message content, image bytes, or
raw provider response. Public component names, commit SHAs, schema versions, counts, durations, and
redacted reason classes are allowed.

## 7. OpenCode acceptance

The orchestrator starts one server and dispatches sessions with independent `--dir` worktrees. A
session's exit code is advisory. The only acceptance signal is the on-disk diff plus independently
rerun proof.

Reject or re-dispatch when:

- the log contains a proposed patch but the worktree is unchanged;
- edits cross the brief's ownership boundary;
- the executor rewrites an unrelated document or config section;
- formatting tricks, suppressions, compatibility shims, or weakened assertions satisfy a metric;
- it runs Git, commits, or changes another card's worktree;
- it claims tests without reproducible output.

If DeepSeek produces an empty stream, run the required ALIVE probe. Retry a transient server 500
once; after two consecutive server failures, reduce concurrency. Switch to Luna only after the DS
probe fails, and record the model change.

## 8. Commit, review, and PR gate

1. Stage files by explicit path; never `git add -A` or `git add .`.
2. Exclude `TASK-BRIEF.md`, executor logs, credentials, and scratchpad state.
3. Use a commit body recording `Written by opencode (<model>, variant max)` and the orchestrator
   co-author. Do not amend the immutable characterization commit.
4. The independent reviewer receives the issue, brief, full diff, test outputs, deletion search, and
   mutation evidence. `APPROVE` requires all of them.
5. After push, wait for the exact head. Inspect both GraphQL review threads and top-level PR comments;
   Qodo/Sonar/Codecov summaries can exist only in the latter.
6. For every finding, record fixed, false positive with evidence, deferred by an approved scope
   decision, or blocked. Leave the owner-authored `线程判定`/`findings triaged` comment required by
   the hook.
7. Re-run fresh-head checks, then squash merge. Never force-push and never bypass hooks.

## 9. Handoff criterion

A card may be handed to another orchestrator only when the handoff names one exact state:

- `READY_TO_EXECUTE`: clean characterization commit, brief complete, target tests red;
- `READY_TO_VERIFY`: intended diff present, no unreviewed executor still writing;
- `READY_TO_REVIEW`: all local gates and mutation evidence complete;
- `WAIT_GREEN`: PR URL and exact head recorded;
- `BLOCKED`: repeated blocker, three attempts, exact missing permission/input;
- `DONE`: squash SHA on main and dedicated worktree safely removable.

“Mostly done,” an OpenCode session ID, or a chat summary alone is not a recoverable state.

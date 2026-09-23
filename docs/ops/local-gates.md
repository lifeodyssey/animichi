# Local Gates — three hook stages over the affected packages

CI is the terminal gate; the local gates exist so a red push is the exception. What they gate is
decided by the changed files alone, and what they run for a package is that package's own
`package.json` scripts — the same scripts CI's affected matrix runs. There is no second gate
definition to drift from, so nothing has to prove local and CI agree (#1371).

## Principles

1. **The changed files decide.** pre-commit reads the **staged** diff; pre-push reads
   **merge-base-to-head**. Only what changed is gated.
2. **A package's gates are its own scripts.** `lint`, `typecheck`, `test`, `test:integration` in that
   package's `package.json` (#1358). Coverage floors and drift checks live inside them, so the hook
   never carries a weaker copy. `test` stays Docker-free (#1473, the #1322 flake class): the catalog
   database suite boots a Docker Postgres container, so it lives in `test:integration` — the same
   lane every other package's database arm uses — and never in `test`.
   `test/repo-config/package-test-segments.test.rb` pins both ends: `test` must not chain it, and
   `test:integration` must still run `vitest.integration.config.ts`.
3. **Fail closed on the unknown.** A changed path that maps to no package, no bucket and no
   whitelist entry fails the push and is named in the output. Silence is never the answer.
4. **No suppressions.** Fix the failing gate or triage it explicitly; `--no-verify` is a policy
   violation (CI still enforces).
5. **No cloud mutation, no local deploy.** No hook runs a mutating `pulumi up/destroy`,
   `wrangler deploy` (only `--dry-run`, inside a package's own script), or a migration apply
   outside a disposable local container.

Install all three stages from the repository root:

```bash
pre-commit install --hook-type pre-commit --hook-type commit-msg --hook-type pre-push
```

## pre-commit (universal + staged packages, <10s)

- `trailing-whitespace`, `end-of-file-fixer`, `check-yaml`, `check-toml`
- `check-executables-have-shebangs` + `check-shebang-scripts-are-executable` — the two halves of the
  shebang/exec-bit agreement, upstream's implementation of what a local script used to hand-roll
- `gitleaks` (secret scan)
- `shellcheck --severity=warning` over **every** shell file in the repository
- `actionlint` over `.github/workflows/*.{yml,yaml}`
- `ruff --fix` + `ruff-format` over staged Python (`scripts/git-squash-daily.py`)
- `semgrep` over the repository's own three ORM-boundary rules (`.semgrep/`)
- `oxlint --type-aware --deny-warnings` for the staged workspace packages, dispatched by
  `scripts/local-gates/oxlint-changed.sh`

## commit-msg (history hygiene, sub-second)

`commitlint` against `commitlint.config.js` — the one validator. CI's `commits` job runs the same
file over the pull request's commits and over its title (GitHub uses the PR title as the squashed
subject on `main`), so a subject that passes locally passes there. It rejects unknown types and
scopes, subjects over 72 characters, generic outcomes (`wip`, `checkpoint`, `update`, …), a subject
that starts with anything but a lowercase verb, an issue reference in the subject — the single
exemption is the ` (#N)` GitHub's squash merge appends to the title it uses as that subject, which no
author writes and no author can remove (#1804) — and Claude/Anthropic/Codex/OpenAI `Co-Authored-By`
or `Generated with` trailers. Legitimate human and Dependabot co-authors survive, and `Merge …` /
`Revert "…"` subjects are exempt. Body and footer lines over 100 characters are rejected too — that
pair comes from `@commitlint/config-conventional`, which the config extends, not from a rule written
here.

Two ways to check a message without committing:

```bash
pnpm install                              # the hook brings its own CLI; this one is yours
pnpm exec commitlint --edit path/to/draft # one drafted message
pnpm exec commitlint --from origin/main   # every commit on the branch
```

**Not** `pre-commit run commitlint --hook-stage commit-msg`. The upstream hook is
`entry: commitlint --edit` with `pass_filenames: false`, so pre-commit discards the value of the
`--commit-msg-filename` it nonetheless demands, and commitlint always lints whatever sits in
`$(git rev-parse --git-dir)/COMMIT_EDITMSG`. Aimed at a file holding `wip` while `COMMIT_EDITMSG`
held a valid subject, it reports Passed — that run says nothing about the file you named.

## pre-push (`scripts/local-gates/pre-push-affected.sh`)

One hook — over the ≤40 the card asked for, and the reason is written into the script:
reading the pushed refs (below) and checking every path for an owner both take real code, and
shrinking them back would mean deleting a guard rather than tightening one.

**What is gated is `HEAD`'s diff, and the pushed refs are read to prove that is the right thing to
gate.** git hands a pre-push hook one `<local ref> <local sha> <remote ref> <remote sha>` record per
ref on stdin. The script reads those records, skips deletions (a zero local sha), and refuses any
whose local sha is not `HEAD`:

```text
pre-push: refs must be pushed from their own worktree (HEAD is <sha>, pushing <ref>@<sha>)
```

Gating such a push would be theatre: the changed paths would come from the pushed ref while
`pnpm ls` and every package script ran against the checked-out tree, so a broken change could pass
on another branch's green. Running the pushed ref's own suites would mean checking it out, which a
push hook has no business doing. This repository is one worktree per card, so `git push` from the
worktree that owns the branch — which is the only way anyone works here — never meets the rule.
Push `other` by checking `other` out.

`HEAD`'s diff is taken against its merge base with `origin/main`, or against the remote sha when
that is already an ancestor of `HEAD`, which narrows it to what the remote has not seen.

**The commit-message check runs over the commits this push adds** — `HEAD ^base ^origin/main`, not
the diff's `$base..HEAD` — and it runs before any package does, so a message CI's `commits` job would
reject stops the push in about a second rather than after the suites. Excluding `origin/main` is what
keeps a branch that merged `main` from being judged on main's own squash commits: the merge button
wrote those, and every one of them carries the ` (#N)` the commit-msg rules above exempt (#1804).

```text
pnpm exec commitlint --to <sha>^!
```

Each commit in that walk is read on its own, oldest first, because commitlint's history mode names
no sha — and `^!` is the commit and not its parents, where `<sha>^..<sha>` would read the line a
merge brought in. A rejection is reported as `pre-push: commitlint rejected <sha> <subject>`, and the
walk continues, so one push gets the whole list. A first push has no remote sha to exclude — it
arrives as zero, which is no object — so the merge base is the floor there. An empty walk (the remote
and `origin/main` already have `HEAD`) skips the check. A commitlint that cannot run at all — an
uninstalled workspace — fails the push with its own error and no attribution, never by absence. The
`commits` job's other half — the pull request title — still has no local reader; a push hook never
sees it.

pre-commit's pre-push wrapper consumes that stdin itself and re-exports the first pushable record
as `PRE_COMMIT_TO_REF` / `PRE_COMMIT_FROM_REF` (`pre_commit/commands/hook_impl.py`,
`_pre_push_ns`), so the script reads stdin when it is given any and falls back to those variables —
which is what keeps the refusal working under the wrapper too. For an ordinary push both name
`HEAD` and nothing is refused.

`pnpm ls -r --depth -1 --json` lists the workspace project directories; the script's routing table
(`ROUTES`) names, one row per workspace package, the buckets that package belongs to:

```text
<directory> <bucket>...
```

`package` is the package's own scripts below. The root project is dropped — it would match every
file by directory containment. A package `pnpm ls` reports with no row stops
the push, naming itself, whatever the diff holds:

```text
pre-push: packages/orphan is a workspace package with no routing row
```

So a package cannot leave the table, or be added without a row, and still be pushed:
`test/repo-config/pre-push-routing.test.rb` pins the table's domain against the
`pnpm-workspace.yaml` globs resolved against the tree, and the gate routes by that table, so the two
cannot disagree. Each script then runs once over the union of the selected
packages' dependent closures, through
`pnpm -r --workspace-concurrency=1 --filter "...<name>" … run --if-present`:

```text
lint → typecheck → test → test:integration
```

Every selected package's `...<name>` selector is handed to that one invocation —
pnpm unions repeated filters and runs each selected package exactly once — so a
`packages/contract` change gates its consumers, and a dependent shared by two
changed packages is gated once per push instead of once per selector (#1770).
`--no-renames` lists both sides of a rename, so a cross-package move gates the
source package too.

**Then the coverage reports.** After the fourth script the same union runs
`pnpm -r … exec ruby "$PWD/test/repo-config/check-coverage-report.rb"` (absolute, because `exec`
runs inside each package directory). node's test runner prints `100.00`
for a report whose `--test-coverage-include` matched nothing from its cwd — zero lines out of zero —
so a threshold passes having measured nothing (#1766). The check refuses a report with no `SF:`
entry, or with one that is not the package's own file at its repository-root-relative path (the
anchor Codecov maps). A package whose scripts run no node coverage passes untouched: which packages
are checked is read from their scripts, never listed. CI's `affected` job runs the same check for its
package before the Codecov upload.

**One package at a time.** `pnpm -r run` defaults to a concurrency of 4 (`pnpm help recursive`, pnpm
10.33.2) and a `...<name>` closure is wide — `packages/contract` pulls in all eight TypeScript
packages — so the suites used to run side by side on one laptop: `apps/web`'s vitest run blew its
5 s budgets (#1503) and the e2e lane's webServer died mid-run with `ERR_CONNECTION_REFUSED`, 16
failed, while that lane alone passed 43/43 in 34 s (#1369, #1517). That last lane is a fixed-resource
claimant no longer: since #1692 the emitted Worker's port is derived from the checkout running the
lane rather than hardcoded to `:8799` (`e2e/AGENTS.md` — `E2E_EMITTED_WORKER_PORT` pins it), so a
second worktree's lane is a second port instead of a claimant on this one. What is left is genuine
CPU and memory contention, which is why the serialization stays.
`--workspace-concurrency=1` keeps pnpm's topological order and runs one package at a time. It is set
on all four scripts and not on the suites alone: measured over the contract closure it cost `lint`
41 s against 32 s but ran `typecheck` in 15 s against 22 s (2026-09-08, 10 cores), so the
parallelism given up is a wash, and one form of the invocation is one fewer thing to keep true.
`make check-full` splits them only because it runs `pnpm -r` over every package unfiltered.

### Why the selection is git's and not pnpm's

pnpm has this exact selector — `--filter "...[<ref>]"` — and CI uses it. Locally we cannot: from a
linked git worktree **nested inside the repository** (`.worktrees/<card>/`, where every card is
developed) pnpm 10.33.2 answers `No projects matched the filters` and exits 0. `getChangedProjects`
resolves the repository root with `find.dir('.git')`, which walks up and finds the *parent* repo's
`.git` directory before the worktree's own `.git` file, so the changed paths are joined onto the
wrong repository root and match no project. Upstream issue: <https://github.com/pnpm/pnpm/issues/12626> (open).
Handing selection to pnpm here would be fail-open — a silent no-op gate — which is why the join is
done against `pnpm ls` output instead.

### The four buckets

A package's bucket membership is its routing-table row; the buckets below route paths outside every
pnpm project, which would otherwise be invisible to the join:

| Changed path | Bucket |
|---|---|
| `packages/pi-session-neon/migrations/**` | `prisma migration check` — artifact integrity and a connected graph, no container. The disposable fresh-schema apply lives in CI's `db` job and in `make check-full`. |
| `docs/**`, `.claude/**`, root-level `*.md`, an `AGENTS.md`, `CLAUDE.md` or `CONTEXT.md` at any depth, and the spec-reference gate's own three files (`check-spec-references.sh`, `check-spec-references.test.sh`, `spec-reference-exceptions.txt`) | `check-agents-refs.sh`, `check-docs-paths.sh`, `check-root-allowlist.sh`, `check-spec-references.sh` — the same four the CI `docs` job runs on every pull request. |
| `.github/**`, `scripts/**`, `test/repo-config/**` | CI's `contracts` job, through its own registry (#1883). `scripts/local-gates/repository-contracts.sh` reads the commands out of that job in `pr-verification.yml` and runs them, so the two sides read one list rather than two that have to agree — a contract joins the local gate by the same line that puts it in CI. These are the three families the job owns and no workspace package does: `.github/**` is what every `.github/test/*.test.rb` reads, `test/repo-config/**` is the contracts' own home, and `scripts/**` holds the two Orca runners the job runs, `delivery-test-naming.test.rb`'s four delivery homes and `pre-push-routing.test.rb`'s subject. 74 commands, measured at 38 s serial and 15 s at four (`--list` through `xargs -P4`, 2026-09-23, 10 cores); serial because CI runs the job serially and a local gate reproduces CI's verdict rather than a different execution shape. |
| `pnpm-lock.yaml`, root `package.json`, `pnpm-workspace.yaml`, `.npmrc` | Every workspace package. A root dependency change belongs to no project directory, and pnpm answers it with the root project alone — `...` adds none of its dependents — so "affected" has to mean everything. CI's `plan` job routes it the same way, through its `deps` paths-filter, and like CI's matrix this path drops the `...` closure: with every package already selected, the prefix would only re-run each one's dependents once per selected package. `.npmrc` was deleted with the pnpm 12 settings move (#1672) but stays in the pattern: `test/repo-config/pnpm-workspace-settings.test.rb` refuses a non-auth key there, and a re-added one still selects every package. |

### docs/specs liveness (#1649)

A spec nobody names cannot be found, reviewed or superseded. `check-spec-references.sh` requires
every tracked file under `docs/specs/` to appear by basename, as a whole word, in another tracked
file outside `docs/archive/` — the 2026-09-14 sweep that opened the card found four that did not,
three of them describing surfaces already gone. (Two specs sharing a basename still count as named
either is; none in the tree does.) A file that has to stay unreferenced goes in
`scripts/local-gates/spec-reference-exceptions.txt` with the canonical owner that justifies it —
the owner is free text (a path, an issue number or a surface name), and the gate requires only
that it is named. An entry with no owner, outside `docs/specs/`, naming an untracked path, or
written without the `|` separator fails the gate closed, and the gate's own files are never a
reference, so an entry cannot justify itself. Those three files — the gate, its behavioral test
and the owner table — fire the docs bucket on their own: `scripts/**` needs no package gate (it
selects the contracts bucket, above), and CI's `docs` job runs the same gate on every pull request.

### The whitelist, and failing closed

Paths that need no package gate, because another hook or a CI job already owns them:

```text
docs/**  .claude/**  .semgrep*
root-level *.md  codecov.yml  .codacy.yml  .sonarcloud.properties  supabase/**
.pre-commit-config.yaml  commitlint.config.js  Makefile  .gitignore
Gemfile  Gemfile.lock  .ruby-version  .env.example  .env.test.example
```

`Gemfile`, `Gemfile.lock` and `.ruby-version` pin the Ruby and minitest the `contracts` job runs
(#1774); that job's `workflow-ruby-toolchain.test.rb` holds them to the workflows' setup-ruby steps.

`.gitignore` is consumed by the repository secret scan and tracked-file checks; its exact root
path needs no package gate. A sibling such as `.gitignore-extra` remains unowned and fails closed.
`.codacy.yml` and `.sonarcloud.properties` configure CI-side analyzers with no local gate;
`supabase/**` is the archived historical migration directory (#1000), not a live surface, so
nothing in it is gated locally.

`.env.example` and `.env.test.example` are the root env SHEETS — operator documentation rather
than code, and the file an operator copies to a `.env.test` that is gitignored and never tracked.
`check-root-allowlist.sh` owns their top-level ENTRY, not their contents, so no local check has an
opinion about an edit to one; a credential pasted into either is caught by the pre-commit secret
scan, which reads the staged diff and does not route. They are whitelisted by name rather than left
ungated because the change that needed one was refused by this check — the fix that made four
documents true had to edit `.env.test.example` (#1813).

`.github/**`, `scripts/**` and `test/repo-config/**` left this list in #1883: CI's `contracts` job
owned them and no local gate read them — a path whose owner runs elsewhere is what this list is for,
and the owner did not run on a laptop — so the fix was the bucket above rather than a wider
exemption. A root config the contracts also read (`.gitleaks.toml`, `codecov.yml`, `Gemfile`) keeps
its entry: each is a single file with a reader of its own, and routing every config the contracts
touch would put the whole 74-command job on a push that moved one pin.

**Every** changed path has to be owned by something: a package whose routing row fired, a bucket
that actually fired, or the whitelist. Whatever is left over stops the push and is listed by name. The
check runs on the whole diff rather than only when nothing was selected — otherwise a commit that
touched `workers/catalog/src/` *and* added a stray top-level file would sail through on the strength
of its first half, which is exactly what it did until #1371's review caught it. A workspace package
with no routing row fails before that check even runs, on its own line and whatever the diff holds,
so coverage of the table cannot be mistaken for coverage of the paths.

A path the diff **deletes** is covered by definition: there is nothing left to gate, and `pnpm ls`
answers from the surviving tree, so a deleted package could never cover its own deleted files
(#1607) — the approved Python-agent deletion pushed this rule into the open. The waiver applies to
the ownership check only: deletions still select packages and count in the bucket tallies, so
removing a file inside a surviving package still gates that package, and removing a docs file still
fires the docs checks.

A new top-level directory, a new tool config: both stop the push with their own names in the
message rather than passing unexamined. The fix is to give the path a home — a package, a bucket,
or a reviewed whitelist entry — not to widen the pattern reflexively. (`commitlint.config.js` is on
the whitelist because turning this check on found it owned by nothing at all.)

The ownership set is built from what actually happened, so it also backstops the selection itself.
Each bucket adds its own paths only when it fired, and each package a changed path falls in adds its
directory, so breaking the prefix join or deleting a bucket leaves the paths they used to own
unaccounted and the push goes red naming them. That is also why the loop skips a blank project line:
an empty `pnpm ls` result still yields one, and without the guard it would match every file and fill
the package set with nothing.

## `make check-full` (manual, not a hook)

The everything-run, for a large refactor or when a lockfile change makes "affected" mean everything:

```text
pnpm -r run --if-present lint | typecheck                 parallel
pnpm -r --workspace-concurrency=1 run --if-present test | test:integration
scripts/local-gates/db-fresh-schema.sh        disposable fresh-schema apply (Docker)
```

The two suite segments run one package at a time on purpose. pnpm's default is one job per CPU, and
several packages' suites claim a fixed resource — a package's `test:integration` can boot
test-postgres, catalog's among them (its database suite is out of `test` since #1473 and runs in
the `test:integration` segment above) — while the browser suite, which used to be the loudest one,
now derives its port per checkout (#1692). In parallel they starve each other: nine browser specs
failed with `ERR_CONNECTION_REFUSED` while the same suite passed 43/43 on its own (2026-09-08).

## What stays in CI

- **Playwright browser e2e** (`make e2e`, the `animichi-e2e` package) — CI's `e2e` job owns it.
- **Live-Neon integration** (`TEST_DB=neon`) and BYO mutation databases — real data planes; a manual
  local option only, and not a CI lane either since #1053.
- **Model-backed evals** (`packages/eval`) — paid, non-deterministic, and not run in CI either.
- **Deploys and cloud commands** — `wrangler deploy`, mutating `pulumi`, codecov upload, `gh pr`.
- **The repository tests' *delivery* half, and the gate scripts' own behavioral tests** — CI runs
  them unconditionally, on every pull request, and the `delivery-toolchain` lane owns them:
  `docs` runs the four docs-hygiene `check-*.test.sh` suites, and the lane runs
  `.github/scripts/delivery-toolchain-tests.sh`, which enumerates `.github/test/delivery/`,
  `scripts/local-gates/`, `scripts/delivery/` and `.github/scripts/`.
  `workflow-invocations.test.rb` asserts that every Ruby test in those directories and every
  shell check under `scripts/` and `.github/scripts/` is invoked by its exact path, and that every invoked
  repository script still exists. Deleting a check also requires deleting its CI invocation.
  The `contracts` job's own 74 commands are no longer in this list: #1883 gave them the pre-push bucket
  above, and `repository-contracts.sh` reads them out of the job rather than restating them.

## Prerequisites

An installed workspace (`pnpm install`) — the message check runs `pnpm exec commitlint` and every
selected package's scripts need their dependencies — plus `git`, `pnpm`, `node` ≥ 24, `jq`,
plus the pre-commit tools: `shellcheck`,
`actionlint`, `uv` (it installs `semgrep` 1.172.0), and for the contracts bucket `.ruby-version`'s
Ruby with the Gemfile's gems installed (`bundle install`) — a push that runs the registry runs
`bundle exec ruby` on every line.

## Failure handling

- pre-commit: fix in the working tree and re-run — the fixer hooks modify files, so re-stage.
- pre-push: fix it. When the failure is environmental (no Docker daemon), say so in the
  push and repair it; do not reach for `--no-verify`.
- "no gate covers these files": read the list. Each name is a path the repository has no opinion
  about yet.

## Files

- `scripts/local-gates/pre-push-affected.sh` — the pre-push gate
- `scripts/local-gates/repository-contracts.sh` — the `contracts` job's registry, read out of
  `pr-verification.yml` and run before a push that would break it (#1883)
- `scripts/local-gates/oxlint-changed.sh` — pre-commit oxlint dispatch (staged)
- `scripts/local-gates/check-agents-refs.sh` / `check-docs-paths.sh` / `check-root-allowlist.sh` /
  `check-spec-references.sh` — the documentation hygiene checks, shared with CI's `docs` job
- `scripts/local-gates/spec-reference-exceptions.txt` — the docs/specs files allowed to stay
  unreferenced, each with its canonical owner
- `scripts/local-gates/db-fresh-schema.sh` — disposable fresh-schema apply (CI's `db` job,
  `make check-full`)
- `scripts/local-gates/infra-check.sh` — credential-free Pulumi program load (`infra`'s own `test`)
- `scripts/local-gates/contract-drift.sh` — staged-snapshot OpenAPI drift (`@animichi/contract`'s
  own `test`)
- `test/repo-config/pre-push-routing.test.rb` — the routing table against the workspace: every
  `pnpm-workspace.yaml` package has a row, every row names a workspace package and a known bucket
- `scripts/local-gates/pre-push-fixture.sh` — the throwaway repository, the fake `pnpm` / `make`
  and the assertions `pre-push-affected.test.sh` (which packages a diff selects),
  `pre-push-affected-commitlint.test.sh` (which messages a push carries) and
  `pre-push-affected-contracts.test.sh` (which diffs fire the contracts bucket) share
- `scripts/local-gates/*.test.sh` + `stub-env.sh` + `test-stub.sh` — those scripts' behavioral tests
  and the stub harness they share; CI's `contracts` job runs the non-docs `*.test.sh`, and its `docs`
  job runs the four `check-*.test.sh` suites
- `commitlint.config.js` — the commit-message and PR-title rules; their exemption and its boundary
  are driven through this workspace's own CLI by
  `scripts/local-gates/pre-push-affected-commitlint-config.test.sh`
- `.pre-commit-config.yaml` — hook wiring for all three stages
- This document — the contract

The TypeScript `@animichi/agent` domain library participates in this matrix. Its `workspace:*`
dependency from `edge-worker` makes domain changes select the real edge consumer as well.

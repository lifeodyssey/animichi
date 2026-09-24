# CI and GitHub mechanics — diagnosing what the green does not say

Read when a PR is green but will not merge, when a workflow fails before any job starts, or when
"it passes locally" is offered as evidence. The gates themselves are `docs/ops/local-gates.md`
and `.claude/rules/ci.md`; the merge rules are `docs/ops/review-gate.md`.

## Green but BLOCKED

A check that produced nothing is not red. It is absent, and no filter of `gh pr checks` shows
it. On 2026-08-06 a PR showed 37 successful checks, zero failures, zero pending, and stayed
BLOCKED: the workflow that produced the required contexts had a `startup_failure` (zero jobs
started), so the contexts never appeared. The only criterion that works is the set difference:

```bash
gh pr checks <n> --json name,state --jq '[.[]|select(.state=="SUCCESS")|.name]'
gh api repos/<o>/<r>/rulesets/<id> \
  --jq '.rules[]|select(.type=="required_status_checks")|.parameters.required_status_checks[].context'
```

Required minus successful is what is missing. "Nothing red" and "everything required passed" are
different propositions; the first does not imply the second. Branch protection matches names as
strings, so a renamed context or a producer that did not run waits forever instead of failing.

Diagnosis order when `mergeStateStatus` is BLOCKED and nothing is red:

1. `gh pr checks`: an empty failure list means "unsatisfied", not "failed".
2. `reviewThreads(isResolved:false)` count: zero rules out threads.
3. The ruleset's required contexts against the checks actually present on the head.
4. `gh api repos/<o>/<r>/commits/<sha>/check-runs` for checks whose app is not `github-actions`:
   CodeQL, codecov, SonarCloud. A CodeQL check-run with conclusion `neutral` ("1 configuration not
   found", meaning the baseline comparison failed) blocks the ruleset's `code_scanning` rule while the
   workflow run is green; `gh run rerun <run-id>` turned it to `success` in about three minutes
   (2026-08-03). Re-query the ruleset's rules and the head's check-runs rather than assuming which
   checks exist today.
5. `gh run list` for `startup_failure`; it never appears on the PR's check list.

CodeRabbit on this public repository runs on a free OSS quota. When it is exhausted it posts a
top-level comment ("Review limit reached — next included review available in N minutes") and
reviews nothing; an incremental review then sits on "Currently processing new changes…" forever.
It publishes no check-run. Read the comment body: `gh api repos/<o>/<r>/issues/<n>/comments` filtered to the
`coderabbitai` author, and grep `Review limit reached` and `Currently processing new changes`.
Report it as "CodeRabbit could not review because of its quota", never as "no bot findings"
(2026-09-23).

## Ruleset facts for a solo repository

- A required approving review is structurally unsatisfiable here: the author cannot approve their
  own PR, there is no CODEOWNERS, and the review seats are not GitHub accounts. The owner removed
  that requirement on 2026-07-29 and kept only machine-decidable rules. Required checks today are
  `PR Verification` and `Security` (`docs/ops/review-gate.md`), plus
  `required_review_thread_resolution` (owner, 2026-08-25: thread resolution never produces a red
  check, which suits the owner's dislike of red CI).
- The ruleset allows the squash method only; `gh pr merge --merge` is refused.
- Classic branch protection returns 404 while the ruleset is fully active. Query
  `gh api repos/<o>/<r>/rulesets`, not the branch-protection endpoint, before concluding "no
  protection".
- Never `--admin` past a governance gate; that decision is the owner's.

## Workflow failures that surface only when GitHub compiles

A failure at GitHub's compile step is a `startup_failure` with no check-run, no annotation and
nothing in `gh run view --log`; the only visible error is the red "Invalid workflow file" banner on
the run page (the authoring rule is in `.claude/rules/ci.md`):

- A reusable workflow's job cannot request permissions above what the caller grants
  (2026-06-24: a `security-events: write` job under a `contents: read` caller); actionlint does
  not compare a called workflow's permissions with its caller's. Delete the permission the job
  does not need rather than widening the caller.
- The `secrets` context is not allowed in a step or job `if:` (2026-06-28; YAML parsing and
  `act -n` accepted it). actionlint refuses it (`context "secrets" is not allowed here`) and the
  pre-commit hook runs actionlint over the staged workflow files (`docs/ops/local-gates.md`), so
  today it reaches GitHub only past a bypassed hook. Put the secret in the step's `env:` and test
  it in `run:`, or use a workflow- or job-level `env`.
- Nothing runs on a bare branch push here: `pr-verification.yml` runs on `pull_request`,
  `merge_group` and `push` to `main`, and the other workflows on `main` or by dispatch. A draft PR
  is what makes GitHub compile a structural workflow change before it reaches `main`.
- An annotated tag's `git/refs/tags/<tag>` object SHA is the tag object, not the commit. Pin
  actions with `gh api repos/<o>/<r>/commits/<tag> --jq .sha`, which dereferences to the commit;
  zizmor's `ref-version-mismatch` catches the other one.
- Run zizmor exactly as CI does (`.claude/rules/ci.md` pins the persona; its online audits need a
  token). A bare offline run does not gate at the same level and gives a local green the CI turns
  red.

## "It works in my container / on my machine"

- Before using a container as a control for a CI failure, prove it can do what CI does:
  `uname -m` for the architecture, `curl -sI https://github.com` for network. On 2026-08-04 both
  arms of a comparison failed for the same unrelated reason (the sandbox had no route to GitHub)
  and the comparison was read as "no difference". Two failing arms mean a shared cause until shown
  otherwise.
- Job-level bisection needs no local environment: find the last green and the first red run,
  `gh run view --json headSha` for each, and diff the commits between them.
- Clear package caches (`~/.npm/_npx`, `~/.cache/uv`) before claiming an install-time change still
  works; a warm cache makes a skipped install step look functional.
- A directory outside the pnpm workspace (`infra/database-access/` has its own `node_modules`)
  keeps packages that CI's root `pnpm install --frozen-lockfile` never installs. On 2026-09-16 a
  dependency removed from `infra/package.json` still resolved locally and failed CI with TS2307.
  Prove red/green in a CI-like layout: move the stray `node_modules` aside, or use a fresh clone.
- Local Ruby is not CI's Ruby unless it is `.ruby-version`'s: on 2026-09-17 the system Ruby 2.6
  passed a suite that failed on Ruby 3 with `wrong number of arguments` (keyword-argument
  conversion). `docs/agents/package-managers.md` records the Bundler form that refuses other Rubies.
- `build` is not `typecheck`: `apps/web`'s Vite build does not run `tsc`. A contract change
  (2026-07-19: `screenshot_url` made nullable in the catalog while a web consumer still required a
  string) passed both packages' own lanes because each PR ran only its own package. Run the
  whole-workspace typecheck for a `packages/contract` or shared-type change. The pre-push gate now
  covers dependents through the `...<name>` closure (`docs/ops/local-gates.md`), so this is a
  verification habit, not a substitute for the gate.

## Gates that were never in effect

- A threshold lives in exactly one place. A coverage floor declared in one config and overridden
  by a CLI flag in CI (2026-07-26: 82 declared, 80 run) gives two gates that agree while green and
  disagree only when one should have stopped something.
- Before changing a rule-type configuration, prove it is in effect: look for a CLI override, a
  `continue-on-error`, or a path filter that skips the gate on the PR that edits the gate itself,
  a gate that cannot test itself.
- Judge threshold headroom in absolute units, not percentage points: a 0.17% margin was 12
  coverage units, small enough for an unrelated compliant PR to trip it. Repairing a dormant gate
  also gives it, for the first time, the power to hurt.

## ESC traps (2026-09-08)

- `pulumi/esc-action` writes every `environmentVariables` key of an opened environment to step
  outputs before the export list selects what goes into `env`. The export list controls the job
  environment, not trust: any job that opens the environment can read all of them. Runtime secrets
  therefore live under `pulumiConfig` as `fn::secret`, which the action does not export
  (`docs/ops/secrets.md`).
- `export-environment-variables` takes a comma-separated list; `keys` is the deprecated input.

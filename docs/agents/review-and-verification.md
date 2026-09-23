# Review and verification — the false greens recorded here

Mutation testing is the only green-light proof (`docs/agents/harness.md`,
`docs/ops/review-gate.md`); the review bar is the coordinator skill's readability-first bar.
This file is the catalogue of ways a green lied on this repository, and the technique that caught
each one.

## Four ways a test passed for the wrong reason (2026-07-26, four PRs in one day)

| Mechanism | What it hid |
|---|---|
| A fixture omitted fields the real contract always sends as sentinels (`""`, `-1`) | the `=== undefined` branch was dead in production: photo-first ordering off, `<img src="">`, "第-1話" rendered |
| Both sides of a wire protocol defined their own header constant and each test imported the one it tested | renaming one side stayed green; anonymous turns silently lost the token |
| Playwright mocked `/v1/chat` at `page.route`, so an "integration" AC never crossed the worker | the edge draining the SSE stream was invisible |
| Deleting the metering call left 1322 unit tests green | the only writer of `daily_usage` was gone; the circuit breaker would never trip |

CI reports how many tests ran, not what they guard. Fixtures are cleaner than real payloads,
constants are imported by their own tests, mocks sit in front of the boundary under test. So:

- Briefs say: before reporting done, mutate each new piece of logic, watch its test fail, restore,
  and paste the evidence. Review briefs say the same for the reviewer: run the mutation; do not
  judge by test names.
- Read the contract (`packages/contract/src/models.ts`) before writing a fixture: which fields are
  required, and what "absent" looks like on the wire. Do not copy another test's fixture; false
  greens travel through fixtures.
- Ask "if this line broke, which test goes red?", not "did I test it?". No answer means untested.
- Suites that stop at the first failure hide which cases went red: a mutation on 2026-09-23 turned
  the suite red on an earlier case while the new case, which tested nothing, never ran. Run each
  case on its own and cite the set of cases that went red, not "the suite went red".

## A mutation that did not go red has two explanations

Either the assertion is weak, or the mutation never reached its scope. Three times in one day
(2026-08-06) it was the second: a suffix appended to a name still matched a substring assertion; a
path was deleted from a file the guard did not cover; a decoy was inserted in a branch the test
never walked. Technique:

1. Read what the assertion covers (constant list, path glob, component map) and put the mutation
   inside that set.
2. Substring and containment assertions: replace, do not append. Numeric assertions: cross the
   boundary, do not nudge.
3. Prefer calling the function under test directly and reading its return value; "test passed" can
   mean "handled the mutation" or "never executed".
4. Regex criteria need digit boundaries (`(^|[^0-9])0 passed`, because `30 passed` contains
   `0 passed`); use real historical logs as regression cases.
5. A test an AC names as the mutation target must be able to observe that mutation; a timing
   assertion whose two lines never tie cannot observe a removed tie-break (2026-09-06).
6. Reverting: `cp` the file to a backup before the probe and `cp` it back, never
   `git checkout --` while the tree holds uncommitted work; it restored HEAD and ate the change
   under review, and the confirmation run covered only one language side (2026-08-26, four times in
   a day). Rerun the tests of every language side a mutated file touches; the red count must be
   predictable, or the mutation was not clean. "All green" in a report counts only if it was rerun
   after the probe.
7. Whether a surviving mutant is fixed now or filed: ask whether the card has slack and whether the
   surviving shape is the same class as the original bug, not what severity label it carries.

## Fake boundaries: tests green, real run fails

- A fake returns a format the real adapter never produces (a full filename where the database
  returns a version prefix): 48 tests green, and `appliedHead === expectedHead` never true in
  production. Check the real return format once, and pin the fake to a literal from the real
  source, not a re-derivation of the same code.
- A success criterion that is already true before the action (equal heads with nothing to
  migrate) reports success when the action crashes. Compare before/after deltas, not the absolute
  end state.
- A best-effort read that swallows exceptions and returns `null` collapses "empty" and "failed"
  into one observation. Give failure its own representation.
- "The scanner is green" needs a probe that must go red: gitleaks ran with zero rules until a fake
  token was planted (`.gitleaks.toml` now extends the defaults for that reason). Before trusting a
  scanner or a guard, plant what it must catch and watch it fail.
- A guard over a tool's configuration must cover every discovery path the tool has (a sibling
  config file, an environment variable, nested configs), each mutated.
- A read-only API under insufficient permissions may answer `200` with an empty list, not `403`
  (Cloudflare Access identity providers). "The list is empty" first asks "can this token see it?".
- Zero-result outputs are the most dangerous shape: "No tests collected", "No errors found",
  "Everything up-to-date" look identical whether the tool found nothing or never ran. Verify by
  side effects: `git ls-remote` after a push, `git log -1` after a commit, a pass count rather
  than "no failures". A pipe hands `$?` to its last command; use `${PIPESTATUS[0]}` (2026-08-03).
  Before trusting "X does not exist", search again with different keywords and say which you
  tried; a single-keyword negative is the commonest false conclusion.
- Measurement needs a control: a `robots.txt` that returned 200 from a Worker's hostname returned
  the same bytes from a hostname that never existed (a zone-level file). A liveness or existence
  probe proves nothing until a known-absent case answers differently.

## Text in the repository is not evidence

Two independent review seats reached the same wrong P1 from a stale handoff document that called
a gate "dormant" after it had been wired (2026-07-29). Independence protects seats from each
other, not from a shared false text; two approvals built on it give false confidence. Comments, PR
descriptions and issue bodies are claims. A finding about "is this path called" or "what is this
default" lands on the source or the dependency's implementation. Fix a stale comment in the PR
that finds it. And a claim about where the false text came from is a claim too: "I verified the
code" is not "I verified the attribution".

- Sub-agents may read a stale `AGENTS.md` from the session's checkout: five writers in one day
  reported a script that `main` had already replaced. Compare with `git show origin/main:AGENTS.md`.
- Present-tense statements in a document must be greppable on `main`; pending work is written as
  "to be introduced by #<n>".
- A provider SDK's `.d.ts` enum names are per-language display names, not wire values
  (`nonIdentity` in the types, `non_identity` on the API); mocked infra tests never check them, CD
  did. Confirm against the provider's embedded schema or the vendor API.
- The hookify rules `docs/agents/harness.md` names live in gitignored `.claude/` files;
  `git ls-files` cannot see them, and "does not exist" from it is wrong. Check the owner's Claude
  Code hook and settings files and the repository's `.claude/` directory, ignored files included.

## What a review seat's verdict is worth

- Two seats finding the same thing independently is the strongest signal there is. Two seats in
  conflict: do not count votes; read the twenty lines yourself. On 2026-07-29 one seat had the
  mechanism right and the other had the defect right, and adopting either alone fixed the wrong
  thing.
- A surviving mutant has three causes with opposite conclusions: the test is weak; the mutation
  never landed (BSD `sed` ignoring a GNU address; a replace that hit a comment); the test harness
  differs from runtime (a middleware stripping a base path before the hook saw it). Assert the
  mutation reached the target structure before reading the test result.
- Configuration is intent, not fact: a `wrangler.toml` that "serves the full site" served 404
  because the deploy had never succeeded. One `curl` beats an inference chain.
- Before accepting a "remove this no-op" nit on a workflow or config, check the CI linters and the
  repository's existing pattern: deleting a per-`run_id` job `concurrency` block that "never
  contends" failed zizmor's concurrency-limits audit and the required `Security` check (#1667,
  2026-09-15).
- Deleting a false claim beats relocating it: a search action pointing at a login-walled route is
  the same false declaration as the one it replaced, only quieter.
- Arbitrate by `git diff`, never by a seat's claim of scope; a seat once carried memory of the
  previous task into this one and reported a confident P1 about a file in another PR. A lead who
  takes over reruns every gate; "gates green" from the previous lead had covered one language side.
- Conclusions written at a strength the evidence does not support get copied by writers into
  comments, commit messages and PR bodies: three times on 2026-09-16, each caught only by a
  different-model reviewer. Write "recorded as the other direction, spec still PROPOSED", not
  "already overturned". Mark inferences in briefs as inferences and ask the writer to falsify
  them. Fix a false statement in every copy.

## Writers weaken tests and patch environments

A writer once hand-edited `node_modules` in three places (a shim package, a vendored react-dom,
507 binary assets rewritten as data URIs) to get a green gate, and reported that CI would be
unaffected; a clean install reproduced exactly the failures it had "fixed" (2026-08-05). Writers
also weaken assertions, add skips, mock the logic under test, adjust expectations to wrong code,
or add suppressions. Verification checklist:

1. Read the tests the writer added or changed; assertions must be hard and about real behaviour.
2. `git diff` the existing tests: no weakened assertions, new skips, deleted tests, mocked SUT.
3. `git grep -nE "skip|xfail|ts-ignore|eslint-disable|noqa"` over the changed files.
4. A new import with no lockfile change is a danger sign; a dependency change is verified against
   the lockfile and against the main checkout.
5. Briefs say "do not modify `node_modules`; if a package will not install, report that it needs
   to become a real dependency". Before trusting a green,
   `rm -rf node_modules && pnpm install --frozen-lockfile` and rerun.
6. Run the gates yourself; a self-report of green (or of a commit) is not evidence.
7. Judge a worker by its diff and its side effects, never by its exit code.

## Run the project's gate, not one you invented

Independent verification means running the same command the project enforces (the package
script, the `.pre-commit-config.yaml` entry, the commands in `docs/ops/local-gates.md`) with its
targets, flags, cwd and file scope. A broad self-invented invocation once reported 343 errors
against work the real gate accepted, because the real gate scoped the check on purpose.

## Before closing, deleting or merging anything

Task state is not vibe state. Three proposals to close or delete tasks from memory impressions
were all wrong on evidence review (2026-07-17). Grep or read the artefacts the task would have
produced and present the evidence with the recommendation; if completion is unverifiable, say so
and fold the verification into the natural review point.

## Renames, research and slow loops

- Deleting or renaming a file: grep the old name and the new name, whole tree. A "complete" list
  built from the new name alone missed the four tests that referenced the old filename and broke
  CI (2026-08-26). A list handed to a sub-agent as complete must be complete, or say it is not.
- Tests that locate by filename are layout coupling; locate by table or version. Assert SQL by
  meaning, after normalising quotes and whitespace, not by literal rendering.
- Platform-capability research enumerates the vendor's whole catalogue first (the products page,
  the docs index) and compares second. "Platform X has no Y" is asserted only after a live docs
  check; the owner opened the dashboard and found twelve services outside a nine-assumption audit
  (2026-08-03).
- A trial-and-error loop with slow feedback (CI, remote, migrations) stops and writes a decision
  document first (problem, measured facts, candidate options with pros and cons, recommendation)
  under the live iteration directory (`docs/DOCS_POLICY.md`), for one owner review (2026-06-30).
- A slow verification is not a stuck one: judge a stall by the log's last write, never by the wall
  clock (owner, 2026-07-08). Before a paid rerun, cast a wide `ps` net and check output mtimes; a
  narrow `pgrep` once declared a live run dead and the rerun doubled the cost.
- Never hand-edit a tree a worker is writing in; the worker's final write clobbered five edits.
  After a multi-PR campaign, fresh-clone the integration tree and run
  `pnpm install --frozen-lockfile` plus the test suites: five PRs whose lockfiles were each
  consistent with their own base auto-merged into a lockfile that was semantically broken
  (2026-07-12).

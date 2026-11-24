# Review and verification — the false greens recorded here

Mutation testing is the only green-light proof (`docs/agents/harness.md`,
`docs/ops/review-gate.md`); the review bar is the readability-first bar below.
This file is the catalogue of ways a green lied on this repository, and the technique that caught
each one.

## Readability-first review bar

Owner decision 2026-09-15, after review loops grew findings (42 → 8 → 20) and
contract tests grew anti-obfuscation cases no maintainer needs:

- **Must fix:** violations of written repository rules (1-10-50, test-file
  size, conditional logic in tests, `any`, suppressions, statements the patch
  made false) and real defects or AC gaps.
- **Judgement / nit / optional:** fix only when the fix makes the code shorter
  or plainer. If it would add a file, a test double, an abstraction, test
  variants or net lines, do not fix it; the fixer records a one-line reason and
  the reviewer confirms the reason. Such items do not block merge-clean.
- Fixer briefs default to subtraction: delete or inline first, report the net
  line delta. Contract tests prove the AC's one or two facts in the shortest
  readable form and do not defend against adversarial rewrites.
- Review briefs ask the reviewer to state, per finding, whether the proposed
  correction adds or removes code, and to apply the two tiers above.
- Apply this bar to similar choice points without asking the owner.

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
- Ask "if this line broke, which test goes red?", not "did I test it?". No answer means untested:
  in #2073 no test held the two lines of the catalog's `preview.ts` that carry a caller's cancel,
  each deletion mutant left all 771 worker tests green, and #2073 added a case for each
  (2026-11-19). A line coverage reports as hit is no answer either; coverage counts execution, not
  assertion.
- A safety argument needs a case for the behaviour it rests on. The rollback compatibility of
  #2076 rested on the run record's reader keeping any number; nothing pinned it, and a reviewer's
  mutation of the reader to `=== 1` survived (2026-11-19). "Both versions keep X, so a rollback is
  safe" makes X a case of its own, green on the base and red under that mutation.
- Suites that stop at the first failure hide which cases went red: a mutation on 2026-09-23 turned
  the suite red on an earlier case while the new case, which tested nothing, never ran. Run each
  case on its own and cite the set of cases that went red, not "the suite went red".

## Codecov counts an untaken branch as a miss (2026-11-19)

The patch gate (`codecov.yml`, 95%) counts a line with an untaken branch as partial, not covered.

- Read the head lcov's `BRDA` records before guessing which lines Codecov means. The catalog
  worker lane's coverage provider, istanbul, records a default parameter as a `default-arg` branch
  on the signature line, so a default that no caller relies on is an untaken branch: the two
  untaken branches Codecov reported on #2073 were `cfg = {}` defaults that no caller used
  (2026-11-19).
- On a deletion-heavy PR few lines are added and one partial line swings the ratio. Intersect the
  diff's added `src` lines with the head lcov's `DA` and `BRDA` records before pushing, as #2077
  did: 67 added source lines, none of them coverable (2026-11-19).

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
8. Pins that freeze a swap must also hold its side outputs: log fields, alert events, headers,
   everything an operator reads. On 2026-11-23 (#2101) four edits to the request-record `class`
   survived all 1342 node tests. The pins asserted statuses, bodies and the doubles' call logs, and
   the deleted unit test that had held the class was mapped to status codes, which do not carry
   it. Twenty entry-level record rows closed it, each proven green on the old code first.
9. A survivor can be equivalent by today's configuration. The same day, two budget-skip mutants
   survived: the only caller's GET routes were all low cost and its POST routes all high cost, so
   "GET" and "low cost" picked out the same requests. Prove that from the code and write it down. A
   pin for it would freeze a coincidence of today's table, not a behaviour.
10. A test that pins a workflow's text survives mutants that break what the workflow does. In #2118
    (2026-11-24) moving the new `migrator` block below the `GITHUB_OUTPUT` echo kept the text pin
    green while the step selected only `["api"]` for a release-only change.
    `.github/test/pr-verification-plan.test.rb` now extracts the step's own script from the
    workflow, runs it with stubs for `pnpm` and `git`, and asserts the packages it writes.

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
- A stub that never loaded runs the real tool. On 2026-11-23 a gate test sourced its stub
  environment by a relative path. The stub links it made dangled, `PATH` fell through to the real
  binaries, and the real `pulumi install` ran once outside the sandbox the check was meant to run
  in. Source `scripts/local-gates/stub-env.sh` by an absolute path, as the existing tests do
  (`source "$SCRIPT_DIR/stub-env.sh"`), and check that every stub link resolves before the run.
- A read-only API under insufficient permissions may answer `200` with an empty list, not `403`
  (Cloudflare Access identity providers). "The list is empty" first asks "can this token see it?".
- Zero-result outputs are the most dangerous shape: "No tests collected", "No errors found",
  "Everything up-to-date" look identical whether the tool found nothing or never ran. Verify by
  side effects: `git ls-remote` after a push, `git log -1` after a commit, a pass count rather
  than "no failures". A pipe hands `$?` to its last command; use `${PIPESTATUS[0]}` (2026-08-03).
  Before trusting "X does not exist", search again with different keywords and say which you
  tried; a single-keyword negative is the commonest false conclusion.
- A search pattern can match nothing by construction. With Apple Git 2.54 on macOS, `git grep -E`
  with `\b` or `\<…\>` matched nothing and exited 1 silently, where `-F`, `-wF` and `-P` found the
  name (checked 2026-11-20); a negative from such a search reads as "no caller". Search fixed
  strings (`-F`), in several shapes.
- A pathspec can match nothing the same way. A wildcard pathspec must match the whole path, so
  `git grep -F "builder.public[" -- 'workers/*/src'` names only paths that end in `/src` and found
  nothing, while `-- workers` found `workers/catalog/src/import/switch.ts`. On 2026-11-20 that
  emptied part of the reader search before the `cluster_version` and `itinerary_snapshots` drop
  (the computed-access shapes) until a known hit was searched with the same pathspec. Pass
  directories (`-- workers packages`),
  `'workers/*/src/*'`, or `':(glob)workers/*/src/**'`, and check the pathspec against a known hit.
- zsh, the default shell on macOS, reads three Bash habits differently (2026-11-23). Two of them
  print nothing instead of failing:
  - an unquoted variable holding several paths is not split, so `git diff -- $P` received one
    pathspec that matched nothing, and a frozen-test check printed 0 added, 0 removed where 12
    rows had been added;
  - `$b[bot]` inside a double-quoted string is array subscripting, so a `jq` filter compared
    against an empty string and printed not even its own header lines.

  The third fails loudly, but takes the good results with it. When one glob matches nothing,
  `nomatch` aborts the whole command with an error and exit status 1, even when the command's own
  stderr is redirected. An `ls` over two patterns therefore listed neither.

  Quote pathspec globs, brace variables (`${b}[bot]`), and check each search against a known hit.
- A selector that matches nothing passes, and one that is ignored runs everything. A
  `pnpm --filter` that matches no package prints `Scope: 0 of <n> workspace projects` and exits 0
  (pnpm 12.4.2); `--fail-if-no-match` makes it exit 1. The gate commands quoted in PR bodies have
  carried the flag since #2049 (2026-11-18), with no incident on record; `docs/ops/local-gates.md`
  records the same exit 0 from a nested worktree. `pnpm run <script> -- <args>` passes the `--`
  on, and vitest ignores a file filter after it: `pnpm --filter migrator run test -- <file>` ran
  the package's whole suite, and the same command without the `--` ran only that file (pnpm
  12.4.2, vitest 4.1.12, checked 2026-11-20). Pass vitest arguments without `--`.
- Measurement needs a control: a `robots.txt` that returned 200 from a Worker's hostname returned
  the same bytes from a hostname that never existed (a zone-level file). A liveness or existence
  probe proves nothing until a known-absent case answers differently. A bundle diff needs one too:
  build the base twice and confirm the two `index.js` files are byte-identical, then diff base
  against head and classify every differing line. In #2077 (2026-11-19) 20 lines differed: 17
  esbuild module markers matching the move table, and 3 for one function rename.

## A guard that never ran (2026-11-22)

During a review, a multi-worker Miniflare probe set `outboundService`, the refuser meant to stop
every outbound request, at the top level of a config that also had a `workers:` array. Miniflare
reads worker options only from that array, and `outboundService` is a worker option, so the refuser
never ran. Each cache miss on the API Worker's image proxy then went to the network: three requests
to `image.anitabi.cn` from a development machine, which the root guide forbids. The probe's empty
interception record is what exposed it.

- **Configure the refuser per worker**, inside `workers:`.
- **A guard proves itself only by recording a planted attempt.** Send one request the guard must
  refuse, see it recorded and refused, and only then run the check.
- **Pre-fill caches where the check allows,** so that the proxy has no reason to fetch at all.

## Tools that phone home on their own (2026-11-23)

Tests stub what the code calls. A tool that a gate runs can call out by itself, and no test double
sees that. Each tool below was run inside a sandbox that refuses every outbound connection, proven
to refuse before it was relied on (#2099). Where a fact comes from the tool's source instead, the
line says so.

- **Wrangler:** in the sandbox, one `wrangler deploy --dry-run` attempted to send three usage
  events, and none with `WRANGLER_SEND_METRICS=false`. Its installed source (4.165.0) adds what
  the run did not exercise:
  - telemetry is on by default wherever no choice was ever recorded, CI included;
  - when Wrangler detects an AI agent from the environment, it also fetches a listing from
    `api.github.com` and reads the agent's skills directory, behind the same switch;
  - its banner starts an npm update check, which `WRANGLER_HIDE_BANNER=true` skips.
- **Pulumi** asks `api.pulumi.com` for the latest CLI version on every command,
  `--non-interactive` included, unless `PULUMI_SKIP_UPDATE_CHECK=true` is set.
- **Semgrep** asks `semgrep.dev` for the latest version unless it is given
  `--disable-version-check`; `--metrics=off` keeps its metrics off.

The switches live in the code and the gates that start each tool, not in one machine's
environment, so CI and every agent get them. Anything new that starts one of these tools takes the
same switch. To prove a new switch, run the tool inside the sandbox twice: without the switch the
attempt shows and is refused, and with it nothing is attempted.

## Work moved to first use moves its failures (2026-11-24)

#2117 moved the migrator's load of Prisma control from startup to the first call that needs it, and
#2119 did the same for the catalog and users Workers.

- **The test that caught a failure at startup can stop seeing it.** The release script
  (`.github/scripts/release/build-worker.mjs`) re-resolves the migrator's `fdir` alias. Before
  #2117 a release build without the alias failed to boot. After it, the boot and the startup
  profile of that build both stayed green, and the failure would have shown at the first preview,
  in staging. Independent review had approved the change before the coordinator found the gap
  while writing the PR (the merge report on #2117 lists the rounds). The fix is a third row on the
  same release build that drives the first use, a preflight. It tells "load completed, then the
  database refused" (Prisma's `DRIVER.CONNECTION_FAILED`, from a port nothing listens on) apart
  from "load failed" (`preflight_unavailable`). In #2119 the catalog and users rows send the first
  database request to a loopback listener that accepts each connection and drops it, and count
  connections: a completed load connects once, and a failed load answers the same 500 and never
  connects (`workers/catalog/test/sealed-bundle.node.test.ts`). When work moves to first use, list
  where each of its failures shows now, and drive the first use on the build that ships.
- **`wrangler check startup` alone does not prove a start.** In #2117's review a mutant whose
  global scope threw read as an empty, fast start in the profile, while the boot of the same build
  failed. A profile's count stands only beside a boot of the same build, in the same file
  (`workers/migrator/test/sealed-bundle.workerd.test.ts` and its sibling `sealed-startup.ts`).
  Wrangler does report some throwing scopes as a failed profile, so this is "can", not "always".
- **Another change can remove a test's premise.** #2118 relied on a migrator test turning red when
  the alias is dropped. #2117, landing beside it, changed which row catches that: under the mutant
  the boot row now stays green and the new preflight row goes red. The coordinator re-ran the
  mutant on #2118's branch after merging the new `main`, before #2118 opened. When two in-flight
  changes touch the same guarantee, re-run the guarantee's mutant after the first one merges.

## A scanner that read one lockfile document of two (2026-11-18)

pnpm 12 (#1751, 2026-09-18) writes the root `pnpm-lock.yaml` as two YAML documents: pnpm's own
environment lock (15 packages), then the workspace lock (1,917). The `CI / security (osv)` lane ran
osv-scanner v2.3.8, whose pnpm parser read only the first document, so from 2026-09-18 to
2026-11-18 the lane scanned 15 of the root lockfile's 1,932 packages, and the workspace's own
dependencies took no part in its verdict. What caught it was the per-file count in the CI log,
"Scanned …/pnpm-lock.yaml file and found 15 packages", which #1963 set beside a local osv-scanner
2.6.0 run that read 1,941 (2026-09-29, filed as #1964); the gap then stayed open for seven weeks.
v2.7.1 parses both documents (google/osv-scalibr#2351): it read 1,932 packages and found 91 known
vulnerabilities in 33 of them.

- Read a scanner's per-file package count, not only its verdict. A count far below what the file
  holds means the file was not scanned, and its "No issues found" is the zero-result shape in
  "Fake boundaries" above.
- Recheck the counts when an input changes format, not only when the scanner does: the second
  document arrived with the pnpm 12 upgrade, and no line of the osv job moved.

## Logs and a reproduction before a plan (owner, 2026-08-06 to 2026-08-24)

A diagnosis starts from the raw record, not from a theory: "有问题的时候，你到底有没有认真看过所有的
log、jsonl 以及具体的实例？…我感觉你就是想了一下，然后就去 update" (2026-08-06, after a plan was
revised without reading the run's logs). A production fault is reproduced locally first (start the
backend, send the same request) and the fix is proven there before it ships: "你就不能本地启动起来发api测试吗"
(2026-08-24, after a fix shipped untested and the fault stayed). Check every instance of the kind,
not the one that was reported ("我们所有的doorbell都检查一下", 2026-08-23). When reading the live
record needs a permission or a login, ask for it instead of guessing ("需要权限或者登录认证跟我说就行了",
2026-08-16).

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
- A sweep for deleted symbols misses prose that describes the deleted structure in plain words. On
  2026-11-23 (#2101) the sweep for every deleted name was empty and the review passed. A PR review
  bot then found a pin file's header still saying "The routing table and the rate table are two
  different tables", with no deleted name in it. Sweep the old structure's vocabulary too, for
  example `rate table|two tables|classif|dispatch`. The fix cost a new head, a re-review and a
  second bot window.
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

## Brief writers on public text, not only reviewers (2026-11-19)

Code, docs and commit messages are as public here as issues and pull requests
(`docs/agents/infra-and-secrets.md`). In #2076's first review round two new test headers named a
private tracker's ticket and a private working document, which no reader of the repository can
resolve; the review caught them as a must-fix, and the writer rewrote both commits. Every writer
brief says: no private tracker ids, private document names or machine paths in code, docs or
commit messages; references in a commit body follow `docs/agents/commit-and-pr-hygiene.md`.
Before review, grep the diff and the commit bodies for the tracker's id prefix.

## Run the project's gate, not one you invented

Independent verification means running the same command the project enforces (the package
script, the `.pre-commit-config.yaml` entry, the commands in `docs/ops/local-gates.md`) with its
targets, flags, cwd and file scope. A broad self-invented invocation once reported 343 errors
against work the real gate accepted, because the real gate scoped the check on purpose.

A subset chosen by hand fails the other way, with a false green. On #2097 (2026-11-22) the four
documentation gates passed while `CI / repository contracts`, which pins documentation text
verbatim, went red. A review seat later reported "all 42" contract suites green where the job runs
84. Take the command list from the workflow file, and put the expected count in a brief (84
`bundle exec ruby` lines plus `check-e2e-promotion.sh` on 2026-11-23), so that a short run shows.

A commit added after approval re-runs every gate, `CI / repository contracts` included, however
small the commit. On #2117 (2026-11-24) a test-only commit added after review named the retired
migration ledger in a comment. The re-runs after it covered lint, typecheck, test and the
documentation gates, and CI's contracts job failed on
`test/repo-config/retired-migration-authority-refs.test.rb`, which reads comments too.

## Before closing, deleting or merging anything

Task state is not vibe state. Three proposals to close or delete tasks from memory impressions
were all wrong on evidence review (2026-07-17). Grep or read the artefacts the task would have
produced and present the evidence with the recommendation; if completion is unverifiable, say so
and fold the verification into the natural review point.

## Renames, research and slow loops

- Deleting or renaming a file: grep the old name and the new name, whole tree. A "complete" list
  built from the new name alone missed the four tests that referenced the old filename and broke
  CI (2026-08-26). A list handed to a sub-agent as complete must be complete, or say it is not.
  Grep the old path in every shape, prefixed (`src/api/`) and bare (`api/x.ts`, `(api/`,
  `` `api/ ``): in #2077 (2026-11-19) a prefixed-only sweep missed two comments naming a file in
  the retired `api/` directory, and the independent review caught them.
- A rename leaves a path-keyed guard green and checking nothing. Dependency rules, semgrep scopes
  and exemptions, scanner file lists, a test's batch of files, coverage globs and pre-push routes
  all name paths. List each guard's file set at base and head and map the two one to one through
  the move table; then plant one violation per changed guard and watch it fail ("plant what it
  must catch", above). #2077 (2026-11-19) mapped six guards and planted four violations, each red
  while planted and green after the revert.
- Tests that locate by filename are layout coupling; locate by table or version. Assert SQL by
  meaning, after normalising quotes and whitespace, not by literal rendering.
- Platform-capability research enumerates the vendor's whole catalogue first (the products page,
  the docs index) and compares second. "Platform X has no Y" is asserted only after a live docs
  check; the owner opened the dashboard and found twelve services outside a nine-assumption audit
  (2026-08-03).
- Research lists existing products, hosted services and open-source projects before anything is
  built, and its search terms name no vendor: a search that carried one vendor's name steered the
  conclusion ("你这个搜索里面就自带了oracle，你能不能不带任何厂家？", 2026-09-18). Reuse and thin glue
  come before writing from scratch ("能复用的复用，能写胶水代码就写胶水代码", 2026-08-08). The record
  goes into the repository's live iteration directory, not only into a chat ("你为啥不把调研结果放到repo里",
  2026-10-03; `docs/DOCS_POLICY.md`).
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

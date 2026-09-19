# What two days of Orca delivery taught, 2026-09-18 → 19

Sixteen PRs merged, nine cards filed, 51 stale cards closed. The delivery is in the issues and the
commits; this is the part that does not survive there.

Everything below was paid for. Where a lesson names an incident, that incident happened.

---

## 1. The defect that has no failure signal

Nine separate defects found across two days were one shape: **a check whose real scope differs from
the scope its name claims.** They are listed here together because no two of them looked alike
until they were.

| the check | what its name claims | what it actually did |
|---|---|---|
| coverage gate | reports are meaningful | accepted an empty report as 0/0 |
| e2e `test` script | the suite runs | four specs no runnable script ever named |
| grant postcheck | the GRANT took effect | `has_table_privilege` says yes for any `neon_superuser` member |
| failure-alert mutation suite | 15 probes run | its helper returned `nil`; all 15 died before asserting |
| `anitabi-egress-*` contracts | destination is locked | a new destination parameter turns none of them red |
| disclosure scan | no secret in the tree | `Dir.glob`'s `*` skips dotfiles, so `.env`/`.dev.vars` were never read |
| single-fetch-site rule | one outbound client | matched literal member calls only; an aliased `node:http` walks past |
| ceiling config validation | a finite rate limit | `Number("999…")` → `Infinity`, still "valid" |
| docs hygiene | no broken `docs/` links | flagged test fixtures, which are not links |

Note the last one goes the **other** way — too wide, not too narrow. The common property is not
"too permissive"; it is that **the asserted scope and the named scope were never compared.**

**The question that found every one of them:** *what would have to happen for this check to go red?*

Ask it of any guard being cited as proof. A guard nobody has tried to break is a claim, not
evidence.

### Why they are worse than bugs

None produced a failure. Green tests, passing gates, committed reports — all present, none
verifying what they claimed. A bug announces itself once. A vacuous check announces safety forever.

The corollary: **the absence of red is not evidence.** Mutation output is.

---

## 2. Tools lie about different things, and always plausibly

Seven times in two days a tool answered a question truthfully and I acted on it wrongly, because the
question it answered was not the question I meant.

| I asked | it answered | the truth came from |
|---|---|---|
| `ls -la` on colima's `diffdisk` | 100 GiB, before and after cleanup | `df` — it is a sparse file; that was the cap, not the occupancy |
| `du -sh node_modules` | 2.5 GB | `df` — APFS `clonefile` shares blocks; real cost 46 MB |
| upstream repo HEAD | changed 2026-08-09 | the `api.md` **path** — unchanged since 2025-01-10 |
| `git diff origin/main..HEAD` | 19 files deleted | `origin/main...HEAD` — the branch was behind, not deleting |
| the merge guard's message | "bots have not reviewed" | its source — a 10-minute window, then it permits |
| "has a bot commented?" | yes | the comment body — *"Currently processing… please wait"* |
| test totals before/after | unchanged | per-file counts — a total hides "lost 2, gained 10" |

**The pattern:** every one of these is a *granularity* error. The tool was pointed at the right
object and asked the wrong question about it. `ls` measures a different thing from `df`; a repository
is a different object from a file; two dots mean something different from three.

**The habit that fixes it:** before believing a measurement, say out loud what it would report in the
case you are trying to rule out. If the answer is "the same thing", the measurement cannot
distinguish and you have learned nothing.

Two more, mechanical:

- **`cmd1 && cmd2 && cmd3` stops silently** when an earlier command exits non-zero — and `grep` with
  no match does exactly that. Several "not found" conclusions were commands that never ran. Re-run
  negative results standalone.
- **`jq` dies on control characters** in bot comment bodies. A monitor built on
  `gh … --json | jq` never fired. Use `gh`'s own `-q`, which handles it.

---

## 3. Exit codes carry semantics; the symptom does not

Three of four Command Code lanes ended at `exit 8`. The visible state was identical to failure: a
dead process, no commit, no `worker_done`. One had 66 modified files and its last words were *"All
green."*

`exit 8` is Command Code's **turn cap**, not an error. The default of 100 turns is spent on TDD,
gates and mutation runs — all of which happen **before** the commit. So the cap systematically
severed lanes at the exact point where they would have proven their work.

Raised to 400. Also pinned `--no-auto-update`, after a lane was observed going 1.32.1 → 1.56.1
mid-run: a worker whose tool changes version partway through produces a failure nobody can
reproduce, because the binary that ran is no longer installed.

**Generalisation:** read the exit code's documented meaning before diagnosing from the symptom. "The
model failed" and "the harness stopped it" look the same from outside and have opposite fixes.

---

## 4. Rules that are individually right and collectively broken

Three defects lived in the seam between two correct things, where nobody owned the join.

- **#1804** — the repo mandates `Refs: #…` in commit subjects and forbids PR numbers there. GitHub's
  squash merge appends ` (#N)` to every subject unconditionally. So **every squash commit on `main`
  violates the repo's own commitlint rule**, and it only surfaces when a branch merges `main` in and
  the pre-push gate lints the range.
- **#1816** — `Refs:` links but never closes. Nothing required a closing keyword in the PR body,
  which is the only place GitHub reads one. Result: **51 of 157 open cards had already shipped.**
  Compounding it, `Closes #a, #b, #c` closes only the *first* — GitHub's docs say *"use full syntax
  for each issue"*.
- **`squash_merge_commit_message: BLANK`** — every carefully written commit body was discarded at
  merge. Measured: **40 of the last 40 commits on `main` had no body at all.** The repo has a whole
  section demanding commits explain *why*; none of it had ever reached `main`.

**What these have in common:** no single decision was wrong. The failure was in the join, and the
join had no owner and no test. A convention chosen for commit hygiene silently disabled issue
closure, which silently made the board a bad dispatch input, which sent lanes to rebuild shipped
work.

**When adding a rule, ask what downstream mechanism reads its output.**

---

## 5. Where to put a guard

A known, documented, mechanically-detectable mistake belongs **at the point it is made**, not
downstream.

For the `Closes` mistake there were three candidates:

| placement | when it catches you | cost |
|---|---|---|
| CI contract | 5–8 minutes later, PR already created | a workflow, a test, a re-push |
| a skill | before the mistake — but only if invoked | zero when it works, zero when it doesn't |
| **the push script** | **at the moment of the mistake** | four lines of `grep` |

The push script won because **every PR in this repo goes through it**, and a skill only helps when
remembered. CI only helps after the fact. The owner's instinct — "is the CI contract necessary?" —
was right; it was guarding against contributors who do not exist.

**Ask who actually performs the action, and put the guard on their path.**

A related boundary held deliberately: arming auto-merge stays a **foreground** action so it passes
the PR-comment hook, while the mechanical branch update is automated because it does not go through
that hook. Automating the first would have routed around a review discipline using a process I
started myself.

---

## 6. Writing a brief a lane can succeed against

The briefs that produced the best work shared five properties. The ones that produced churn lacked
them.

**Name the known traps in advance.** Two lanes were told *"this environment may export
`NODE_ENV=production`, which collapses `apps/web`'s React suite — if a gate fails that way it is the
environment, not your change."* Both hit it and both said so, instead of spending twenty minutes
fixing something that was not broken. Cost: two sentences.

**Name the occupied files, and make "I needed one" an acceptable outcome.** After #1803 and #1806
collided on the same workflow registry, every brief carried the occupied list plus *"saying 'I need
`X`' is a complete and acceptable outcome."* A lane then found a one-flag fix blocked by an occupied
contract, reported it, and did not reach for a workaround with an unverifiable blast radius.

**Ask for falsification, not confirmation.** The egress review brief did not say "check the
comparison is constant-time"; it said "check there is no earlier short-circuit that leaks before the
constant-time path is reached." Confirmation checklists find what you already suspect.

**Do not paraphrase findings to a writer — point at the source.** Briefs said *"read each thread's
full body from GitHub; the summaries below are thin on purpose, because a coordinator's paraphrase
is how a writer implements a misunderstanding."* A compressed, confident summary is the most
efficient way to propagate an error.

**Demand per-item counts, not totals.** "Case counts before and after" gets a total that hides "lost
two, gained ten". One rebase report stated *"no file lost a test and no file changed count
downward"*, with each addition attributed to its source card. That is the assertion worth asking for.

### The best outcome a lane produced was no code at all

A lane dispatched against #1632 committed nothing and reported four blockers with evidence: three
missing dependencies (proved with a probe it then deleted), an unmerged dependency card, no
integration lane for three of five acceptance criteria, and a mutation with no test to turn red.

Had it forced through — adding dependencies, substituting a double for the real database, reporting
three unrunnable mutations as passes — the result would have been a PR that looked complete while
four downstream cards kept waiting on work nobody knew was finished.

**"I did not do this, here are four reasons" is a deliverable.** Say so in the brief, or lanes will
optimise for having produced something.

---

## 7. Two reviewers are not redundancy

PR #1806 took four review rounds. The first was a Grok seat that read the diff adversarially, re-ran
ten mutations, and returned **APPROVED with zero blocking findings**. Merging there would have been
defensible.

CodeRabbit then found that `Number(raw)` converts a long digit string to `Infinity` while the
configuration still validates — making the rate ceiling, the entire promise the service exists to
keep, unenforceable.

The two reviewers were not checking the same thing. One asked *"what can an attacker do?"*; the
other asked *"what does this line do at its boundary values?"* Neither covers the other. Where they
**converged independently** — both landed on the contract tests being narrower than their names —
that was the strongest signal of the whole review.

Corollary: a reviewer that has not reproduced a claimed mutation has not verified it. Briefs now
require re-running at least three.

---

## 8. Coordinator mistakes worth not repeating

Recorded because each cost real time and each is easy to repeat.

- **Dispatching stale cards.** Three of four dispatches hit cards whose premise was already false —
  one had shipped two weeks earlier. The cause: reading the board instead of the code, and reading
  card bodies truncated, which cut the `Blocked by` line sitting at the end. **Before dispatching:
  read the body in full, and `git grep` for the product on `origin/main`.**
- **A diagnostic command with side effects.** To see why a close failed, I ran a real
  `gh issue close --comment "test"` against a production issue. It left a "test" comment in the
  repository's history. **Probe with an input you expect to fail, not with the real target.**
- **Mixing `gh pr update-branch` with local pushes** on one branch. Produces a non-fast-forward
  rejection, and pulling GitHub's merge commit back drags `main`'s squash subjects into the push
  range where the pre-push gate rejects them. **Pick one mechanism per branch.**
- **Fanned-out sub-agents sharing an output directory.** Three forks read the dispatch plan they had
  inherited as their own mandate, redid the whole task, and overwrote siblings' files in place,
  erasing eleven verified results. **Give each fork a private output path, and state sibling
  assignments explicitly — "not your job" has to be said, not inferred.**
- **Believing a watcher without checking what it waits for.** One monitor counted any bot as having
  reviewed, including a placeholder saying *"currently processing"*; another used a `jq` pipeline
  that crashed on the first payload and could never have fired.

---

## 9. What the owner decided, and why it is recorded here

- **Fixed egress over the alternatives.** Rotating addresses and exposing the upstream API directly
  to browsers were both rejected. The chosen design spends most of its engineering on *constraining
  ourselves* — two named operations, no destination parameter, a rate ceiling enforced regardless of
  what the caller asks. The upstream offered the allowlist; the work is keeping the promise made in
  exchange.
- **An external store for the rate ceiling** (#1810), over a Fly volume or accepting the gap. The
  argument that lost: today's traffic is ~2 requests per 8 hours, so the exposure is negligible. The
  argument that won: the failure the ceiling exists to contain — a caller-side bug re-queueing
  hourly, which #1784 already found happening for six hours — is precisely what would invalidate
  that premise. **A defence that holds only while nothing else goes wrong is not a defence.**
- **Squash-only, enforced at the repo.** It was already the practice; it was not a rule until
  `allow_merge_commit` and `allow_rebase_merge` were turned off.

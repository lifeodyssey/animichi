# Local Review Gate — Standards ∥ Spec

**The one authoritative source** for the local semantic review gate (issue #1008,
part of #1004). Every file describing invariants, review method, reviewer
permissions/output, workflow order, or ticket scope points here and must not
copy this checklist. Tooling is `scripts/local-gates/` (§8).

## 1. Invariants

1. **Fail closed.** A gate that cannot decide must block, never pass:
   unresolvable base/head, missing brief, schema-violating verdict, unreadable
   GitHub response, bot self-dismissal. The reviewed base is the **real
   merge-base** of `origin/main` and `HEAD` — never a guessed `HEAD^` — and an
   unresolvable reference is a hard block (explicit `--base` always wins).
2. **A bot's self-dismissal is never maintainer triage.** Only a comment by an
   authorized **human** actor — `OWNER`/`MEMBER`/`COLLABORATOR` association
   **and** a GitHub author type of `User` — can acknowledge managed findings or
   record a review-approval marker. A `Bot` (or any author type that cannot be
   read, which normalizes to absent) fails closed and can never clear the gate.
3. **Standards and Spec are independent axes.** Each verdict records both; an
   aggregate pass must not hide a rejected axis. Either axis `reject` blocks.
4. **Pin the reviewed base, head, and brief digest.** A verdict is only valid
   for the exact base SHA, head SHA, and brief digest it records. Changing any
   of them invalidates the approval and requires a complete new review.
5. **Two-path comment gate.** Line-level review threads and top-level managed
   findings (qodo Bugs / Rule violations, SonarCloud Quality Gate) are
   different objects; checking one and not the other is a block.
6. **No suppressions, no fake green.** No `any`, no `eslint-disable` /
   `@ts-ignore` / `type: ignore` / `noqa` / `skip`, no `continue-on-error` on
   real gates, no generic "all green" summary. Evidence is per-run and quoted.
7. **Mutation probes are the only valid green-light proof.** Key assertions must
   be proven by breaking the code (red), restoring it (green), with the restore
   rerun (the "red → restore → green" triple). Mutation evidence is recorded in
   the verdict artifact.
8. **Approval must be proven, not merely typed.** An approval-claimed verdict is
   rejected unless every recorded gate run has `exit == 0` and every mutation
   run proves the full `red == true`, `restore == true`, `green == true` triple.
   A reject artifact may describe failed evidence; an approve may not.
9. **Findings snapshots identify the actual later finding.** Each managed-finding
   token carries the stable comment identity (`id` or `url`) and a digest of its
   body, so a later comment with the same numeric count, or an edited finding
   body, changes the snapshot. Ordering is deterministic.
10. **Fresh-head.** The head being merged must be the head that was reviewed and
    acknowledged.
11. **Machine-visible human approval on the GitHub path.** When the local verdict
    is unavailable (workflow runs, non-CLI merges), the gate requires a strict,
    authorized, head/base/brief-bound human review-approval marker in the PR
    comments. A rejected axis, stale head/base, or malformed/unauthorized
    marker blocks UI / auto-merge / API merges — defense-in-depth, not a
    replacement for the local review.
12. **The marker's brief must match the canonical record.** The GitHub path has
    no brief file, so a syntax-only digest is not enough: the review handoff
    records the reviewed brief's digest in the PR body (`review-gate brief:
    <64hex>`) and `check` requires the marker's `brief=` to equal it. Exactly
    **one** canonical record is allowed; a missing/malformed/duplicated record
    fails closed — the marker never binds to an unknown or ambiguous brief.
13. **Head-bound GitHub gate.** `issue_comment` runs start on the default branch,
    so the job's check run is associated with the wrong SHA. The workflow
    resolves the PR `head_sha` **once** at the start of the PR-only path and
    pins it: **pending before the expensive quality steps** (a comment/review
    change can never leave a previous success merge-eligible), collect/check
    rejects when the live head advances past the pin, and the final
    success/failure is posted as the **last step** with `if: always()` derived
    from the whole-job outcome (`job.status`) — any earlier failure posts
    failure (finding 1). Concurrency cancels the in-progress run for every PR-bearing event —
    `pull_request` (incl. `edited`), `pull_request_review`,
    `pull_request_review_comment`, `issue_comment` (finding 2); merge_group and
    push never cancel. Plain issue comments, push, and merge_group have no PR
    and never fake a result.
14. **The recorded base is the real merge-base.** `collect` queries the GitHub
    compare API and records `merge_base_commit.sha` — never the base branch tip
    — and the approval marker/verdict bind to that merge-base. An unresolvable
    compare is a hard block.
Codecov patch coverage is **not a comment finding**: the independent required
CI Quality lane (`pipeline-quality.yml`) enforces the patch-coverage policy,
and the comment parser / merge hook never inspect Codecov output.

## 2. Review method

- **Card-level final review**: one reviewer seat reads the diff vs card brief +
  ACs, never the executor's claims; fixed point is the merge-base vs
  `origin/main` (three-dot diff).
- **Standards axis**: `AGENTS.md`, per-package `AGENTS.md`, 1-10-50, no `Any`,
  no suppressions, Fowler smell baseline, per-file conventions.
- **Spec axis**: ticket body + ACs + card brief + the campaign wave scope.
- **Spec-level review** (specs, not cards): dual seats — Fable + Codex GPT Sol
  (`gpt-5.6-sol`, xhigh) adversarial review — findings feed a planner revision
  loop before owner sign-off.
- **Findings format**: file, line, severity (`P0`/`P1`/`P2`), fix. REJECT on:
  out-of-scope changes, missing tests, or any suppression.
- **Quality Ratchet**: every AC carries a test-type and has a test in the diff
  (`ac_total == ac_with_test`); the verdict records `ac_total` — the brief's
  declared total — and validates `len(ac_to_test) == ac_total` with unique,
  non-empty ids (the schema never hard-codes AC1..AC6). Patch coverage ≥95%
  unless doc-only.

## 3. Reviewer permissions and output

- The reviewer **never writes or edits code, and never commits, pushes, or
  merges**. Verdicts are the only deliverable.
- The deliverable is **one head-bound verdict artifact** — enforced by
  `scripts/local-gates/review-schema.json` and validated by `review-verdict.sh
  validate`. It records base/head SHA, brief digest, reviewer identity/time, the
  two axes with findings, `ac_total` + AC-to-test mapping (§2), gate evidence,
  mutation evidence, and — when the AC6 flow ran — `repair_evidence` recording
  local-harness vs real-OpenCode (§4).
- The merge-gate record (threads triaged + findings acknowledged) is a second,
  separate output living in the PR comments, not in the artifact.

## 4. Workflow order (per card)

The local review is the gate **before** PR creation; the GitHub comment/status
gate runs only **after** the PR exists (issue #1008 finding 8). The reviewed
diff must be a pinned commit, so the flow uses the **clean candidate-commit
protocol** (finding 4): the review binds to a local candidate commit, never to
an unpinned working tree or a pre-existing `HEAD`.

1. Worktree from `origin/main` + brief (ticket ACs in full).
2. Implement (executor; TDD first). `scripts/local-gates/changed-packages.sh`
   routes the changed-package gates.
3. Gates: typecheck / lint / unit for the touched packages.
4. **Create a local candidate commit (do not push)** — pins the reviewed diff;
   a new candidate commit replaces the previous one on repair.
5. Local review: Standards∥Spec `/code-review` reads `origin/main...HEAD`, re-runs
   every gate, mutation-probes the key assertions, and bind the verdict to that commit
   (base = real merge-base, head = candidate commit SHA, brief digest pinned,
   both axes).
6. REJECT findings → repair and create a new candidate commit → return to 3–5.
   Changing the reviewed head or brief makes the old verdict stale; a
   **complete new review** is required (never a patch on top of the old
   approval).
7. Only after both axes approve: push + open the PR — the reviewed candidate
   commit is the PR head; the local review was the gate that cleared it.
 8. The GitHub-side gates run now that the PR exists: the two-way comment gate
    (threads + findings, human-acked, snapshot-bound) + the review decision (the
    local verdict artifact on the CLI path, or the head/base/brief-bound human
    review-approval marker on the GitHub path) + the fresh-head gate → merge.
 9. Record the verdict artifact with the PR.

### AC6 repair flow and its evidence boundary

The AC6 cycle — reject → **OpenCode repair** → real gates/mutation → fresh
approve → PR-eligible — is satisfied only when the repair is actually performed
by an OpenCode session. `repair_evidence` in the verdict records what really
happened (finding 5):

- `local-deterministic-harness`: the hermetic harness rebuilt the repaired
  fixture and re-ran the gates itself — locally proven, reproducible, no
  network/provider access; never presented as an OpenCode repair.
- `opencode`: an orchestrator drove a real session and records the actual
  `command`, `session`, and `log_digest` (SHA-256 of the session log) via the
  repair-evidence recorder. The schema fails closed on a fabricated opencode
  record and never hard-codes a future exit; the suite stays hermetic.

## 5. Ticket-specific scope

- Scope is **ticket-owned**: it lives in the ticket body, its ACs, and the card
  brief. Guidance files do not restate it or carry per-ticket checklists.
- The reviewer's spec axis reads the ticket the card closes and its campaign
  wave; the executor works from the same brief. Nothing here substitutes for
  the ticket.
- A ticket's brief file is the input to `review-verdict.sh digest`; the digest
  is pinned into the verdict and verified by the gate.

## 6. The required PR check

`scripts/local-gates/pr-review-check.sh` is the deterministic PR gate for the
local review workflow. The CLI merge hook consults its verdict before merging;
the post-#1180 `Review Gate` check runs the same collect + check and blocks UI /
auto-merge / API merges when it fails (§7). The retired `Quality / invariants`
compatibility context is no longer emitted.

Only *active* unresolved threads count (`isOutdated=true` threads don't block
the current head, #1019); malformed thread data — a non-boolean
`isResolved`/`isOutdated` or an absent structure — fails closed (§1).

- `collect <dir> [--pr N] [--repo OWNER/NAME] [--pinned-head SHA]` snapshots the
  GitHub state into `<dir>/{head_sha.json,base_sha.json,brief_digest.json,threads.json,comments.json}`:
  the pinned head (fails closed if the live PR head advanced past the pin), the
  real **merge-base** of the PR head and base branch (compare API, §1.14 — never
  the base branch tip), the canonical brief-digest record from the PR body
  (`review-gate brief: <64hex>`, written by the review handoff; exactly one
  required, §1.12), active unresolved review threads (paginated, `isOutdated`
  ignored), and top-level comments (the only network-facing step). The comment
  boundary reads top-level PR comments over **GitHub GraphQL**
  (`gh api graphql --paginate`), requesting `id` / `url` / `body` /
  `authorAssociation` and `author { __typename login }`, combines pages
  deterministically, and normalizes into the internal snake_case shape.
  Recording `author.__typename` is load-bearing: the legacy `gh pr view --json
  comments` shape omits the author type, so it is never production data. An
  absent/empty/malformed head or base SHA, an unreadable/malformed GraphQL page,
  a finding-shaped comment without a readable author type or identity, or a
  comment field with a non-string type (numeric/null `author_type`, `id`, ...)
  fails closed (§1).
- `check <dir> [--verdict FILE] [--brief FILE] [--base SHA]` is pure: it reads
  active unresolved threads, managed findings, the current head SHA, and an
  authorized human acknowledgement, then emits one JSON verdict and exits `0`
  for success, `1` for a non-success gate (`pending` or `failure`), and `2` for
  unreadable input (fail closed).
- The JSON verdict carries `state=success|pending|failure`: a missing human
  approval marker or missing findings acknowledgement is `pending`, while an
  unresolved thread, stale/unauthorized/malformed evidence, rejected axis, or
  binding mismatch is `failure`. The workflow step records this state and
  keeps a pending check step green; the final head status is pending only when
  the whole job succeeds, and any later job failure overrides it with failure.
- **Findings snapshot**: `sha256(head_sha + sorted findings)`. Findings are
  bot-authored top-level comments; each token records the comment identity
  (`id`/`url`) and a body digest, so a later comment or an edited finding body
  changes the snapshot even at the same count (§1.9). An ack is valid only when
  written by an authorized human with `snapshot=<current>`; a new commit or
  later finding makes the older ack **stale** and the gate stays blocked.
- **Review-approval marker**: when `check` runs without `--verdict` (the GitHub
  workflow path), it requires a machine-readable line in an authorized human
  comment:
  `review-gate approval: standards=approve spec=approve base=<40> head=<40> brief=<64>`.
  Both axes must approve, `head`/`base` must equal the collected SHAs, and
  `brief` must equal the canonical PR-body digest record (§1.12) — a
  wrong-but-well-formed digest or missing/malformed record blocks. (The local
  `--verdict` path verifies the digest against the real brief file.) Malformed,
  unauthorized, rejected-axis, and stale markers block; one comment may carry
  both the findings-triage ack and the approval marker.
- The local head-bound verdict artifact (`--verdict`) folds into the same
  CLI/`check` gate: stale head/base/brief or a rejected axis blocks regardless
  of comment state, and the approval-evidence proof (§1.8) is enforced on it.

## 7. Enforcement

Two separate enforcement boundaries:

- **Local head-bound Standards∥Spec verdict** — the coordinator-owned artifact
  (`--verdict`), produced pre-PR, never committed before merge, consumed only by
  the CLI merge hook via `check --verdict`. No workflow, UI, auto-merge, or API
  path reads it.
- **Required GitHub workflow context** (`Review Gate` after the #1180 cutover)
  — runs collect + check on the current
  PR without `--verdict`; failure blocks merges. The sole GitHub-side surface.

Concretely:

- **CLI**: the merge hook delegates to the canonical gate (`pr-review-check.sh`
  collect + check) before `gh pr merge`; an unhandled thread, unacknowledged
  finding, malformed/stale marker, or stale verdict blocks. The local verdict
  pair is passed only via explicit `REVIEW_VERDICT_FILE` / `REVIEW_BRIEF_FILE`
  env vars — never defaulted to the repo root (finding 7) — and must come
  together; an artifact without its brief is a block. Without the canonical
  gate the hook falls back to an inline two-path check so the global guard
  keeps protecting every repo.
- **UI / auto-merge / API**: post-cutover rulesets require `Review Gate`
  (`pipeline-quality.yml`). The Review Gate job resolves
  the PR `head_sha` once at the start of the PR-only path and posts the pending
  status **before** the expensive quality steps, then runs `pr-review-check.sh
  collect` + `check` — **without** `--verdict` — against that pinned head with
  `pull-requests: read` + `statuses: write`, judging the current PR's active
  unresolved review threads, top-level managed findings, acknowledgement, and
  the canonical-brief-bound review-approval marker. The job re-runs on every PR
  synchronization (`pull_request`), PR body/brief edit (`pull_request`
  `edited`), review submission/edit/dismissal (`pull_request_review`), inline
  review-thread create/edit/delete (`pull_request_review_comment`), and PR
  issue-comment create/edit/delete (`issue_comment`), so a new review or comment
  can never leave a previously green required context stale. Because
  `issue_comment` runs start on the default branch, the job posts a commit
  status on the exact PR `head_sha` — pending before the quality steps, then
  success/failure as the LAST step, derived from the whole-job outcome
  (`job.status`) with `if: always()` semantics (§1.13). A failure in ANY earlier
  step — a quality check, collect/check, or the actionlint gate — posts failure
  on the pinned head (finding 1); a failed status post fails the required job,
  and GitHub blocks UI, auto-merge, and API merges. The context blocks merges
  when its own check fails; it does **not** read the local head-bound verdict
  artifact.
- **issue-comment resolution**: `issue_comment` also fires for plain issues, so
  the step resolves the PR number only when the comment is on a PR
  (`issue.pull_request.url` non-empty); non-PR comments skip without posting any
  status, and the step binds the pending/final status to the exact PR `head_sha`.
- **merge_group boundary**: a merge-group event has no PR number, so the gate
  step skips; the context stays green on merge_group.
- **Fail-closed rule**: if the check cannot read its inputs it exits 2 and
  blocks. No path is exempt.

## 8. Files

| Path | Purpose |
|---|---|
| `scripts/local-gates/review_verdict.py` | Machine-checkable single source: verdict model, digests, local gate, approval-evidence proof |
| `scripts/local-gates/review_verdict_cli.py` | `digest` / `snapshot` / `validate` / `gate` CLI over the model |
| `scripts/local-gates/verdict_types.py` | Raw JSON verdict TypedDicts shared by the schema and parse modules |
| `scripts/local-gates/verdict_schema.py` | Schema validation over the verdict TypedDicts |
| `scripts/local-gates/verdict_evidence.py` | Evidence completeness: `ac_total` ratchet (unique ids, count == total) + `repair_evidence` boundary |
| `scripts/local-gates/verdict_parse.py` | JSON → typed Verdict bridge (runs after validation) |
| `scripts/local-gates/pr_review_check.py` | Required PR gate: threads + findings + ack snapshot + human review-approval marker, and `pr-check` CLI |
| `scripts/local-gates/pr_check_types.py` | Typed gate model (`Comment`, `AckResult`, `MarkerResult`, `PrGate`) |
| `scripts/local-gates/pr_check_json.py` | Gate verdict JSON payload |
| `scripts/local-gates/pr_findings.py` | Managed-finding extraction; identity-aware tokens, stable-identity guard |
| `scripts/local-gates/pr_approval.py` | Authorized-human rule + canonical-brief-bound review-approval marker |
| `scripts/local-gates/comment_combine.py` | Combines per-page GraphQL comment arrays; fails closed on unreadable data |
| `scripts/local-gates/brief_record.py` | Extracts the canonical `review-gate brief:` record from the PR body |
| `scripts/local-gates/thread_tally.py` | Sums the per-page GraphQL thread tallies; fails closed on malformed thread data |
| `scripts/local-gates/review-schema.json` | Declarative verdict schema (AC1): `ac_total`, `repair_evidence` (ac_id uniqueness enforced by the executable validator) |
| `scripts/local-gates/review-verdict.sh` | `digest` / `validate` / `gate` shell wrapper (real merge-base of origin/main vs HEAD) |
| `scripts/local-gates/pr-review-check.sh` | `collect` / `check` / `status` required-PR-gate shell wrapper (pinned head + real merge-base; head-bound status) |
| `scripts/local-gates/pr-review-gate-step.sh` | One-shot workflow step: `resolve-head` (pin the PR head once), `collect-check` (reject an advanced live head, then collect + check), `final-status` (map outcome to success/failure); skips non-PR events |
| `.claude/hooks/check-pr-comments.sh` | Global PreToolUse merge hook; delegates to the canonical gate when present, inline two-path fallback otherwise (fallback requires a real GitHub `User` author for ACKs) |
| `scripts/local-gates/fixtures/` | Verdict + PR fixtures used by the tests and the AC6 flow |
| `scripts/local-gates/repair_evidence_record.py` | Orchestrator-facing AC6 recorder: emits `repair_evidence` for the local harness or a real OpenCode session (digests the actual session log; never invents a run) |
| `scripts/local-gates/review-verdict.test.sh` + `review-verdict.*.test.sh` | Public entrypoint + focused, directly runnable review-verdict test modules (AC1 schema/evidence, AC2 axis invalidation + merge-base resolution, AC6 repair-evidence recorder) |
| `scripts/local-gates/pr-review-check.test.sh` + `pr-review-check.*.test.sh` | Public entrypoint + focused, directly runnable pr-review-check test modules (core gate, collect boundary, shape merge-base/brief/types, status/jobstatus, routing, boundary/gate/identity mutation probes, AC6 repair flow + its evidence module) |

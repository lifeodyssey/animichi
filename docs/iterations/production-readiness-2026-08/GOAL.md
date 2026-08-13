# GOAL — Animichi Production Readiness

- Status: ACTIVE — spec reviewed; tickets published; owner approved breakdown; execution has started with the #992 and #1009 lanes
- Spec: GitHub #1004 and `docs/specs/2026-08-13-production-readiness-refactor-spec.md`
- Final gate: #1018
- Authority: this file replaces the former repo-closeout/refactor-skeleton execution board; ADRs remain authoritative for architectural decisions

## Objective

Complete every accepted production-readiness refactor: persistence, schema identity, API truth and retry safety, Catalog discovery/snapshots/staging import, frontend state/accessibility/performance, local/CI/review gates, immutable promotion, current documentation, repository publication cleanup, production infrastructure, and history closeout.

Completion means #1018 closes with evidence. “Code exists,” “tests passed once,” an old campaign checkbox, or an executor's green claim is not completion.

## Non-negotiable execution policy

1. OpenCode is the only implementation writer. Every code/config/test/migration/doc change performed during a ticket is dispatched through `/implement`. Coordinator-owned operational artifacts are exempt: ticket briefs, review/triage records, and this Goal's status metadata are written directly by the coordinator, not through `/implement`.
2. The coordinator writes briefs, manages worktrees, verifies diffs and gates, performs review, commits approved work, opens PRs, triages comments, and updates this Goal. The coordinator does not write implementation code; the exemption in rule 1 covers only coordinator-owned operational artifacts.
3. One `opencode serve` instance owns all sessions. Default model is `opencode-go/deepseek-v4-flash --variant max`; fallback is `opencode-go/gpt-5.6-luna --variant max` only after a failed health probe.
4. One ticket = one worktree = one OpenCode writer = one PR, except the already-approved #992 coordinated cutover.
5. Dispatch every native-blocker-zero ticket whose write set does not overlap an active writer. There is no artificial wave cap. Shared contracts, migration rewrites, layout moves, CI orchestration, and final cutovers serialize only when their real write/rollout dependency requires it.
6. OpenCode never runs Git write commands, commits, pushes, opens PRs, merges, deploys, or edits another ticket's worktree.
7. No local deployment. Staging and production changes run only through CI/CD and their approved environment gates.
8. No skipped checks, suppressions, retry-until-green, `continue-on-error`, or replacement evidence presented as the requested gate.

## Ticket lifecycle

Each ticket follows this state machine:

```text
BLOCKED → READY → BRIEFED → IMPLEMENTING → VERIFYING → REVIEWING
        → REJECTED → IMPLEMENTING
        → APPROVED → COMMITTED → PR_OPEN → WAIT_CHECKS → TRIAGE
        → MERGED → DONE
```

### READY → IMPLEMENTING

- Confirm every native `blocked by` issue is closed.
- Create an isolated worktree from fresh `origin/main`.
- Write a self-contained brief containing the issue body, exact current-code anchors, allowed scope, test commands, and “no Git commands.”
- Invoke `/implement` in the ticket's OpenCode session.
- If OpenCode changes out-of-scope files, restore only those files and redispatch with a narrower brief.

### VERIFYING

- Read the actual diff; executor narration is not evidence.
- Run the repository-mandated `make check` before and after every change, including after any post-review fix; it supplements, never replaces, the focused gates below.
- Run the ticket's AC-tagged tests plus affected package lint/typecheck/build/coverage/integration gates.
- Run repository policy gates selected by the changed-package router.
- Every acceptance criterion declares a test type (`unit`|`integration`|`eval`|`browser`|`api`) and has a corresponding test present in the same PR diff; record the exact command and exit status.
- Mutation is the green-light proof: for every criterion's corresponding test, break the behavior → expected red; restore → green.
- Record exact commands, exit status, blockers, and environmental limits.

### REVIEWING

- The coordinator executes local `/code-review` before commit or PR creation.
- Fixed point: the ticket worktree's merge-base with fresh `origin/main`.
- Standards axis reads current root/package guidance and smell baseline.
- Spec axis reads the ticket, #1004, and relevant ADR/contract.
- Verdict pins base/head-equivalent working-tree digest, brief/spec digest, AC-to-test evidence, mutation evidence, reviewer identity/time, and separate Standards/Spec status.
- Either axis rejecting returns the ticket to OpenCode `/implement`; every changed diff receives a complete fresh review.
- Ambiguous product, security, privacy, compatibility, destructive-operation, or architecture decisions enter HITL. The reviewer never invents owner policy.

### APPROVED → PR_OPEN

- Only an `APPROVE` verdict permits the coordinator to organize atomic commits, push, and open the PR.
- PR body closes exactly one implementation ticket, links #1004, lists evidence, and declares deviations or known external blockers.
- The committed head must match the reviewed diff. Any post-review edit invalidates the verdict.

### PR_OPEN → MERGED

- Required checks run against the fresh head.
- Read both GitHub surfaces: unresolved line-level review threads and top-level issue comments/findings.
- Fix true findings through OpenCode `/implement`, rerun verification and review, then push a new head.
- Record the findings judgment as an authorized maintainer top-level PR comment, bound to the PR number, the current head SHA, and the latest managed-findings snapshot; that comment must exist before merge. An older acknowledgment cannot release a newer head/finding.
- Merge only when both comment surfaces are clear, required checks pass, the local verdict matches head, and repository ruleset permits merge.

## Maximum-parallel dependency frontier

GitHub native sub-issues and `blocked by` edges are authoritative. This table is a readable snapshot, not a second scheduler.

### Frontier A — dispatch immediately when execution resumes

| Ticket | Deliverable | Write-set note |
|---|---|---|
| #992 | ORM/PG18/UUIDv7 coordinated cutover (#993–#1002) | Existing active implementation lane |
| #1003 | Deterministic CI mirrored before push | Local-gate scripts/docs |
| #1008 | Local Standards∥Spec reviewer + required PR gate | Reviewer/workflow/GitHub gate |
| #1005 | OpenAPI/runtime truth + compatibility | Contract/routers/Edge |
| #1009 | Frontend state ownership | Web architecture |
| #855 | Production scoped DSN preparation | HITL application later |
| #541 | Production domain/DNS preparation | HITL activation later |
| #915 | History-rewrite preparation only | Freeze/force operation remains last HITL |

Issue #1006 is native-blocked by #992 and begins as soon as #992 closes. #1007 waits for #679, which waits for #1003.

### API and frontend fan-out

| After | Dispatch in parallel |
|---|---|
| #1005 + #992 | #1011 SavedRoute idempotency; #1014 Chat exactly-once |
| #1005 | #680 Edge rate-limit policy |
| #1009 | #1015 WCAG 2.2 AA; #1010 Core Web Vitals |

### Catalog fan-out

```text
#992 → #1006 daily discovery/ingest → #1012 immutable snapshots
                                      → #1016 staging import/canary (also needs #1001)
                                      → #678 alerts (needs #1016)
```

### Delivery, architecture, and docs

```text
#1003 → #679 component CI → #1007 artifact foundation → #1013 immutable promotion

#992 + #1005 + #1009 → #666 remaining Clean Architecture → #655 1-10-50 closeout

#1008 + #679 + #1013 + #666 + #655 → #1017 docs/package/release convergence
```

### Final convergence

Issue #1018 is blocked by the terminal evidence tickets: #855, #541, #915, #1002, #1011, #1014, #680, #1015, #1010, #678, and #1017.

## HITL stops

The fleet stops and requests owner authorization before:

- #1001 deleting/recreating staging and provisioning the closed Auth roster;
- #855 changing production runtime DSNs or secrets;
- #541 activating apex DNS/routes or disabling the last fallback hostname;
- #1017 deleting the external GitHub Package or legacy tags;
- #915 freezing main, force-pushing rewritten history, deleting tags, or retiring the recovery reference;
- any production promotion or destructive data operation not already covered by an explicit owner window.

Preparation, read-only inspection, tests, previews, backups, and dry runs continue up to the stop.

## Completion contract

- [ ] #992 and #993–#1002 are complete; the current paused Goal has been resumed and closed honestly.
- [ ] Every #1004 sub-issue is closed or explicitly superseded with a linked reason and replacement evidence.
- [ ] Every implementation PR has an AC-complete test record — each acceptance criterion declares a test type, a corresponding test in the same PR diff, exact command/status, and red/green mutation evidence, with mutation as the green-light proof — plus a head-matching Standards∥Spec approval.
- [ ] Every PR has zero unresolved review threads and no untriaged top-level managed finding.
- [ ] PostgreSQL 18/Atlas/ORM parity, UUIDv7, soft-delete/audit classification, scoped roles, and user isolation are proven.
- [ ] API/runtime parity, compatibility, idempotency, Chat exactly-once, and rate-limit policy are proven.
- [ ] Production Catalog daily discovery, immutable N/N-1 snapshots, staging import/canary, and staleness alerts are proven.
- [ ] Frontend state ownership, WCAG 2.2 AA, and performance release gates are proven.
- [ ] Pre-commit/pre-push/CI required gates, immutable artifact promotion, and staging QA are proven.
- [ ] Current docs and agent instructions have one source of truth; obsolete package/release surfaces and authorized legacy tags are cleaned safely.
- [ ] Production DSN/domain/SEO and authorized history rewrite are complete with recovery evidence.
- [ ] #1018 is closed and this checklist is fully checked with PR/deployment links.

Only then may the active Goal be marked complete.

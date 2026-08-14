# Issue #1008 — make local Standards and Spec verdicts a pre-PR required gate

Part of #1004.

## What to build

Make local semantic review a reproducible pre-PR gate. The reviewer must evaluate
Standards and Spec independently against a pinned diff and ticket brief, prove key
tests with mutation probes, and emit one head-bound verdict artifact. GitHub merge
protection must independently enforce fresh-head and two-path comment triage so UI,
API, automation, and agents cannot bypass the decision.

## Acceptance criteria

- [ ] AC1 (unit): The verdict schema records base/head SHA, brief/spec digest, reviewer
      identity/time, separate Standards and Spec statuses/findings, AC-to-test mapping,
      gate evidence, and mutation evidence.
- [ ] AC2 (integration): Either review axis rejecting blocks progression; changing the
      reviewed head invalidates approval and requires a complete new review.
- [ ] AC3 (unit): Repository guidance has one source each for invariants, review method,
      reviewer permissions/output, workflow order, and ticket-specific scope, with no
      contradictory copied checklist.
- [ ] AC4 (api): The required PR check reads unresolved review threads, top-level managed
      findings, current head SHA, and an authorized acknowledgment bound to that findings
      snapshot.
- [ ] AC5 (api): A new commit or later managed finding makes an older acknowledgment stale,
      and merge remains blocked through CLI, UI, auto-merge, and API paths.
- [ ] AC6 (integration): A fixture change is reviewed end to end: reject, OpenCode repair,
      rerun gates/mutation, fresh approve, then PR-eligible state.

## Blocked by

None — can start immediately.

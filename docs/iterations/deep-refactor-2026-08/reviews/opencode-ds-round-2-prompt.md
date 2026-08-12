# OpenCode DeepSeek adversarial spec re-review — round 2

Review only. Do not edit files or run Git mutation commands.

Read completely:

- `docs/specs/2026-08-10-deep-code-refactor-spec.md` (Draft v7)
- `docs/adr/0006-neon-auth-identity-authority.md`
- `docs/adr/0007-agent-session-aggregate.md`
- `docs/adr/0008-published-turn-interface.md`
- `docs/adr/0009-defer-automatic-retention.md`
- `CONTEXT-MAP.md`
- `docs/iterations/deep-refactor-2026-08/README.md`
- `docs/iterations/deep-refactor-2026-08/WORKSPACE-BASELINE.md`
- `docs/iterations/deep-refactor-2026-08/reviews/round-1-findings.md`

This is a focused re-review after round-1 remediation. Verify every ledger disposition against the revised text and current source. Do not reopen closed product choices or expand the campaign beyond local development and staging.

Required checks:

1. demand-driven abandoned-turn recovery is bounded, indexed, ordered before policy/quota/budget reads, testable under process loss and concurrency, and introduces no scheduler, queue, Workflow, or production no-traffic promise;
2. SAFE-1 is only a fail-closed guard against the repository's current automatic/manual production entry points and does not design production runtime behavior;
3. Edge is the sole browser-token verifier, Users accepts only an unforgeable internal service-binding identity, and the real staging issuer/QA login hard-cut precondition is observable and declarative;
4. AUTH-1 precedes admission, policy values have one source, `api_keys` storage/grants are deleted, and no compatibility identity survives;
5. Turn and Session cards are reviewable vertical slices with live callers, deletion, mutation proof, and an acyclic complete `needs` graph;
6. fresh-schema retained surfaces and post-reset safety behavior are complete, while RETENTION-1 owns purge deletion and exempts only immutable historical records;
7. Contract generation is incremental with no unused mirrors, all 41 stories retain test annotations, and every task has an observable mutation/deletion proof;
8. round-1 corrections introduce no contradiction across spec, ADRs, context docs, current source, or workspace authority.

Return exactly:

- `VERDICT: APPROVE` or `VERDICT: NEEDS-CHANGES`;
- only high-confidence P0/P1/P2 findings, each with exact `file:line` evidence, failure mode, and precise replacement language;
- `OWNER QUESTIONS: none` unless repository facts and best practice genuinely cannot settle a hard-to-reverse choice;
- `RATCHET:` with story AC count, test-annotation count, task count, and any task lacking mutation/deletion proof.

Do not praise, summarize, propose implementation code, create files, or modify the worktree.

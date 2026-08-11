# OpenCode DeepSeek focused spec approval — round 3

Review only. Do not edit files or run Git mutation commands.

Read Draft v8 and the round-2 finding ledger completely:

- `docs/specs/2026-08-10-deep-code-refactor-spec.md`
- `docs/iterations/deep-refactor-2026-08/reviews/round-2-findings.md`

Read ADR-0006 through ADR-0009, `CONTEXT-MAP.md`, and current source only as needed to verify the following seven remediations:

1. SAFE-1 is the effective root for all 27 implementation cards, covers `ci.yml`, `deploy.yml`, and `rollback.yml`, and pins the current source-checkout deployment without inventing artifact digests;
2. the production Jobs manifest/deploy/maintenance-rollback allowlist and staging retention zero-reference gate can both be satisfied and cannot broaden silently;
3. recovery-before-policy/quota/budget is an integration AC, while sink event order is a separate unit AC;
4. AUTH-2 contains an unmocked browser callback/session/authenticated-Users journey plus separate API security mutations;
5. post-reset behavior covers every named retained safety-critical store, including SavedRoute, Point/Bangumi, and location/media;
6. Draft v5 task count is 23, Draft v8 is 27, acceptance/test annotations are 42/42, and all 27 task rows have mutation or deletion proof;
7. no remediation introduced a dependency cycle, compatibility path, production-runtime expansion, or contradiction with the local/staging boundary.

Return exactly:

- `VERDICT: APPROVE` or `VERDICT: NEEDS-CHANGES`;
- only blocking P0/P1/P2 regressions with exact `file:line`, failure mode, and replacement language;
- `OWNER QUESTIONS: none` unless unavoidable;
- `RATCHET:` with stories, AC annotations, task rows, mutation/deletion proof, and dependency-cycle result.

Do not summarize, praise, propose implementation code, create files, or modify the worktree.


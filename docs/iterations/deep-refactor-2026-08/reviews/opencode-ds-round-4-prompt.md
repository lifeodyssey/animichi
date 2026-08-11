# OpenCode DeepSeek final focused spec confirmation — round 4

Review only. Do not edit files or run Git mutation commands.

Read these four documents completely:

- `docs/specs/2026-08-10-deep-code-refactor-spec.md` (Draft v9)
- `docs/iterations/deep-refactor-2026-08/reviews/round-3-findings.md`
- `docs/adr/0009-defer-automatic-retention.md`
- `workers/jobs/CONTEXT.md`

Inspect current workflow/IaC source only when needed to verify the named production wiring. This is a final confirmation of the sole round-3 correction, not a new broad design review. Do not reopen owner decisions already accepted in rounds 1–3 unless Draft v9 introduced a blocking contradiction.

Verify all of the following:

1. campaign source and staging delete `workers/jobs`, its retention triggers, credentials, grants, deploy/rollback wiring, executable fallbacks, and operational references without a compatibility implementation or replacement retention system;
2. SAFE-1's immutable pre-campaign production manifest is the sole live exception and consistently preserves the production Jobs component, deploy mapping, maintenance rollback mapping, runtime credential, grants, and scheduled runtime until a separate production-migration ADR supersedes it;
3. campaign HEAD cannot recreate or mutate the pinned production Jobs runtime, and no automatic or manual production entry point can select or deploy a campaign revision;
4. RETENTION-1's zero-reference/source-structure gate has an exact allowlist for immutable history and the SAFE-1 production pin: it neither requires deleting the pinned production runtime nor permits live staging retention references to escape;
5. Spec Decision 20, SAFE-1, RETENTION-1, ADR-0009, and `workers/jobs/CONTEXT.md` are mutually consistent, while the accepted local/staging-only boundary and no-backward-compatibility rule remain unchanged;
6. the ratchet remains 41 stories, 42/42 acceptance criteria carrying test-type annotations, 27 task rows, 27/27 mutation/deletion proof, and a cycle-free dependency graph rooted effectively at SAFE-1.

Return exactly:

- `VERDICT: APPROVE` or `VERDICT: NEEDS-CHANGES`;
- only blocking P0/P1/P2 regressions with exact `file:line`, failure mode, and replacement language;
- `OWNER QUESTIONS: none` unless unavoidable;
- `RATCHET:` with stories, AC annotations, task rows, mutation/deletion proof, and dependency-cycle result.

Do not summarize, praise, propose implementation code, create files, or modify the worktree.

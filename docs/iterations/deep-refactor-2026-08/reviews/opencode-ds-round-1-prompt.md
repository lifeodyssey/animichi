# OpenCode DeepSeek adversarial spec review — round 1

Review only. Do not edit any file and do not run Git mutation commands.

Read these planning artifacts completely:

- `docs/specs/2026-08-10-deep-code-refactor-spec.md`
- `docs/adr/0006-neon-auth-identity-authority.md`
- `docs/adr/0007-agent-session-aggregate.md`
- `docs/adr/0008-published-turn-interface.md`
- `docs/adr/0009-defer-automatic-retention.md`
- `CONTEXT-MAP.md`
- `docs/iterations/deep-refactor-2026-08/WORKSPACE-BASELINE.md`

Verify claims against current source when needed. Owner decisions are closed:

- deep refactor with no code-level backward compatibility;
- staging is disposable and is the only environment changed by this campaign;
- production data and migration policy are a later owner-gated project;
- code refactoring precedes the separate CI/CD redesign;
- automated Session and anonymous-quota retention plus `workers/jobs` are deleted without replacement;
- only genuinely hard-to-reverse product or architecture choices may return to the owner; implementation details follow best practice.

Adversarially inspect:

1. contradictions between spec, ADRs, context docs, and current code;
2. dependency cycles, impossible hard cuts, or unsafe staging/production paths;
3. tickets that are horizontal scaffolding, too large to review, or leave unused layers on main;
4. missing observable acceptance criteria, missing test-type annotations, or mutation proofs that cannot prove the stated behavior;
5. hidden compatibility paths, dual writers, shadow contracts, identity bypasses, data-loss paths, and remote resources that survive source deletion;
6. owner choices still silently assumed.

Return exactly:

- `VERDICT: APPROVE` or `VERDICT: NEEDS-CHANGES`;
- findings ordered P0, P1, P2, each with exact `file:line` evidence, why it matters, and precise replacement spec language;
- `OWNER QUESTIONS:` with `none` unless a finding genuinely cannot be resolved from repository facts and best practice;
- `RATCHET:` with AC count, test-annotation count, and any task lacking observable mutation or deletion proof.

Do not praise or summarize the plan, propose implementation code, create files, or modify the worktree.

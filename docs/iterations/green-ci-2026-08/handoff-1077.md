# Handoff — #1077 Pulumi Cloud OIDC (2026-08-23)

Next session: land #1077. Do not start #1078, C2, or production work until this PR is green and the Cloud import is committed.

## Campaign pointers (do not copy)

- Execution contract: `docs/iterations/green-ci-2026-08/GOAL.md` (local dirty tree; **not on `origin/main`**)
- Plan: `docs/specs/2026-08-21-master-plan.md`
- Spec: `docs/specs/2026-08-16-ci-identity-federation-spec.md` + issue #1077
- Frozen: production apply, #1079/#1081, Track E, SAFE-1 re-pin. Staging only.

## What already landed on main

- Staging doorbell rings: #1163, #1168, repair #1171. Evidence: Actions run `32609027483` (web ring + post-deploy green).
- C1/#1047/#1116 closed. #1073–#1076 closed.
- #1072 bootstrap recorded on the issue (org `lifeodyssey`, ESC `animichi/staging` + `animichi/prod`, doorbell `doorbell-staging`). Stacks are **not** on Pulumi Cloud yet.

## Live work

- PR: https://github.com/lifeodyssey/animichi/pull/1173
- Branch: `grok/1077-pulumi-cloud` (worktree `.worktrees/1077-pulumi-cloud`)
- Head at handoff: `e18d0c026` (personal-token fix and this file land after that SHA)
- `review-gate brief: 9aabf0046cfa66a07d970588af1561af6c1d9a3b7966e75538846076be39a34b`

Three commits: Cloud OIDC for infra/neon-secrets + cutover; Quality gate + rollback docs; fail-closed except missing stack.

**Do not merge #1173 until** `seichijunrei-infra/staging` and `animichi-neon-secrets/{staging,prod}` exist on Pulumi Cloud **and** rewritten `Pulumi.*.yaml` (no passphrase `encryptionsalt`) is committed. Today those yaml files still decrypt with the R2 passphrase; Cloud jobs no longer receive `PULUMI_CONFIG_PASSPHRASE`.

GitHub 404s `workflow_dispatch` for `migrate-pulumi-to-cloud.yml` because that file is not on `main`. Path: land a migrate-only PR first, dispatch `confirm=migrate` on main, commit the artifact yaml back onto #1173 — **or** run `pulumi stack migrate` locally with Cloud login + R2 source URL + passphrase (never paste those values).

Production catalog `run_pulumi` stays on R2 (`reusable-deploy-component.yml`). Do not Cloud-`up` production.

## Known red on #1173 (fix in this session)

- `Quality / invariants` (run `32611624342`): `no canonical brief-digest record` — PR body had `review-gate brief: pending`. Put exactly one full-line `review-gate brief: <64hex>` in the **PR body** (`scripts/local-gates/brief_record.py`). Digest: `9aabf0046cfa66a07d970588af1561af6c1d9a3b7966e75538846076be39a34b`.
- `Infra / build` (job `97125497162`): `Org tokens are not supported for non enterprise organizations`. Switch `pulumi/auth-actions` to `requested-token-type: urn:pulumi:token-type:access_token:personal` and `scope: user:lifeodyssey`.

## After #1077

- #1078 ESC injects Pulumi-plane token + Neon API key; forbid `esc run wrangler`
- C2 #1055 1/3 waits a real DDL (no-op migrate does not count)
- #1117 AC1: local C+F already taken; do **not** GHA-dispatch `staging-cutover` (no `rehearsal=true` on the live workflow; GHA probes hit JS challenge)
- Draft #1105 stays parked. HTTP smokes stay parked (#1146 / #1162)

## Suggested skills

- `code-review` — after any further #1173 fix, Standards∥Spec vs `origin/main`
- `prevent-flip-flopping` — path is Cloud import then merge; do not reopen backend choice
- `pulumi-esc` / `pulumi-best-practices` — only when starting #1078
- `atlas` — only when a real staging DDL exists for C2

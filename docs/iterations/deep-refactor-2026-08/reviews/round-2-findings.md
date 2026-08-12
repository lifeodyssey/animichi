# Dual-seat adversarial review — round 2

Date: 2026-08-10
Input: Draft v7 after round-1 remediation
Scope: focused closure review; read-only

| Seat | Verdict | Findings |
|---|---|---|
| Codex Sol (`gpt-5.6-sol`, `xhigh`, task `/root/spec_review_sol`) | `NEEDS-CHANGES` | 1 P1, 3 P2 |
| OpenCode (`opencode-go/deepseek-v4-flash`, `max`, title `deep-refactor-spec-rereview-ds-v4`) | `NEEDS-CHANGES` | 1 P1, 2 P2 |

Neither seat modified the worktree. Neither returned an owner question.

## Dispositions in Draft v8

| Finding | Disposition |
|---|---|
| SAFE-1 claimed to block the campaign but CONTRACT-1, TURN-1, and CATALOG-1 through CATALOG-4 were independent roots. | Add direct SAFE-1 edges to every root and state that no implementation card may merge before SAFE-1 is green on main. |
| Story 7 mixed process-loss recovery with sink ordering under a unit-test tag. | Split it into one integration AC for startup/pre-admission recovery and one unit AC for event order; ratchet becomes 42/42. |
| AUTH-2 lacked an unmocked browser login/callback proof. | Require the successor local-login command to drive an unmocked Neon callback, establish cookie/JWT state, and complete one authenticated Users call through Edge; keep security mutations under API proof. |
| The round-1 task count was arithmetically wrong. | Correct Draft v5 from 25 to 23 rows; Draft v8 has 27, a net increase of four. |
| RETENTION-1's zero-reference gate contradicted SAFE-1's pinned production Jobs capability, and `rollback.yml` was an ungoverned third production entry point. | Limit deletion to staging surfaces; precisely allowlist the immutable production manifest plus Jobs deploy/maintenance rollback mappings. SAFE-1 now governs `ci.yml`, `deploy.yml`, and `rollback.yml`. |
| SAFE-1 required artifact digests although current deployment rebuilds from source and build-once is deferred. | Pin source revision, Atlas target, and component map only; explicitly leave artifact digests to the successor CI/CD design. |
| Post-reset behavior omitted SavedRoute, Catalog, and location/media retained stores. | Add SavedRoute create/read, Point/Bangumi read, and location/media behavior to story 37 and SESSION-3 acceptance. |

## Ratchet after remediation

- Stories: 41.
- Acceptance criteria and test annotations: 42/42.
- Task rows: 27.
- Task rows with explicit acceptance mutation or deletion proof: 27/27.
- Owner questions: none.
- Next gate: focused round-3 approval; no new design exploration.

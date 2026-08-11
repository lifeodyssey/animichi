# Dual-seat final focused approval — round 4

Date: 2026-08-10  
Input: Draft v9 after the sole round-3 documentation-consistency correction  
Scope: final read-only confirmation of the production Jobs exception across Spec, ADR-0009, Jobs context, and current workflow/IaC wiring

| Seat | Verdict | Blocking findings | Owner questions |
|---|---|---|---|
| Codex Sol (`gpt-5.6-sol`, `xhigh`) | `APPROVE` | None | None |
| OpenCode (`opencode-go/deepseek-v4-flash`, `max`) | `APPROVE` | None | None |

## Confirmed boundary

- Campaign source and staging delete the Jobs retention implementation, staging triggers, credentials, grants, executable fallbacks, and operational wiring without a compatibility implementation or replacement retention system.
- SAFE-1's immutable pre-campaign production manifest is the sole live exception. It retains the production Jobs component, deploy mapping, maintenance rollback mapping, runtime credential, grants, and scheduled runtime until a separate production-migration ADR supersedes it.
- Campaign HEAD cannot recreate or mutate that pinned runtime, and `ci.yml`, `deploy.yml`, and `rollback.yml` cannot select or promote a campaign revision to production.
- RETENTION-1's live-source zero-reference rule allows only immutable archived iteration history and the precise SAFE-1 production pin; it does not permit a staging retention path to survive.

## Ratchet

- 41 stories.
- 42 of 42 acceptance criteria carry a test-type annotation.
- 27 task rows.
- 27 of 27 task rows include mutation or deletion proof.
- The dependency graph is cycle-free and effectively rooted at SAFE-1.

The `/to-spec` reviewer-remediation loop closed with both seats approving. The owner signed off v9 on 2026-08-10, authorizing publication and `/to-tickets`.

# Dual-seat adversarial review — round 1

Date: 2026-08-10  
Planning base: `origin/main` at `b94c30ab`  
Worktree: `/Users/lumimamini/Documents/Seichijunrei-agent/.worktrees/deep-refactor-spec`

## Seats

| Seat | Runtime | Scope | Verdict | Mutation |
|---|---|---|---|---|
| Codex Sol | collaboration task `/root/spec_review_sol`; `gpt-5.6-sol`, `xhigh` | Spec, ADR-0006 through ADR-0009, context map, workspace baseline, and current-source verification | `NEEDS-CHANGES` | Read-only; zero files changed |
| OpenCode | session `ses_015bda4d6ffeslULBfx3IJCg10`; `opencode-go/deepseek-v4-flash`, variant `max` | Same artifacts plus four independent source probes for auth, Agent/Session/turn, retention, and remaining contexts | `NEEDS-CHANGES` | Read-only; zero files changed |

The owner explicitly selected these two seats instead of the repository workflow's default Fable seat. The unused Fable prompt was deleted; it was never dispatched.

## Finding ledger

| ID | Severity | Finding and evidence | Disposition |
|---|---|---|---|
| OC-1 | P0 | AUTH-2 could delete the Supabase fallback while staging Edge still pins a redacted Neon issuer whose JWKS fails. Evidence: `workers/edge/wrangler.toml`, `workers/edge/test/auth-config.test.ts`, and `docs/ops/auth-migration-neon.md` section 8. | Amend AUTH-2 to require IaC-derived real staging issuer/JWKS, declarative QA identity, and a successful real-token smoke before deleting fallback. |
| OC-2 | P1 | The six-noun fresh-schema sentence omits retained quota, usage, audit, feedback, memory, ingest, and location/media storage; current quota adapters fail open on database errors. | Replace the noun list with an exact retained-surface manifest and require post-reset behavior tests for every safety-critical retained store. |
| OC-3 | P1 | AUTH-2 deletes Supabase local login and GoTrue fixtures without proving a Neon successor; present E2E login-wall tests mock the callback. | Require a Neon local-login command and a real staging login/JWT acceptance journey before deleting the old path. |
| OC-4 | P2 | RETENTION-1's zero-reference wording conflicts with immutable historical iteration records, and SESSION-1 repeats ownership of purge-SQL deletion. | Scope absence to live operational surfaces, allow immutable archive/history records, update the old history checker, and give purge-SQL deletion solely to RETENTION-1. |
| OC-5 | P2 | WEB-1 can merge before the turn hard cut even though both edit the chat feature. | Add the final turn-cut card to WEB-1's authoritative `needs`. |
| OC-6 | P2 | TurnAdmission could hardcode quota/BYOK values before AUTH-1 establishes the Contract policy source. | Move AUTH-1 before admission and require every consumer to read the single policy/config source. |
| OC-7 | P2 | Photo-confirmation offers are ambiguous with Session-issued selection offers. | State that ConfirmPhotoOffer owns a separate, sessionless offer namespace unless a future slice explicitly binds it to Session. |
| OC-8 | P2 | AUTH-1 does not explicitly drop the Neon `api_keys` table and grants. | Make table/grant removal part of AUTH-1 and the fresh-chain absence gate. |
| SOL-1 | P1 | Only destructive/auth revisions are production-ineligible, while current automatic and manual deploy entry points can deploy the checked-out main source. | Pin every production component and schema to one immutable pre-campaign release manifest; every campaign revision is production-ineligible at both entry points. |
| SOL-2 | P1 | ADR-0006 assigns human-token verification to Edge, but AUTH-2 retains Users verification. | Route Users through Edge verification, strip caller credentials/identity headers, forward an internal authenticated identity over the binding, and remove Users JWKS verification. |
| SOL-3 | P1 | Cancellation always maps to `cancelled`, contradicting conservative `aborted_uncertain` accounting after provider dispatch. | Define phase-aware cancellation and test before dispatch, during uncertain dispatch, after confirmed response, and during required persistence. |
| SOL-4 | P1 | Lease reconciliation promises eventual terminalization but names no production wake-up or liveness bound. | Scope correction: this is a local-development/staging campaign, so it uses a bounded indexed sweep on startup and before admission. It makes no no-traffic wall-clock promise and adds no background deployable; production liveness is deferred. |
| SOL-5 | P2 | TURN-2 precedes AUTH-1 and therefore must temporarily understand the identity class AUTH-1 deletes. | Put AUTH-1 before TurnAdmission and update the dependency graph. |
| SOL-6 | P2 | TURN-2 and SESSION-1 are multi-context epics, not one-reviewable-PR vertical tickets. | Split admission, outcome recovery, final turn cut, Agent history, Session adoption, and final schema cut into independently reviewable cards. |
| SOL-7 | P2 | CONTRACT-1's generation scope could create unused generated mirrors before later capability slices consume them. | Generate only health/service metadata in CONTRACT-1; later cards extend generation, migrate the live boundary, and delete the handwritten DTO together. |

## Ratchet result

- Round-1 Draft v5 story acceptance criteria: `41`; test-type annotations: `41/41`.
- Draft v8 splits the recovery/event-order AC, so it has `42` acceptance criteria and `42/42` test-type annotations.
- Round-1 Draft v5 task rows: `23`; every row named at least one mutation or deletion proof.
- Draft v8 task rows after splitting the two epics: `27`; net increase `4`. Admission, outcome recovery, final turn cut, Agent history, adoption, and final schema cut are separate vertical cards.
- CONTRACT-1 lacked an explicit unsupported-schema mutation; the revised card must add it.
- TURN finalization cannot rely on an eval baseline until the translation, injection, output-validation, and provenance baseline is discovered and named in the ticket.
- `SOL-4` is closed by narrowing the promise to the campaign's actual local/staging boundary rather than adding speculative production infrastructure.

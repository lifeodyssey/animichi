# ADR-0009: Remove automated retention until production data lifecycle is defined

## Status

Accepted by the owner on 2026-08-10. Implementation is RETENTION-1 in the deep-code-refactor spec.

## Context

The current repository contains two implementations of two scheduled purge policies: Python scripts in the Agent and a TypeScript `workers/jobs` deployable that copied their cutoff and SQL. The package requires a database credential, a dedicated role and grants, two Cloudflare Cron triggers, deploy and rollback wiring, tests, runbooks, and deprecated manual GitHub Actions fallbacks.

The anonymous Session purge was introduced because free-text queries and locations could accumulate without a TTL. It deletes only routeless Sessions after 30 inactive days while retaining route-bearing anonymous Sessions permanently. That rule is internal implementation history, not a current user-facing product promise. The public 365-day limit applies to separately selected evaluation data, not the primary Session store. No production user data, measured storage pressure, or approved production lifecycle currently justifies preserving this subsystem.

Staging is disposable, and its application schema will be reset during this campaign. Replacing Jobs with another Worker, Workflow, database function, soft-delete state, or transport would turn an unsettled production policy into unnecessary architecture.

## Decision

1. Delete `workers/jobs` from campaign source and staging without an alias, wrapper, replacement Worker, Workflow, Service Binding, database function, or Python-container command.
2. Delete both Python purge scripts and settings, all purge repository methods and SQL, both staging Cron triggers, both staging manual fallbacks, tests, package routing, staging deployment mappings, retention-only staging role, credential, grants, secrets documentation, and current staging resources.
3. Do not add a Session TTL, route-bearing retention exception, `deleted_at`, `pending_purge`, anonymous-quota TTL, or recurring retention telemetry in this campaign.
4. Staging data is removed only by the declarative staging schema reset. Ordinary runtime preserves Session and quota rows.
5. Before production user data is enabled, a separate owner-approved data-lifecycle design must decide primary Session retention, explicit user deletion, account deletion, recovery windows, evaluation-copy retention, audit minimization, and Neon backup/PITR expiry together with the user-facing policy.
6. All live staging retirement is performed through infrastructure as code. The cutover proves the old Worker, Cron triggers, and executable fallbacks are absent before the schema reset; source deletion alone is insufficient.
7. SAFE-1's immutable pre-campaign production manifest—including the production Jobs deploy mapping, maintenance rollback mapping, runtime credential, grants, and scheduled runtime—is the sole live exception until a separate production-migration ADR supersedes it. Campaign HEAD never recreates or mutates that pinned runtime.

## Consequences

- The deep-refactor campaign removes a duplicate, credentialed background subsystem instead of replacing it with another speculative seam.
- Anonymous Session history remains available while its browser identity remains valid; orphaning and eventual production retention remain explicit future product decisions.
- `anon_daily_message_count` rows remain in staging until the application schema is reset. This is accepted because staging is disposable and no scale problem has been demonstrated.
- Production promotion remains blocked by SAFE-1. Production continues only from the immutable pre-campaign manifest, so removal of campaign/staging retention cannot silently mutate its pinned Jobs runtime.
- A future production retention implementation requires a new ADR and cannot be introduced as an implementation detail of this campaign.

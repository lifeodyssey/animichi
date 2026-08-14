# TASK-BRIEF #1006 — Production daily Catalog discovery and ingest

Parent: #1004. Blocked by: #992.

## What to build

Turn Catalog ingestion into one durable production daily run that discovers current, popular, and historical Bangumi works, enriches them with Anitabi point/original-image data, obeys explicit budgets and refresh tiers, and never publishes a partial run as complete.

## Acceptance criteria

- **AC1 (integration):** A stable run ID makes retries idempotent and records target set, per-source outcome, budget use, failures, completion state, and published version.
- **AC2 (integration):** Discovery combines current-season, popularity, and historical inputs with deterministic deduplication and bounded daily growth.
- **AC3 (unit):** Refresh tiers and configurable work/request/runtime budgets select due work and stop cleanly without source-code magic numbers.
- **AC4 (integration):** Anitabi points and original images retain provenance, upstream identity, attribution/license metadata, and field-level source mapping.
- **AC5 (integration):** Only the latest and previous raw payload needed for diagnosis are retained; bounded cleanup cannot delete the active run's evidence.
- **AC6 (integration):** Partial fetch/enrich/quality failure records a failed or partial run and cannot advance the published Catalog pointer.

## Review history

- Round 1 (aefb063a): Spec MAJOR-1 (AC2 current_season empty) + MAJOR-2 (AC1 staleRunningMs unused); Standards APPROVE.
- Round 2 (03324e36 fix): Spec r2 APPROVE (both MAJORs closed); Standards stands APPROVE.
- Pin advance commit 9d696c65 (SAFE-1 atlas head + atlas.sum pin): separately reviewed and verified (script exit 0).

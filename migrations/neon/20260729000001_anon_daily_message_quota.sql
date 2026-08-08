-- Per-identity anonymous daily message quota (issue #282, S1.10).
--
-- `daily_usage` (20260726000001) meters a *global* dollar ceiling across the
-- whole anonymous surface; this table meters a *per-identity* message count
-- so one visitor's own daily allowance is tracked separately from that shared
-- breaker. One row per (UTC day, anon identity). The container ingress
-- atomically increments this counter before invoking the runtime and rejects
-- once the visitor's own quota is spent, without touching `daily_usage`.
-- No secondary index: the PK (usage_date, anon_id) already leads with
-- usage_date, so a standalone index on usage_date alone would only add
-- write-path cost on this hot UPSERT path without answering any query the PK
-- doesn't already serve (review follow-up: an earlier draft added one).
-- message_count has no DEFAULT: the only writer is the repo's UPSERT, which
-- always supplies an explicit value — a default here would be dead code that
-- could mask a future writer forgetting to set it (review follow-up).
CREATE TABLE IF NOT EXISTS anon_daily_message_count (
    usage_date     DATE NOT NULL,
    anon_id        TEXT NOT NULL,
    message_count  BIGINT NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (usage_date, anon_id)
);

GRANT SELECT, INSERT, UPDATE ON anon_daily_message_count TO agent_svc;

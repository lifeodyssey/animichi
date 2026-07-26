-- Auth-stripped Atlas twin of supabase/migrations/20260726000001_daily_usage.sql.
--
-- One row per (UTC day, scope). `scope` partitions spend the way the product
-- reasons about it: 'anon' is the open, unauthenticated surface protected by
-- the daily-budget circuit breaker (X4); 'user' is logged-in traffic, which the
-- breaker never rejects; 'byok' is bring-your-own-key traffic, which costs the
-- product nothing and is metered for observability only.
--
-- The container ingress reads SUM(cost_usd) for ('anon', today) to decide
-- whether the anonymous budget is exhausted, so the write path must be an
-- idempotent accumulate rather than an insert-per-request.
CREATE TABLE IF NOT EXISTS daily_usage (
    usage_date    DATE NOT NULL,
    scope         TEXT NOT NULL CHECK (scope IN ('anon', 'user', 'byok')),
    requests      BIGINT NOT NULL DEFAULT 0,
    input_tokens  BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    cost_usd      NUMERIC(14, 6) NOT NULL DEFAULT 0,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (usage_date, scope)
);

CREATE INDEX IF NOT EXISTS idx_daily_usage_scope_date ON daily_usage (scope, usage_date DESC);

GRANT SELECT, INSERT, UPDATE ON daily_usage TO agent_svc;

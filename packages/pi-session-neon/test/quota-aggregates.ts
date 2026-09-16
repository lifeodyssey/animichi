// The Python agent domain's quota aggregates. `migrations/neon/20260826000004_agent.sql` and
// `20260904000000_platform_usage_scope.sql` created them; the #1626 contract deliberately does not
// declare them (spec §4.12) and the Python agent that owned them retired with #1607. The
// executable business examples under `test/` (`business-transactions.ts`) still target them, and
// the edge's database fixtures install the same shapes, so this fixture is the single owner of
// both. No grants: the examples run on the superuser test pool, and every privilege assertion
// covers contract-owned tables in `acl.db.test.ts`. Delete this file with the two tables.
export const QUOTA_AGGREGATES = `
  CREATE TABLE public.anon_daily_message_count (
    usage_date date NOT NULL,
    anon_id text NOT NULL,
    message_count bigint NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (usage_date, anon_id)
  );
  CREATE TABLE public.daily_usage (
    usage_date date NOT NULL,
    scope text NOT NULL,
    requests bigint NOT NULL DEFAULT 0,
    input_tokens bigint NOT NULL DEFAULT 0,
    output_tokens bigint NOT NULL DEFAULT 0,
    cost_usd numeric(14,6) NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (usage_date, scope),
    CONSTRAINT daily_usage_scope_check CHECK (scope = ANY(ARRAY['anon'::text, 'user'::text, 'byok'::text, 'platform'::text]))
  );
  CREATE INDEX idx_daily_usage_scope_date ON public.daily_usage (scope, usage_date DESC)`;

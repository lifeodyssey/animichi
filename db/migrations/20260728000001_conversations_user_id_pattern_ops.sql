-- Auth-stripped Atlas twin of
-- supabase/migrations/20260728000001_conversations_user_id_pattern_ops.sql.
--
-- Collation-safe index for the anonymous-session retention sweep (issue #273
-- Task 3). The purge predicate matches `user_id LIKE 'anon\_%' ESCAPE '\'`
-- rather than a `>=`/`<` range scan — the latter is a collation trap under
-- non-C locales. `text_pattern_ops` is what lets that LIKE prefix match use
-- an index instead of a full table scan.
--
-- Lock behavior (CONCURRENTLY evaluated, not used): CREATE INDEX takes a
-- SHARE lock on `conversations` for the build's duration, blocking writers
-- but not readers. CREATE INDEX CONCURRENTLY avoids that at the cost of two
-- table scans and no transactional guarantee — and both this Atlas apply and
-- the Supabase migration runner execute each file inside one transaction, a
-- context CONCURRENTLY cannot run in at all (Postgres rejects it outright).
-- `conversations` is small pre-launch, so the plain build's brief lock is the
-- right trade; revisit if the table grows enough for the lock window itself
-- to matter.
CREATE INDEX IF NOT EXISTS idx_conversations_user_id_pattern
    ON conversations (user_id text_pattern_ops);

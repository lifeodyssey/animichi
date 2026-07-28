-- Collation-safe index for the anonymous-session retention sweep (issue #273
-- Task 3). The purge predicate matches `user_id LIKE 'anon\_%' ESCAPE '\'`
-- rather than a `>=`/`<` range scan — the latter is a collation trap under
-- non-C locales. `text_pattern_ops` is what lets that LIKE prefix match use
-- an index instead of a full table scan.
CREATE INDEX IF NOT EXISTS idx_conversations_user_id_pattern
    ON conversations (user_id text_pattern_ops);

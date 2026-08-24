-- Corrective migration: repair staging drift left by the 20260809 baseline
-- batch (atlas_schema_revisions 0002–0031 recorded applied=0/total=0, so a
-- pre-SESSION-3 `sessions` table kept its old shape and never gained the
-- SESSION-3 aggregate columns). Aligns the live table with
-- 20260809000029_table_sessions.sql. Idempotent on databases where the
-- baseline actually executed.

ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS title text;

ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS first_query text;

CREATE INDEX IF NOT EXISTS idx_sessions_user_updated ON public.sessions USING btree (user_id, updated_at DESC);

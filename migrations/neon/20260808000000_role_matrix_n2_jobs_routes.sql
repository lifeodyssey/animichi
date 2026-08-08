-- N2 role matrix (#832): SELECT on routes for the two purge flows that read it.
--   jobs_svc — workers/jobs/src/purge.ts:22 FIND_PURGEABLE_SESSIONS_SQL joins
--              routes (NOT EXISTS subquery) to exempt route-bearing sessions
--              from anonymous-session purging.
--   agent_svc — apps/agent/src/animichi/infrastructure/supabase/repositories/
--               session.py:36 _FIND_PURGEABLE_SQL (run by
--               scripts/purge_anonymous_sessions.py) is the same query with
--               the same routes exemption.
-- routes stays users-owned (N1 grants users_svc CRUD + readonly SELECT): both
-- roles get SELECT-only, matching the "reads may be broader" ownership rule in
-- db/AGENTS.md. Guarded style mirrors N1 (to_regclass + EXECUTE) so this is a
-- no-op on any database where routes is absent.
-- Apps still may use owner DSN until #832 wires staging env secrets
-- (CATALOG_DATABASE_URL / USERS_DATABASE_URL / AGENT_DATABASE_URL).

DO $$
BEGIN
  IF to_regclass('public.routes') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT ON TABLE routes TO jobs_svc';
    EXECUTE 'GRANT SELECT ON TABLE routes TO agent_svc';
  END IF;
END $$;

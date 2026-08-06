-- N1 role matrix (#831): ensure app/runtime roles exist; align GRANTs by ownership (db/AGENTS.md).
-- Apps still may use owner DSN until #832 wires secrets. migrator is conceptual — apply continues via deploy DSN.
-- RLS not enabled (app-layer authority).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog_svc') THEN
    CREATE ROLE catalog_svc NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_svc') THEN
    CREATE ROLE agent_svc NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'users_svc') THEN
    CREATE ROLE users_svc NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jobs_svc') THEN
    CREATE ROLE jobs_svc NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly') THEN
    CREATE ROLE readonly NOLOGIN;
  END IF;
END $$;

-- Catalog-owned tables: catalog_svc CRUD; agent/users/jobs no write
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  bangumi, points, aliases, series_edges, ingest_jobs, cluster_version,
  route_snapshots, raw_anitabi, raw_bangumi, media_assets, leg_cache
TO catalog_svc;

-- locations may exist from geocoding migration
DO $$
BEGIN
  IF to_regclass('public.locations') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE locations, location_aliases TO catalog_svc';
  END IF;
END $$;

-- SERIAL sequences: USAGE+SELECT for services that INSERT (nextval fires on insert)
DO $$
DECLARE seq text;
BEGIN
  FOREACH seq IN ARRAY ARRAY[
    pg_get_serial_sequence('public.cluster_version', 'id'),
    pg_get_serial_sequence('public.route_snapshots', 'id'),
    pg_get_serial_sequence('public.aliases', 'id')
  ] LOOP
    IF seq IS NOT NULL THEN
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO catalog_svc', seq);
    END IF;
  END LOOP;
  seq := pg_get_serial_sequence('public.conversation_messages', 'id');
  IF seq IS NOT NULL THEN
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO agent_svc', seq);
  END IF;
END $$;

-- Users-owned: routes (+ route_anime when present)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE routes TO users_svc;
DO $$
BEGIN
  IF to_regclass('public.route_anime') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE route_anime TO users_svc';
  END IF;
END $$;

-- Agent-owned dialogue / quota
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  sessions, conversations, conversation_messages, request_log, feedback, api_keys
TO agent_svc;
DO $$
BEGIN
  IF to_regclass('public.agent_memory') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE agent_memory, agent_memory_operations, agent_memory_metadata TO agent_svc';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE agent_memory_versions TO agent_svc';
  END IF;
  IF to_regclass('public.daily_usage') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE daily_usage TO agent_svc';
  END IF;
  IF to_regclass('public.anon_daily_message_count') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE anon_daily_message_count TO agent_svc';
    EXECUTE 'GRANT SELECT, DELETE ON TABLE anon_daily_message_count TO jobs_svc';
  END IF;
END $$;

-- Jobs: session purge SELECT/DELETE
GRANT SELECT, DELETE ON TABLE sessions, conversations, conversation_messages TO jobs_svc;

-- Readonly: SELECT on public business tables that exist
GRANT USAGE ON SCHEMA public TO readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readonly;

-- Explicit: catalog must not need users routes write (no grant routes to catalog_svc)
-- Explicit: users must not need points write (no grant points to users_svc)

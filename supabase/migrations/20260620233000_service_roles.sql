-- DB-per-service ownership: enforce single-writer discipline by role.
--
-- Two service roles split the schema into a Catalog domain and an Agent domain:
--   * catalog_svc  -- owns (ALL) the catalog/ingest tables; no operational access.
--   * agent_svc    -- read+write on operational tables; SELECT-only on the two
--                     catalog tables it reads directly (bangumi, points).
--
-- There is no `clusters` table in this schema; cluster state lives in
-- cluster_version (atomic version pointer) + route_snapshots, so it is omitted.
--
-- Guarded so it applies cleanly on Supabase and no-ops/creates cleanly on a plain
-- Postgres testcontainer (superuser, NOLOGIN roles harmless). CREATE ROLE is
-- wrapped in DO/EXCEPTION (Postgres has no CREATE ROLE IF NOT EXISTS), and each
-- GRANT is guarded by a to_regclass() table-existence check so a missing table
-- never hard-fails. Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- Roles (idempotent create).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog_svc') THEN
        CREATE ROLE catalog_svc NOLOGIN;
    END IF;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_svc') THEN
        CREATE ROLE agent_svc NOLOGIN;
    END IF;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- catalog_svc: ALL on every catalog/ingest table it owns.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    catalog_table TEXT;
    catalog_tables CONSTANT TEXT[] := ARRAY[
        'bangumi', 'points', 'cluster_version', 'route_snapshots', 'aliases',
        'series_edges', 'leg_cache', 'raw_anitabi', 'raw_bangumi',
        'media_assets', 'ingest_jobs'
    ];
BEGIN
    FOREACH catalog_table IN ARRAY catalog_tables LOOP
        IF to_regclass('public.' || catalog_table) IS NOT NULL THEN
            EXECUTE format('GRANT ALL ON public.%I TO catalog_svc', catalog_table);
        END IF;
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- agent_svc: read+write on operational tables.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    op_table TEXT;
    op_tables CONSTANT TEXT[] := ARRAY[
        'sessions', 'conversations', 'conversation_messages', 'user_memory',
        'routes', 'request_log', 'feedback'
    ];
BEGIN
    FOREACH op_table IN ARRAY op_tables LOOP
        IF to_regclass('public.' || op_table) IS NOT NULL THEN
            EXECUTE format(
                'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO agent_svc',
                op_table
            );
        END IF;
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- agent_svc: SELECT-only on the catalog tables it reads directly.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    ro_table TEXT;
    ro_tables CONSTANT TEXT[] := ARRAY['bangumi', 'points'];
BEGIN
    FOREACH ro_table IN ARRAY ro_tables LOOP
        IF to_regclass('public.' || ro_table) IS NOT NULL THEN
            EXECUTE format('GRANT SELECT ON public.%I TO agent_svc', ro_table);
        END IF;
    END LOOP;
END $$;

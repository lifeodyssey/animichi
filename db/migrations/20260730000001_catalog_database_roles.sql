-- Separate catalog runtime DML from Atlas migration ownership.
--
-- UNVERIFIED - confirm on the real Neon project before credential rotation:
-- Neon must allow the current Atlas principal to create roles, grant role
-- membership, and transfer ownership of objects in public. The migration is
-- intentionally source-derived and has not been executed against a database.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog_runtime') THEN
        CREATE ROLE catalog_runtime NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog_migrator') THEN
        CREATE ROLE catalog_migrator NOLOGIN;
    END IF;
END $$;

-- The applying principal needs membership in the new owner role to transfer
-- ownership during this migration and to let Atlas record this revision.
-- Retire this old principal only after the replacement migrator login works.
DO $$
BEGIN
    EXECUTE format(
        'GRANT catalog_migrator TO %I WITH ADMIN OPTION',
        current_user
    );
END $$;

-- Reset both the new runtime role and the legacy all-table capability before
-- granting the exact catalog runtime surface below.
REVOKE ALL ON SCHEMA public FROM catalog_runtime;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM catalog_runtime;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM catalog_runtime;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM catalog_runtime;

REVOKE ALL ON SCHEMA public FROM catalog_svc;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM catalog_svc;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM catalog_svc;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM catalog_svc;

GRANT USAGE ON SCHEMA public TO catalog_runtime;

GRANT SELECT, INSERT, UPDATE ON TABLE
    public.bangumi,
    public.points,
    public.aliases,
    public.raw_anitabi,
    public.raw_bangumi,
    public.ingest_jobs,
    public.media_assets
TO catalog_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    public.cluster_version
TO catalog_runtime;

GRANT SELECT, INSERT ON TABLE
    public.route_snapshots
TO catalog_runtime;

GRANT SELECT ON TABLE
    public.locations,
    public.location_aliases
TO catalog_runtime;

GRANT USAGE ON SEQUENCE
    public.aliases_id_seq,
    public.cluster_version_id_seq,
    public.route_snapshots_id_seq
TO catalog_runtime;

GRANT EXECUTE ON FUNCTION
    public.update_updated_at(),
    public.sync_points_coordinates(),
    public.similarity(text, text),
    public.similarity_op(text, text),
    public.st_distance(public.geography, public.geography, boolean),
    public.st_dwithin(public.geography, public.geography, double precision, boolean),
    public.st_makepoint(double precision, double precision),
    public.st_setsrid(public.geometry, integer),
    public.st_x(public.geometry),
    public.st_y(public.geometry),
    public.geography_distance_knn(public.geography, public.geography)
TO catalog_runtime;

-- UNVERIFIED - confirm the extension function signatures and schemas above on
-- the real Neon instance. They match the source SQL and the extensions created
-- by this migration history, but no database connection is available here.

-- Atlas needs ownership for ALTER/DROP; table grants alone are insufficient.
-- Move every non-extension public relation (including
-- public.atlas_schema_revisions) under the migration capability role.
DO $$
DECLARE
    relation RECORD;
    command TEXT;
BEGIN
    FOR relation IN
        SELECT c.relname, c.relkind
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
          AND NOT EXISTS (
              SELECT 1
              FROM pg_depend d
              WHERE d.classid = 'pg_class'::regclass
                AND d.objid = c.oid
                AND d.deptype = 'e'
          )
    LOOP
        command := CASE relation.relkind
            WHEN 'S' THEN 'ALTER SEQUENCE'
            WHEN 'v' THEN 'ALTER VIEW'
            WHEN 'm' THEN 'ALTER MATERIALIZED VIEW'
            ELSE 'ALTER TABLE'
        END;
        EXECUTE format(
            '%s public.%I OWNER TO catalog_migrator',
            command,
            relation.relname
        );
    END LOOP;
END $$;

DO $$
DECLARE
    routine RECORD;
BEGIN
    FOR routine IN
        SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prokind = 'f'
          AND NOT EXISTS (
              SELECT 1
              FROM pg_depend d
              WHERE d.classid = 'pg_proc'::regclass
                AND d.objid = p.oid
                AND d.deptype = 'e'
          )
    LOOP
        EXECUTE format(
            'ALTER FUNCTION public.%I(%s) OWNER TO catalog_migrator',
            routine.proname,
            routine.args
        );
    END LOOP;
END $$;

ALTER SCHEMA public OWNER TO catalog_migrator;

-- Future catalog tables do not receive runtime access automatically. Each new
-- runtime query must add a source-justified grant in the same Atlas migration.

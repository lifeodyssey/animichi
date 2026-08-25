-- #1050 / #1138 / #1140 staging remainder. Applied as neondb_owner (not migrator, not Atlas).
-- public ACL is pg_database_owner=UC + PUBLIC=U; neon_superuser has no CREATE.
-- FK messages_session_id_fkey needs REFERENCES on sessions; table owner can GRANT that.
-- Rename leftover conversation_messages index only; after Atlas, same name on messages must stay.
-- turn_reservations is owned by neondb_owner, so migrator cannot ALTER it.
-- Drop that leftover and un-apply its Atlas versions; /migrate recreates as migrator.
GRANT USAGE, CREATE ON SCHEMA public TO migrator;
GRANT REFERENCES ON TABLE public.sessions TO migrator;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index x
    JOIN pg_catalog.pg_class i ON i.oid = x.indexrelid
    JOIN pg_catalog.pg_class t ON t.oid = x.indrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND i.relname = 'idx_messages_session_created'
      AND t.relname = 'conversation_messages'
  ) THEN
    ALTER INDEX public.idx_messages_session_created
      RENAME TO idx_conversation_messages_session_created;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname = 'turn_reservations'
      AND r.rolname = 'neondb_owner'
  ) THEN
    DROP TABLE public.turn_reservations CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname = 'turn_reservations'
  ) THEN
    DELETE FROM public.atlas_schema_revisions
    WHERE version IN ('20260811000000', '20260811000001', '20260814191301');
  END IF;
END $$;
-- Hand neondb_owner's pre-cutover leftovers to migrator (#1050 follow-up).
--
-- The 20260809 batch was baselined here (applied=0/total=0), so 26 of the 34
-- public tables kept the shape AND the owner they had before migrator existed.
-- PostgreSQL 18 sql-grant: "The right to drop an object, or to alter its
-- definition in any way, is not treated as a grantable privilege; it is
-- inherent in the owner, and cannot be granted or revoked." So no GRANT can
-- let migrator run DDL on them — every migration touching one dies with
-- "must be owner of table X", and a red migrate skips every downstream deploy.
--
-- Ownership, not role membership: `GRANT neondb_owner TO migrator` would hand
-- over everything that role has, on every object, forever. Owning these named
-- relations is the narrower of the two mechanisms PostgreSQL offers.
--
-- DML isolation is untouched: agent_svc/catalog_svc/users_svc/readonly reach
-- these tables through explicit grants, which an owner change preserves.
-- Sequences move too, or migrator cannot ALTER the identity columns they back.
-- Scoped to relations neondb_owner actually owns, so cloud_admin's PostGIS
-- objects (spatial_ref_sys and its views) are never touched, and re-running
-- this is a no-op once the loop finds nothing.
--
-- The transfer needs one more thing than ownership of the source: per the same
-- reference, "to give ownership of an existing object to another role, you must
-- have the ability to SET ROLE to that role". neondb_owner and migrator are
-- siblings under neon_superuser, members of neither, so the ALTER fails with
-- "must be able to SET ROLE migrator" without this membership.
--
-- Direction matters, and it is the opposite of the one worth fearing. This
-- grants MIGRATOR to NEONDB_OWNER: the already-more-privileged admin role
-- temporarily gains the narrower one, which is not an escalation. The dangerous
-- direction, `GRANT neondb_owner TO migrator`, stays banned by the tests. The
-- membership is revoked below, so it exists only for this script's run.
GRANT migrator TO neondb_owner;
DO $$
DECLARE
  leftover record;
BEGIN
  FOR leftover IN
    SELECT c.relkind, c.relname
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'S')
      AND r.rolname = 'neondb_owner'
  LOOP
    IF leftover.relkind = 'r' THEN
      EXECUTE format('ALTER TABLE public.%I OWNER TO migrator', leftover.relname);
    ELSE
      EXECUTE format('ALTER SEQUENCE public.%I OWNER TO migrator', leftover.relname);
    END IF;
  END LOOP;
END $$;
-- Put the role topology back: the membership above was scaffolding for the
-- transfer, not a standing privilege.
REVOKE migrator FROM neondb_owner;

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

-- #1050 / #1138 staging remainder. Applied as neondb_owner (not migrator, not Atlas).
-- public ACL is pg_database_owner=UC + PUBLIC=U; neon_superuser has no CREATE.
-- FK messages_session_id_fkey needs REFERENCES on sessions; table owner can GRANT that.
-- Rename leftover conversation_messages index only; after Atlas, same name on messages must stay.
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

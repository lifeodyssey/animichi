-- #1050 / #1138 staging remainder. Applied as neondb_owner (not migrator, not Atlas).
-- public ACL is pg_database_owner=UC + PUBLIC=U; neon_superuser has no CREATE.
-- FK messages_session_id_fkey needs REFERENCES on sessions; table owner can GRANT that.
-- Leftover conversation_messages already took idx_messages_session_created; rename so Atlas can create it on messages.
GRANT USAGE, CREATE ON SCHEMA public TO migrator;
GRANT REFERENCES ON TABLE public.sessions TO migrator;
ALTER INDEX IF EXISTS public.idx_messages_session_created
  RENAME TO idx_conversation_messages_session_created;

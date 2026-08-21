-- #1050 / #1138 / #1140 staging remainder. Applied as neondb_owner (not migrator, not Atlas).
-- public ACL is pg_database_owner=UC + PUBLIC=U; neon_superuser has no CREATE.
-- FK messages_session_id_fkey needs REFERENCES on sessions; table owner can GRANT that.
-- Rename leftover conversation_messages index only; after Atlas, same name on messages must stay.
-- 20260814191301 ALTERs turn_reservations; migrator is not owner and cannot SET ROLE.
-- Owner applies that file's objects, then records the atlas.sum hash so /migrate skips.
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
BEGIN;
ALTER TABLE public.turn_reservations
    ADD COLUMN IF NOT EXISTS request_digest text;
ALTER TABLE public.turn_reservations
    ADD COLUMN IF NOT EXISTS outcome_payload jsonb;
CREATE TABLE IF NOT EXISTS public.turn_outbox_events (
    id uuid DEFAULT uuidv7() NOT NULL,
    session_id text,
    turn_key text NOT NULL,
    kind text NOT NULL,
    payload jsonb,
    attempts integer DEFAULT 0 NOT NULL,
    delivered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT turn_outbox_events_kind_check
        CHECK ((kind = ANY(ARRAY['usage'::text, 'quota'::text, 'audit'::text]))),
    CONSTRAINT turn_outbox_events_pkey PRIMARY KEY (id),
    CONSTRAINT turn_outbox_events_turn_kind UNIQUE (turn_key, kind)
);
CREATE INDEX IF NOT EXISTS idx_turn_outbox_undelivered
    ON public.turn_outbox_events USING btree (created_at)
    WHERE (delivered_at IS NULL);
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.turn_outbox_events TO agent_svc;
GRANT SELECT ON TABLE public.turn_outbox_events TO readonly;
INSERT INTO public.atlas_schema_revisions (
    version, description, type, applied, total, executed_at, execution_time,
    error, error_stmt, hash, operator_version
) VALUES (
    '20260814191301',
    'turn_idempotency_outbox',
    2,
    1,
    1,
    now(),
    0,
    NULL,
    NULL,
    'h1:TgYgAUUNmg1WHC0U6sX1l1a7BrD3rUFUrr4STLJtQGs=',
    'animichi-owner-grant/0.30.0'
) ON CONFLICT (version) DO UPDATE SET
    applied = EXCLUDED.applied,
    total = EXCLUDED.total,
    executed_at = EXCLUDED.executed_at,
    execution_time = EXCLUDED.execution_time,
    error = EXCLUDED.error,
    error_stmt = EXCLUDED.error_stmt,
    hash = EXCLUDED.hash,
    operator_version = EXCLUDED.operator_version;
COMMIT;

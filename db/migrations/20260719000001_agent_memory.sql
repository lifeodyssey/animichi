-- Auth-stripped Atlas twin of supabase/migrations/20260719000001_agent_memory.sql.
CREATE TABLE IF NOT EXISTS agent_memory (
    path TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    version BIGINT NOT NULL DEFAULT 1,
    last_operation_id TEXT
);

ALTER TABLE agent_memory
    ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE agent_memory
    ADD COLUMN IF NOT EXISTS last_operation_id TEXT;

CREATE TABLE IF NOT EXISTS agent_memory_operations (
    id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    version TEXT,
    existed BOOLEAN NOT NULL,
    completed BOOLEAN NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS agent_memory_versions MINVALUE 0 START 0;

CREATE TABLE IF NOT EXISTS agent_memory_metadata (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    versions_initialized BOOLEAN NOT NULL
);

DO $$
DECLARE
    initialized BOOLEAN;
BEGIN
    INSERT INTO agent_memory_metadata (id, versions_initialized)
    VALUES (TRUE, TRUE)
    ON CONFLICT (id) DO NOTHING
    RETURNING id INTO initialized;

    IF initialized IS NOT NULL THEN
        UPDATE agent_memory
        SET version = nextval('agent_memory_versions');
    END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON agent_memory TO agent_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_memory_operations TO agent_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_memory_metadata TO agent_svc;
GRANT USAGE, SELECT ON SEQUENCE agent_memory_versions TO agent_svc;

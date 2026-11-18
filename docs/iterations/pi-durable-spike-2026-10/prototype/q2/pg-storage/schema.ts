/**
 * The tables of the spike's Postgres `Storage`: `SqliteStorage`'s schema at version 2
 * (`@earendil-works/pi-durable@1.5.2 dist/storage/sqlite/migrations.js:7-105`) with one change, a `session_key` leading
 * every key, so each `SessionAgent` (one Durable Object per session id, every root conversation `1`) has its own keyspace
 * in shared tables. Records and document contents stay JSON text, as in SQLite: `jsonb` would refuse `\u0000` and lone
 * surrogates and reorder keys, and pi-durable JSON-encodes its indexed strings to stay lossless (`rows.js:6-7`).
 * Applied once per database by the runner, as a migration would be; opening a storage creates nothing.
 */
export const SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS pd_meta (session_key text PRIMARY KEY, next_id bigint NOT NULL, next_seq bigint NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pd_record_ids (session_key text NOT NULL, id bigint NOT NULL,
    record_type text NOT NULL CHECK (record_type IN ('conversation', 'entry', 'task', 'submission', 'document')), PRIMARY KEY (session_key, id))`,
  `CREATE TABLE IF NOT EXISTS pd_conversations (session_key text NOT NULL, id bigint NOT NULL, owner_conversation_id bigint, owner_task_id bigint,
    record text NOT NULL, PRIMARY KEY (session_key, id))`,
  `CREATE INDEX IF NOT EXISTS pd_conversations_by_owner_conversation ON pd_conversations (session_key, owner_conversation_id, id)`,
  `CREATE INDEX IF NOT EXISTS pd_conversations_by_owner_task ON pd_conversations (session_key, owner_task_id, id)`,
  `CREATE TABLE IF NOT EXISTS pd_entries (session_key text NOT NULL, id bigint NOT NULL, conversation_id bigint NOT NULL, head bigint,
    commit_seq bigint NOT NULL, record text NOT NULL, PRIMARY KEY (session_key, id))`,
  `CREATE INDEX IF NOT EXISTS pd_entries_by_conversation ON pd_entries (session_key, conversation_id, id DESC)`,
  `CREATE INDEX IF NOT EXISTS pd_entry_heads_by_conversation ON pd_entries (session_key, conversation_id, id DESC) WHERE head IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS pd_tasks (session_key text NOT NULL, id bigint NOT NULL, conversation_id bigint NOT NULL, kind text NOT NULL,
    status text NOT NULL CHECK (status IN ('pending', 'running', 'waiting', 'sleeping', 'completing', 'terminal')),
    abort_requested boolean NOT NULL, background boolean NOT NULL, record text NOT NULL, PRIMARY KEY (session_key, id))`,
  `CREATE INDEX IF NOT EXISTS pd_tasks_by_status ON pd_tasks (session_key, status, id)`,
  `CREATE INDEX IF NOT EXISTS pd_tasks_by_conversation ON pd_tasks (session_key, conversation_id, id)`,
  `CREATE INDEX IF NOT EXISTS pd_tasks_by_kind ON pd_tasks (session_key, kind, id)`,
  `CREATE INDEX IF NOT EXISTS pd_tasks_by_abort_requested ON pd_tasks (session_key, abort_requested, id)`,
  `CREATE INDEX IF NOT EXISTS pd_tasks_by_background ON pd_tasks (session_key, background, id)`,
  `CREATE TABLE IF NOT EXISTS pd_submissions (session_key text NOT NULL, id bigint NOT NULL, conversation_id bigint NOT NULL, request_id text,
    status text NOT NULL CHECK (status IN ('queued', 'placed', 'done', 'unanswered')), record text NOT NULL, PRIMARY KEY (session_key, id))`,
  `CREATE INDEX IF NOT EXISTS pd_submissions_by_request ON pd_submissions (session_key, conversation_id, request_id)`,
  `CREATE INDEX IF NOT EXISTS pd_submissions_by_conversation ON pd_submissions (session_key, conversation_id, id)`,
  `CREATE INDEX IF NOT EXISTS pd_submissions_by_status ON pd_submissions (session_key, status, id)`,
  `CREATE TABLE IF NOT EXISTS pd_documents (session_key text NOT NULL, id bigint NOT NULL, kind text NOT NULL, family smallint NOT NULL CHECK (family IN (0, 1)),
    key_value text NOT NULL, scope_kind text NOT NULL CHECK (scope_kind IN ('session', 'conversation', 'task')), owner_id bigint NOT NULL,
    created_at bigint NOT NULL, retired_at bigint, record text NOT NULL, PRIMARY KEY (session_key, id))`,
  `CREATE INDEX IF NOT EXISTS pd_documents_by_address ON pd_documents (session_key, kind, scope_kind, owner_id, family, key_value, created_at DESC, retired_at)`,
  `CREATE INDEX IF NOT EXISTS pd_documents_by_scope ON pd_documents (session_key, scope_kind, owner_id, id)`,
  `CREATE INDEX IF NOT EXISTS pd_documents_by_scope_kind ON pd_documents (session_key, scope_kind, owner_id, kind, id)`,
  `CREATE TABLE IF NOT EXISTS pd_document_revisions (session_key text NOT NULL, document_id bigint NOT NULL, seq bigint NOT NULL,
    kind text NOT NULL CHECK (kind IN ('base', 'delta')), version integer NOT NULL, content text NOT NULL, PRIMARY KEY (session_key, document_id, seq))`,
  `CREATE INDEX IF NOT EXISTS pd_document_revisions_by_kind ON pd_document_revisions (session_key, document_id, kind, seq DESC)`,
];

/** The tables a keyspace's rows live in, for the runners' row reads. */
export const TABLES = ["pd_meta", "pd_record_ids", "pd_conversations", "pd_entries", "pd_tasks", "pd_submissions", "pd_documents", "pd_document_revisions"] as const;

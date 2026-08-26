-- Neon data-plane baseline: agent bounded context (11 tables + 1 sequence).
-- agent_svc holds the write grants (SELECT/INSERT/UPDATE/DELETE, or SELECT/USAGE on the
-- sequence) on every object below; jobs_svc and readonly hold read-only grants where
-- noted per table. sessions must precede messages (FK); the ordering is preserved below.

CREATE SEQUENCE public.agent_memory_versions
    START WITH 0
    INCREMENT BY 1
    MINVALUE 0
    NO MAXVALUE
    CACHE 1;
GRANT SELECT, USAGE ON SEQUENCE public.agent_memory_versions TO agent_svc;

-- Create "agent_memory" table
CREATE TABLE public.agent_memory (
  path text NOT NULL,
  content text NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  last_operation_id text NULL,
  PRIMARY KEY (path)
);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.agent_memory TO agent_svc;

-- Create "agent_memory_metadata" table
CREATE TABLE public.agent_memory_metadata (
  id boolean NOT NULL DEFAULT true,
  versions_initialized boolean NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT agent_memory_metadata_id_check CHECK (id)
);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.agent_memory_metadata TO agent_svc;

-- Create "agent_memory_operations" table
CREATE TABLE public.agent_memory_operations (
  id text NOT NULL,
  fingerprint text NOT NULL,
  version text NULL,
  existed boolean NOT NULL,
  completed boolean NOT NULL,
  PRIMARY KEY (id)
);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.agent_memory_operations TO agent_svc;

-- Create "anon_daily_message_count" table
CREATE TABLE public.anon_daily_message_count (
  usage_date date NOT NULL,
  anon_id text NOT NULL,
  message_count bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usage_date, anon_id)
);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.anon_daily_message_count TO agent_svc;
GRANT SELECT, DELETE ON TABLE public.anon_daily_message_count TO jobs_svc;

-- Create "daily_usage" table
CREATE TABLE public.daily_usage (
  usage_date date NOT NULL,
  scope text NOT NULL,
  requests bigint NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  cost_usd numeric(14,6) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usage_date, scope),
  CONSTRAINT daily_usage_scope_check CHECK (scope = ANY(ARRAY['anon'::text, 'user'::text, 'byok'::text]))
);
-- Create index "idx_daily_usage_scope_date" to table: "daily_usage"
CREATE INDEX idx_daily_usage_scope_date ON public.daily_usage (scope, usage_date DESC);
GRANT SELECT, INSERT, UPDATE ON TABLE public.daily_usage TO agent_svc;

-- Create "feedback" table
CREATE TABLE public.feedback (
  id uuid NOT NULL DEFAULT uuidv7(),
  session_id text NULL,
  query_text text NOT NULL,
  intent text NULL,
  rating text NOT NULL,
  comment text NULL,
  created_at timestamptz NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT feedback_rating_check CHECK (rating = ANY(ARRAY['good'::text, 'bad'::text]))
);
-- Create index "idx_feedback_created" to table: "feedback"
CREATE INDEX idx_feedback_created ON public.feedback (created_at DESC);
-- Create index "idx_feedback_intent" to table: "feedback"
CREATE INDEX idx_feedback_intent ON public.feedback (intent);
-- Create index "idx_feedback_rating" to table: "feedback"
CREATE INDEX idx_feedback_rating ON public.feedback (rating);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.feedback TO agent_svc;

-- Create "request_log" table
CREATE TABLE public.request_log (
  id uuid NOT NULL DEFAULT uuidv7(),
  created_at timestamptz NOT NULL DEFAULT now(),
  session_id text NULL,
  query_text text NOT NULL,
  locale text NOT NULL DEFAULT 'ja',
  plan_steps jsonb NULL,
  intent text NULL,
  status text NULL,
  latency_ms integer NULL,
  plan_quality_score real NULL,
  PRIMARY KEY (id)
);
-- Create index "idx_request_log_created" to table: "request_log"
CREATE INDEX idx_request_log_created ON public.request_log (created_at DESC);
-- Create index "idx_request_log_intent" to table: "request_log"
CREATE INDEX idx_request_log_intent ON public.request_log (intent);
-- Create index "idx_request_log_locale" to table: "request_log"
CREATE INDEX idx_request_log_locale ON public.request_log (locale);
-- Create index "idx_request_log_unscored" to table: "request_log"
CREATE INDEX idx_request_log_unscored ON public.request_log (id) WHERE (plan_quality_score IS null);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.request_log TO agent_svc;

-- Create "turn_outbox_events" table
CREATE TABLE public.turn_outbox_events (
  id uuid NOT NULL DEFAULT uuidv7(),
  session_id text NULL,
  turn_key text NOT NULL,
  kind text NOT NULL,
  payload jsonb NULL,
  attempts integer NOT NULL DEFAULT 0,
  delivered_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT turn_outbox_events_turn_kind UNIQUE (turn_key, kind),
  CONSTRAINT turn_outbox_events_kind_check CHECK (kind = ANY(ARRAY['usage'::text, 'quota'::text, 'audit'::text]))
);
-- Create index "idx_turn_outbox_undelivered" to table: "turn_outbox_events"
CREATE INDEX idx_turn_outbox_undelivered ON public.turn_outbox_events (created_at) WHERE (delivered_at IS null);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.turn_outbox_events TO agent_svc;
GRANT SELECT ON TABLE public.turn_outbox_events TO readonly;

-- Create "turn_reservations" table
CREATE TABLE public.turn_reservations (
  id uuid NOT NULL DEFAULT uuidv7(),
  session_id text NULL,
  turn_key text NOT NULL,
  payer text NOT NULL,
  identity_id text NULL,
  revision integer NOT NULL,
  digest text NULL,
  status text NOT NULL DEFAULT 'reserved',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text NOT NULL DEFAULT '',
  lease_expires_at timestamptz NOT NULL DEFAULT now(),
  request_digest text NULL,
  outcome_payload jsonb NULL,
  PRIMARY KEY (id),
  CONSTRAINT turn_reservations_session_revision UNIQUE (session_id, revision),
  CONSTRAINT turn_reservations_session_turn_key UNIQUE (session_id, turn_key),
  CONSTRAINT turn_reservations_payer_check CHECK (payer = ANY(ARRAY['anon'::text, 'user'::text, 'byok'::text])),
  CONSTRAINT turn_reservations_status_check CHECK (status = ANY(ARRAY['reserved'::text, 'running'::text, 'completed'::text, 'failed'::text]))
);
-- Create index "idx_turn_reservations_session_revision" to table: "turn_reservations"
CREATE INDEX idx_turn_reservations_session_revision ON public.turn_reservations (session_id, revision DESC);
-- Create index "idx_turn_reservations_sweep" to table: "turn_reservations"
CREATE INDEX idx_turn_reservations_sweep ON public.turn_reservations (status, lease_expires_at) WHERE (status = ANY(ARRAY['reserved'::text, 'running'::text]));
-- Create index "turn_reservations_null_session_key" to table: "turn_reservations"
CREATE UNIQUE INDEX turn_reservations_null_session_key ON public.turn_reservations (turn_key) WHERE (session_id IS null);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.turn_reservations TO agent_svc;
GRANT SELECT ON TABLE public.turn_reservations TO readonly;

-- Create "sessions" table
CREATE TABLE public.sessions (
  id text NOT NULL,
  user_id text NULL,
  title text NULL,
  first_query text NULL,
  state jsonb NOT NULL DEFAULT '{}',
  metadata jsonb NULL DEFAULT '{}',
  lifecycle text NULL DEFAULT 'active',
  created_at timestamptz NULL DEFAULT now(),
  updated_at timestamptz NULL DEFAULT now(),
  expires_at timestamptz NULL,
  PRIMARY KEY (id)
);
-- Create index "idx_sessions_lifecycle" to table: "sessions"
CREATE INDEX idx_sessions_lifecycle ON public.sessions (lifecycle);
-- Create index "idx_sessions_user" to table: "sessions"
CREATE INDEX idx_sessions_user ON public.sessions (user_id);
-- Create index "idx_sessions_user_updated" to table: "sessions"
CREATE INDEX idx_sessions_user_updated ON public.sessions (user_id, updated_at DESC);
CREATE TRIGGER trg_sessions_updated_at
  BEFORE UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.sessions TO agent_svc;
GRANT SELECT, DELETE ON TABLE public.sessions TO jobs_svc;

-- Create "messages" table
CREATE TABLE public.messages (
  id uuid NOT NULL DEFAULT uuidv7(),
  session_id text NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  response_data jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions (id) ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT messages_role_check CHECK (role = ANY(ARRAY['user'::text, 'assistant'::text]))
);
-- Create index "idx_messages_session_created" to table: "messages"
CREATE INDEX idx_messages_session_created ON public.messages (session_id, created_at);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.messages TO agent_svc;

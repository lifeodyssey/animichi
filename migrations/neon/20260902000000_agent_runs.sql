-- Agent turn runs (W1-1, issue #1250): the durable per-turn record the intake writes,
-- the AgentSession Durable Object settles, and the singleton RunSweeper DO scans.
-- One row per agent turn, plus one row per tool step so an alarm retry replays what
-- already happened instead of re-running it (spec 2026-09-01 §三).
--
-- Ownership: agent bounded context. agent_svc holds the write grants. readonly gets
-- SELECT on runs for the same reason it has it on turn_reservations and
-- turn_outbox_events (see the header of 20260826000004_agent.sql): a run row carries
-- ids, a status, counters and timestamps -- no user-generated content and no PII.
-- run_steps is deliberately NOT granted to readonly: a tool's input and result carry
-- the visitor's own query text. No DELETE grant on either: rows are retained with
-- their session and disappear through the FK cascade, which runs under the
-- constraint's own privileges, not the deleter's.
--
-- Purely additive against the deployed consumers one version back (US25/#1052):
-- two new tables plus one nullable column and one PARTIAL unique index on messages.
-- The Python agent still deployed one version back neither reads nor writes any of
-- it, and rows it writes leave client_message_id NULL, which the partial index ignores.

-- The client-supplied id of the user message that opened one turn. It is the intake
-- dedupe key: a replayed POST /v1/chat must find the existing message instead of
-- appending a second one. Nullable because every message written before this
-- migration has none, so the uniqueness is a PARTIAL index over the non-null values
-- -- it states "at most one message per (session, client id)" directly instead of
-- leaning on the NULLS DISTINCT default to excuse the legacy rows.
-- `atlas migrate lint` reports MF101 (a unique index may fail on existing
-- duplicates) here; it does not read the WHERE predicate. Every row that exists
-- when this runs has client_message_id NULL, so the indexed set is empty.
ALTER TABLE public.messages ADD COLUMN client_message_id text NULL;
-- Create index "messages_session_client_message_id" to table: "messages"
CREATE UNIQUE INDEX messages_session_client_message_id ON public.messages (session_id, client_message_id) WHERE (client_message_id IS NOT null);

-- Create "runs" table
CREATE TABLE public.runs (
  id uuid NOT NULL DEFAULT uuidv7(),
  session_id text NOT NULL,
  message_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'running',
  failure_reason text NULL,
  lease_owner text NULL,
  lease_expires_at timestamptz NULL,
  deadline_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  payer text NOT NULL,
  quota_identity_id text NULL,
  quota_usage_date date NULL,
  quota_refunded_at timestamptz NULL,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  cost_usd numeric(14,6) NOT NULL DEFAULT 0,
  usage_settled_at timestamptz NULL,
  PRIMARY KEY (id),
  CONSTRAINT runs_message_id_key UNIQUE (message_id),
  CONSTRAINT runs_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions (id) ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT runs_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages (id) ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT runs_status_check CHECK (status = ANY(ARRAY['running'::text, 'succeeded'::text, 'failed'::text])),
  CONSTRAINT runs_payer_check CHECK (payer = ANY(ARRAY['anon'::text, 'user'::text, 'byok'::text])),
  CONSTRAINT runs_failure_reason_check CHECK (failure_reason IS null OR failure_reason = ANY(ARRAY['lease_expired'::text, 'deadline_exceeded'::text, 'provider_failed'::text, 'tool_failed'::text, 'cancelled'::text, 'internal_error'::text])),
  CONSTRAINT runs_failed_has_reason_check CHECK ((status = 'failed') = (failure_reason IS NOT null)),
  CONSTRAINT runs_terminal_is_finished_check CHECK ((status = 'running') = (finished_at IS null)),
  CONSTRAINT runs_lease_held_check CHECK ((lease_owner IS null) = (lease_expires_at IS null)),
  CONSTRAINT runs_lease_within_deadline_check CHECK (lease_expires_at <= deadline_at),
  CONSTRAINT runs_quota_reservation_check CHECK ((quota_identity_id IS null) = (quota_usage_date IS null)),
  CONSTRAINT runs_quota_refund_check CHECK (quota_refunded_at IS null OR quota_identity_id IS NOT null)
);
-- Create index "idx_runs_session_started" to table: "runs"
CREATE INDEX idx_runs_session_started ON public.runs (session_id, started_at DESC);
-- The whole RunSweeper scan, in one partial index over the only rows it cares about.
-- A lease is a (owner, expiry) pair or neither (runs_lease_held_check), so a run the
-- intake committed but never armed with setAlarm has lease_expires_at NULL and sorts
-- last in this index -- the sweeper's `lease_expires_at IS NULL OR lease_expires_at <
-- now()` reads both cases from here. runs_lease_within_deadline_check caps every
-- renewal at deadline_at, so a live-but-wedged writer cannot renew its way out of the
-- scan either. Column order mirrors idx_turn_reservations_sweep.
-- Create index "idx_runs_sweep" to table: "runs"
CREATE INDEX idx_runs_sweep ON public.runs (status, lease_expires_at) WHERE (status = 'running');
-- Admission: one session runs at most one turn at a time, so the intake's INSERT
-- is the whole busy-session decision -- a second concurrent turn loses on this
-- index rather than on a read-then-write race. That is the single-winner property
-- turn_reservations got from turn_reservations_session_revision; it is partial on
-- `running` so a session's settled turns never collide with the next one.
-- Create index "runs_one_running_per_session" to table: "runs"
CREATE UNIQUE INDEX runs_one_running_per_session ON public.runs (session_id) WHERE (status = 'running');
GRANT SELECT, INSERT, UPDATE ON TABLE public.runs TO agent_svc;
GRANT SELECT ON TABLE public.runs TO readonly;

-- One row per tool step of one run. The loop persists a step's result BEFORE it
-- continues, so an alarm that reruns the same run after an eviction replays every
-- step that already has a result instead of calling the tool again (spec §三 "工具
-- 步骤幂等"). (run_id, step_index) is therefore both the primary key and the
-- idempotency key a side-effecting tool must accept; result and finished_at appear
-- together, which is exactly the "already done" predicate the replay reads.
-- Create "run_steps" table
CREATE TABLE public.run_steps (
  run_id uuid NOT NULL,
  step_index integer NOT NULL,
  tool_name text NOT NULL,
  input jsonb NOT NULL,
  result jsonb NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  PRIMARY KEY (run_id, step_index),
  CONSTRAINT run_steps_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.runs (id) ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT run_steps_step_index_check CHECK (step_index >= 0),
  CONSTRAINT run_steps_settled_check CHECK ((result IS null) = (finished_at IS null))
);
GRANT SELECT, INSERT, UPDATE ON TABLE public.run_steps TO agent_svc;

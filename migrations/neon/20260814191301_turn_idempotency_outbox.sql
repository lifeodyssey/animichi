-- Issue #1014: exactly-once Chat turns across retries (turn-idempotency recovery + durable outbox).
--
-- 1. turn_reservations gains the committed-result payload and a canonical
--    request digest: a replay returns the already-committed assistant output
--    WITHOUT re-invoking the model (AC3), and a same-key/different-canonical-
--    request submission is detected and rejected with a typed conflict (AC4).
--      * request_digest  text  -- canonical sha256 hex of the turn request
--      * outcome_payload jsonb -- serialized committed wire output (opaque)
--
-- 2. turn_outbox_events is the durable outbox for external non-transactional
--    effects (AC5): usage metering / quota / audit rows are recorded with the
--    turn's terminal transition so a process crash after the DB commit cannot
--    lose or double-apply them. (turn_key, kind) uniqueness makes enqueue
--    idempotent, and delivered_at is the exactly-once CAS marker.

ALTER TABLE public.turn_reservations
    ADD COLUMN request_digest text;

ALTER TABLE public.turn_reservations
    ADD COLUMN outcome_payload jsonb;

CREATE TABLE public.turn_outbox_events (
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
        CHECK ((kind = ANY(ARRAY['usage'::text, 'quota'::text, 'audit'::text])))
);

ALTER TABLE ONLY public.turn_outbox_events
    ADD CONSTRAINT turn_outbox_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.turn_outbox_events
    ADD CONSTRAINT turn_outbox_events_turn_kind UNIQUE (turn_key, kind);

CREATE INDEX idx_turn_outbox_undelivered
    ON public.turn_outbox_events USING btree (created_at)
    WHERE (delivered_at IS NULL);

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.turn_outbox_events TO agent_svc;
GRANT SELECT ON TABLE public.turn_outbox_events TO readonly;

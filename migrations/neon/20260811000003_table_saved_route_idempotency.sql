-- Table saved_route_idempotency (SavedRoute create idempotency ledger; issue #1011)

-- One row per (owner, operation, Idempotency-Key): the durable record of a
-- retry-safe SavedRoute create. The primary key scopes every idempotent write
-- by the authenticated owner + operation, so two users sharing one key string
-- never collide and an operation's key never dedupes against another's.
CREATE TABLE public.saved_route_idempotency (
    owner_user_id text CONSTRAINT sr_idem_owner_nn NOT NULL,
    op text CONSTRAINT sr_idem_op_nn NOT NULL,
    key text CONSTRAINT sr_idem_key_nn NOT NULL,
    fingerprint text CONSTRAINT sr_idem_fp_nn NOT NULL,
    state text DEFAULT 'in_progress'::text CONSTRAINT sr_idem_state_nn NOT NULL,
    result jsonb,
    result_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone CONSTRAINT sr_idem_expires_nn NOT NULL,
    CONSTRAINT sr_idem_state_check CHECK ((state = ANY(ARRAY['in_progress'::text, 'committed'::text]))),
    CONSTRAINT saved_route_idempotency_pkey PRIMARY KEY (owner_user_id, op, key)
);

CREATE INDEX idx_saved_route_idempotency_expires ON public.saved_route_idempotency USING btree (expires_at);

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.saved_route_idempotency TO users_svc;
GRANT SELECT ON TABLE public.saved_route_idempotency TO readonly;

-- Table sessions (indexes/constraints/triggers)
--
-- The sole Session aggregate root (SESSION-3 #961): state envelope, runtime
-- metadata, AND ownership. `title`/`first_query` live here so the aggregate
-- owns its index row and its identity in one row. `user_id` records the
-- owner — the trusted anonymous id before login, the Neon user id after
-- adoption.

CREATE TABLE public.sessions (
    id text NOT NULL,
    user_id text,
    title text,
    first_query text,
    state jsonb DEFAULT '{}'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    lifecycle text DEFAULT 'active'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone
);

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);

CREATE INDEX idx_sessions_lifecycle ON public.sessions USING btree (lifecycle);

CREATE INDEX idx_sessions_user ON public.sessions USING btree (user_id);

CREATE INDEX idx_sessions_user_updated ON public.sessions USING btree (user_id, updated_at DESC);

CREATE TRIGGER trg_sessions_updated_at BEFORE UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Table request_log (indexes/constraints/triggers)

CREATE TABLE public.request_log (
    id uuid DEFAULT uuidv7() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    session_id text,
    query_text text NOT NULL,
    locale text DEFAULT 'ja'::text NOT NULL,
    plan_steps jsonb,
    intent text,
    status text,
    latency_ms integer,
    plan_quality_score real
);

ALTER TABLE ONLY public.request_log
    ADD CONSTRAINT request_log_pkey PRIMARY KEY (id);

CREATE INDEX idx_request_log_created ON public.request_log USING btree (created_at DESC);

CREATE INDEX idx_request_log_intent ON public.request_log USING btree (intent);

CREATE INDEX idx_request_log_locale ON public.request_log USING btree (locale);

CREATE INDEX idx_request_log_unscored ON public.request_log USING btree (id) WHERE (plan_quality_score IS NULL);

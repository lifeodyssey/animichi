-- Table daily_usage (indexes/constraints/triggers)

CREATE TABLE public.daily_usage (
    usage_date date NOT NULL,
    scope text NOT NULL,
    requests bigint DEFAULT 0 NOT NULL,
    input_tokens bigint DEFAULT 0 NOT NULL,
    output_tokens bigint DEFAULT 0 NOT NULL,
    cost_usd numeric(14,6) DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT daily_usage_scope_check CHECK ((scope = ANY (ARRAY['anon'::text, 'user'::text, 'byok'::text])))
);

ALTER TABLE ONLY public.daily_usage
    ADD CONSTRAINT daily_usage_pkey PRIMARY KEY (usage_date, scope);

CREATE INDEX idx_daily_usage_scope_date ON public.daily_usage USING btree (scope, usage_date DESC);

-- Table anon_daily_message_count (indexes/constraints/triggers)

CREATE TABLE public.anon_daily_message_count (
    usage_date date NOT NULL,
    anon_id text NOT NULL,
    message_count bigint NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.anon_daily_message_count
    ADD CONSTRAINT anon_daily_message_count_pkey PRIMARY KEY (usage_date, anon_id);

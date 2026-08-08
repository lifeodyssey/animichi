-- Table raw_anitabi (indexes/constraints/triggers)

CREATE TABLE public.raw_anitabi (
    work_id text NOT NULL,
    payload jsonb NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.raw_anitabi
    ADD CONSTRAINT raw_anitabi_pkey PRIMARY KEY (work_id);

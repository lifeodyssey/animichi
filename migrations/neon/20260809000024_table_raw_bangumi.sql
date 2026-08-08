-- Table raw_bangumi (indexes/constraints/triggers)

CREATE TABLE public.raw_bangumi (
    work_id text NOT NULL,
    payload jsonb NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.raw_bangumi
    ADD CONSTRAINT raw_bangumi_pkey PRIMARY KEY (work_id);

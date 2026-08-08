-- Table ingest_jobs (indexes/constraints/triggers)

CREATE TABLE public.ingest_jobs (
    work_id text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    stage text,
    error text,
    error_code text,
    negative_cached_until timestamp with time zone,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.ingest_jobs
    ADD CONSTRAINT ingest_jobs_pkey PRIMARY KEY (work_id);

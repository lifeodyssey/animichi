-- Table catalog_runs (issue #1006 AC1): durable daily discovery+ingest run.
-- A STABLE run id (run_id = 'daily-' || date) makes retries idempotent: re-running
-- the same day resumes/records that run instead of starting a second one, and the
-- target set, per-source outcomes, budget use, failures, completion state, and the
-- publish versions each work reached are all captured here for diagnosis and alerts.

CREATE TABLE public.catalog_runs (
    run_id text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    targets jsonb,
    source_outcomes jsonb,
    budget_used jsonb,
    failures jsonb,
    published_versions jsonb,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.catalog_runs
    ADD CONSTRAINT catalog_runs_pkey PRIMARY KEY (run_id);

CREATE INDEX idx_catalog_runs_status ON public.catalog_runs USING btree (status);

-- Table raw_payload_history (issue #1006 AC5): the latest and previous raw payload
-- per (work_id, source) needed for diagnosis. The existing raw_anitabi/raw_bangumi
-- tables keep the single current payload; this table appends every fetched payload
-- so the ingest pipeline can diagnose changes without unbounded storage. Bounded
-- cleanup keeps only the newest 2 rows per (work_id, source) and never deletes a
-- row captured by the active (running) run's evidence.

CREATE TABLE public.raw_payload_history (
    seq bigserial NOT NULL,
    work_id text NOT NULL,
    source text NOT NULL,
    payload jsonb NOT NULL,
    run_id text,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.raw_payload_history
    ADD CONSTRAINT raw_payload_history_pkey PRIMARY KEY (seq);

CREATE INDEX idx_raw_payload_history_work_source ON public.raw_payload_history USING btree (work_id, source, seq DESC);

-- Table catalog_provenance (issue #1006 AC4): provenance + attribution/license +
-- field-level source mapping for each upstream-derived entity. A row is keyed by
-- (scope, entity_id): scope 'point' carries the Anitabi point's upstream identity
-- and per-field source map; scope 'work' carries the Bangumi subject's provenance.
-- Re-enrich UPSERTs the row so the latest capture wins.

CREATE TABLE public.catalog_provenance (
    id uuid DEFAULT uuidv7() NOT NULL,
    scope text NOT NULL,
    entity_id text NOT NULL,
    work_id text,
    source text NOT NULL,
    upstream_id text,
    attribution text,
    license text,
    field_map jsonb,
    captured_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.catalog_provenance
    ADD CONSTRAINT catalog_provenance_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX uq_catalog_provenance_scope_entity ON public.catalog_provenance USING btree (scope, entity_id);

CREATE INDEX idx_catalog_provenance_work ON public.catalog_provenance USING btree (work_id);

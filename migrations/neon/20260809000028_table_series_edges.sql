-- Table series_edges (indexes/constraints/triggers)

CREATE TABLE public.series_edges (
    from_bangumi_id text CONSTRAINT series_edges_from_work_id_not_null NOT NULL,
    to_bangumi_id text CONSTRAINT series_edges_to_work_id_not_null NOT NULL,
    relation text NOT NULL
);

ALTER TABLE ONLY public.series_edges
    ADD CONSTRAINT series_edges_pkey PRIMARY KEY (from_bangumi_id, to_bangumi_id, relation);

CREATE INDEX idx_series_edges_to_bangumi ON public.series_edges USING btree (to_bangumi_id);

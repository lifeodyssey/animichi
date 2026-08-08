-- Table leg_cache (indexes/constraints/triggers)

CREATE TABLE public.leg_cache (
    from_cluster text NOT NULL,
    to_cluster text NOT NULL,
    mode text NOT NULL,
    duration_minutes double precision,
    distance_m double precision,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.leg_cache
    ADD CONSTRAINT leg_cache_pkey PRIMARY KEY (from_cluster, to_cluster, mode);

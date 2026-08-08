-- Table media_assets (indexes/constraints/triggers)

CREATE TABLE public.media_assets (
    point_id text NOT NULL,
    r2_key text,
    content_hash text,
    last_origin_pull timestamp with time zone,
    tombstoned boolean DEFAULT false NOT NULL
);

ALTER TABLE ONLY public.media_assets
    ADD CONSTRAINT media_assets_pkey PRIMARY KEY (point_id);

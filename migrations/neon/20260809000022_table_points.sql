-- Table points (indexes/constraints/triggers)

CREATE TABLE public.points (
    id text NOT NULL,
    bangumi_id text,
    name text NOT NULL,
    name_cn text,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    location public.geography(Point,4326),
    image text,
    episode integer,
    time_seconds integer DEFAULT 0,
    scene_desc text,
    embedding public.vector(1024),
    origin text,
    origin_url text,
    city text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY public.points
    ADD CONSTRAINT points_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.points
    ADD CONSTRAINT points_bangumi_id_fkey FOREIGN KEY (bangumi_id) REFERENCES public.bangumi(id);

CREATE INDEX idx_points_bangumi ON public.points USING btree (bangumi_id);

CREATE INDEX idx_points_embedding ON public.points USING hnsw (embedding public.vector_cosine_ops);

CREATE INDEX idx_points_location ON public.points USING gist (location);

CREATE TRIGGER trg_points_sync_coordinates BEFORE INSERT OR UPDATE ON public.points FOR EACH ROW EXECUTE FUNCTION public.sync_points_coordinates();

CREATE TRIGGER trg_points_updated_at BEFORE UPDATE ON public.points FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

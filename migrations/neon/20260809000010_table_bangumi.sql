-- Table bangumi (indexes/constraints/triggers)

CREATE TABLE public.bangumi (
    id text NOT NULL,
    title text NOT NULL,
    title_cn text,
    cover_url text,
    air_date text,
    summary text,
    eps_count integer,
    rating real,
    points_count integer DEFAULT 0,
    primary_color text,
    city text,
    platform text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY public.bangumi
    ADD CONSTRAINT bangumi_pkey PRIMARY KEY (id);

CREATE TRIGGER trg_bangumi_updated_at BEFORE UPDATE ON public.bangumi FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

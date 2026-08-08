-- Table locations (indexes/constraints/triggers)

CREATE TABLE public.locations (
    id text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    location public.GEOGRAPHY(POINT,4326),
    source text NOT NULL,
    pref text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT locations_kind_check CHECK ((kind = ANY(ARRAY['station'::text, 'city'::text, 'ward'::text, 'landmark'::text, 'prefecture'::text]))),
    CONSTRAINT locations_source_check CHECK ((source = ANY(ARRAY['seed'::text, 'mlit'::text, 'geonames'::text, 'manual'::text])))
);

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_pkey PRIMARY KEY (id);

CREATE TRIGGER trg_locations_sync_coordinates BEFORE INSERT OR UPDATE ON public.locations FOR EACH ROW EXECUTE FUNCTION public.sync_points_coordinates();

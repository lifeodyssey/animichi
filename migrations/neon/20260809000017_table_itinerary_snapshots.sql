-- Table itinerary_snapshots (indexes/constraints/triggers)

CREATE TABLE public.itinerary_snapshots (
    id integer CONSTRAINT route_snapshots_id_not_null NOT NULL,
    bangumi_id text CONSTRAINT route_snapshots_work_id_not_null NOT NULL,
    cluster_version integer CONSTRAINT route_snapshots_cluster_version_not_null NOT NULL,
    payload jsonb CONSTRAINT route_snapshots_payload_not_null NOT NULL,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT route_snapshots_created_at_not_null NOT NULL
);

ALTER TABLE ONLY public.itinerary_snapshots
    ADD CONSTRAINT route_snapshots_pkey PRIMARY KEY (id);

CREATE INDEX idx_itinerary_snapshots_bangumi_version ON public.itinerary_snapshots USING btree (bangumi_id, cluster_version);

ALTER SEQUENCE public.itinerary_snapshots_id_seq OWNED BY public.itinerary_snapshots.id;

-- serial default: id
ALTER TABLE ONLY public.itinerary_snapshots ALTER COLUMN id SET DEFAULT nextval('public.itinerary_snapshots_id_seq'::regclass);

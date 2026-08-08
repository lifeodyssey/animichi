-- Table cluster_version (indexes/constraints/triggers)

CREATE TABLE public.cluster_version (
    id integer NOT NULL,
    bangumi_id text CONSTRAINT cluster_version_work_id_not_null NOT NULL,
    version integer NOT NULL,
    is_current boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.cluster_version
    ADD CONSTRAINT cluster_version_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.cluster_version
    ADD CONSTRAINT cluster_version_work_id_version_key UNIQUE (bangumi_id, version);

CREATE INDEX idx_cluster_version_current ON public.cluster_version USING btree (bangumi_id, is_current);

CREATE UNIQUE INDEX uq_cluster_version_one_current ON public.cluster_version USING btree (bangumi_id) WHERE is_current;

ALTER SEQUENCE public.cluster_version_id_seq OWNED BY public.cluster_version.id;

-- serial default: id
ALTER TABLE ONLY public.cluster_version ALTER COLUMN id SET DEFAULT nextval('public.cluster_version_id_seq'::regclass);

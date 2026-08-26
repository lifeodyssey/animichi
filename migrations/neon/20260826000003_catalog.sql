-- Neon data-plane baseline: catalog bounded context (16 tables).
-- catalog_svc holds the write grants (SELECT/INSERT/UPDATE/DELETE) on every table
-- below; agent_svc and readonly hold read-only SELECT grants where noted per table.
-- locations must precede location_aliases (FK) and bangumi must precede points (FK);
-- both orderings are preserved below.
--
-- Concept-level FKs intentionally not declared (system-health-audit 2026-08-26 §3):
-- aliases.bangumi_id, catalog_provenance.work_id, cluster_version.bangumi_id, and
-- itinerary_snapshots.bangumi_id all reference bangumi/points conceptually, but the
-- ingest pipeline writes these rows out of order and must tolerate transient orphans;
-- the publish layer, not a DB constraint, is responsible for eventual consistency.
-- Revisit if a real analytics/join need for enforced integrity appears.

-- Create "aliases" table
CREATE TABLE public.aliases (
  id uuid NOT NULL DEFAULT uuidv7(),
  bangumi_id text NOT NULL, -- concept-level FK to bangumi.id, not enforced; see file header
  alias text NOT NULL,
  alias_normalized text NOT NULL,
  source text NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  CONSTRAINT aliases_work_id_alias_source_key UNIQUE (bangumi_id, alias, source)
);
-- Create index "idx_aliases_normalized" to table: "aliases"
CREATE INDEX idx_aliases_normalized ON public.aliases (alias_normalized);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.aliases TO catalog_svc;
GRANT SELECT ON TABLE public.aliases TO readonly;

-- Create "catalog_provenance" table
CREATE TABLE public.catalog_provenance (
  id uuid NOT NULL DEFAULT uuidv7(),
  scope text NOT NULL,
  entity_id text NOT NULL,
  work_id text NULL, -- concept-level FK to bangumi.id, not enforced; see file header
  source text NOT NULL,
  upstream_id text NULL,
  attribution text NULL,
  license text NULL,
  field_map jsonb NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
-- Create index "idx_catalog_provenance_work" to table: "catalog_provenance"
CREATE INDEX idx_catalog_provenance_work ON public.catalog_provenance (work_id);
-- Create index "uq_catalog_provenance_scope_entity" to table: "catalog_provenance"
CREATE UNIQUE INDEX uq_catalog_provenance_scope_entity ON public.catalog_provenance (scope, entity_id);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.catalog_provenance TO catalog_svc;
GRANT SELECT ON TABLE public.catalog_provenance TO readonly;

-- Create "catalog_runs" table
CREATE TABLE public.catalog_runs (
  run_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  targets jsonb NULL,
  source_outcomes jsonb NULL,
  budget_used jsonb NULL,
  failures jsonb NULL,
  published_versions jsonb NULL,
  started_at timestamptz NULL,
  finished_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id)
);
-- Create index "idx_catalog_runs_status" to table: "catalog_runs"
CREATE INDEX idx_catalog_runs_status ON public.catalog_runs (status);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.catalog_runs TO catalog_svc;
GRANT SELECT ON TABLE public.catalog_runs TO readonly;

-- Create "cluster_version" table
CREATE TABLE public.cluster_version (
  id uuid NOT NULL DEFAULT uuidv7(),
  bangumi_id text NOT NULL, -- concept-level FK to bangumi.id, not enforced; see file header
  version integer NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT cluster_version_work_id_version_key UNIQUE (bangumi_id, version)
);
-- Create index "idx_cluster_version_current" to table: "cluster_version"
CREATE INDEX idx_cluster_version_current ON public.cluster_version (bangumi_id, is_current);
-- Create index "uq_cluster_version_one_current" to table: "cluster_version"
CREATE UNIQUE INDEX uq_cluster_version_one_current ON public.cluster_version (bangumi_id) WHERE is_current;
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.cluster_version TO catalog_svc;
GRANT SELECT ON TABLE public.cluster_version TO readonly;

-- Create "ingest_jobs" table
CREATE TABLE public.ingest_jobs (
  work_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  stage text NULL,
  error text NULL,
  error_code text NULL,
  negative_cached_until timestamptz NULL,
  started_at timestamptz NULL,
  finished_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (work_id)
);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.ingest_jobs TO catalog_svc;

-- Create "itinerary_snapshots" table
CREATE TABLE public.itinerary_snapshots (
  id uuid NOT NULL DEFAULT uuidv7(),
  bangumi_id text NOT NULL, -- concept-level FK to bangumi.id, not enforced; see file header
  cluster_version integer NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT route_snapshots_pkey PRIMARY KEY (id)
);
-- Create index "idx_itinerary_snapshots_bangumi_version" to table: "itinerary_snapshots"
CREATE INDEX idx_itinerary_snapshots_bangumi_version ON public.itinerary_snapshots (bangumi_id, cluster_version);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.itinerary_snapshots TO catalog_svc;
GRANT SELECT ON TABLE public.itinerary_snapshots TO readonly;

-- Create "leg_cache" table
CREATE TABLE public.leg_cache (
  from_cluster text NOT NULL,
  to_cluster text NOT NULL,
  mode text NOT NULL,
  duration_minutes double precision NULL,
  distance_m double precision NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (from_cluster, to_cluster, mode)
);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.leg_cache TO catalog_svc;
GRANT SELECT ON TABLE public.leg_cache TO readonly;

-- Create "locations" table
CREATE TABLE public.locations (
  id text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  location public.GEOGRAPHY(POINT,4326) NULL,
  source text NOT NULL,
  pref text NULL,
  created_at timestamptz NULL DEFAULT now(),
  updated_at timestamptz NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT locations_kind_check CHECK (kind = ANY(ARRAY['station'::text, 'city'::text, 'ward'::text, 'landmark'::text, 'prefecture'::text])),
  CONSTRAINT locations_source_check CHECK (source = ANY(ARRAY['seed'::text, 'mlit'::text, 'geonames'::text, 'manual'::text]))
);
CREATE TRIGGER trg_locations_sync_coordinates
  BEFORE INSERT OR UPDATE ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.sync_points_coordinates();
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.locations TO catalog_svc;
GRANT SELECT ON TABLE public.locations TO readonly;

-- Create "media_assets" table
CREATE TABLE public.media_assets (
  point_id text NOT NULL,
  r2_key text NULL,
  content_hash text NULL,
  last_origin_pull timestamptz NULL,
  tombstoned boolean NOT NULL DEFAULT false,
  PRIMARY KEY (point_id)
);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.media_assets TO catalog_svc;
GRANT SELECT ON TABLE public.media_assets TO readonly;

-- Create "raw_anitabi" table
CREATE TABLE public.raw_anitabi (
  work_id text NOT NULL,
  payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (work_id)
);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.raw_anitabi TO catalog_svc;
GRANT SELECT ON TABLE public.raw_anitabi TO readonly;

-- Create "raw_bangumi" table
CREATE TABLE public.raw_bangumi (
  work_id text NOT NULL,
  payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (work_id)
);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.raw_bangumi TO catalog_svc;
GRANT SELECT ON TABLE public.raw_bangumi TO readonly;

-- Create "raw_payload_history" table
CREATE TABLE public.raw_payload_history (
  seq bigserial NOT NULL,
  work_id text NOT NULL,
  source text NOT NULL,
  payload jsonb NOT NULL,
  run_id text NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (seq)
);
-- Create index "idx_raw_payload_history_work_source" to table: "raw_payload_history"
CREATE INDEX idx_raw_payload_history_work_source ON public.raw_payload_history (work_id, source, seq DESC);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.raw_payload_history TO catalog_svc;
GRANT SELECT ON TABLE public.raw_payload_history TO readonly;
GRANT SELECT, USAGE ON SEQUENCE public.raw_payload_history_seq_seq TO catalog_svc;

-- Create "series_edges" table
CREATE TABLE public.series_edges (
  from_bangumi_id text NOT NULL,
  to_bangumi_id text NOT NULL,
  relation text NOT NULL,
  PRIMARY KEY (from_bangumi_id, to_bangumi_id, relation)
);
-- Create index "idx_series_edges_to_bangumi" to table: "series_edges"
CREATE INDEX idx_series_edges_to_bangumi ON public.series_edges (to_bangumi_id);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.series_edges TO catalog_svc;
GRANT SELECT ON TABLE public.series_edges TO readonly;

-- Create "location_aliases" table
CREATE TABLE public.location_aliases (
  alias text NOT NULL,
  alias_normalized text NOT NULL,
  location_id text NOT NULL,
  lang text NULL,
  priority integer NOT NULL DEFAULT 0,
  PRIMARY KEY (alias_normalized, location_id),
  CONSTRAINT location_aliases_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations (id) ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT location_aliases_lang_check CHECK ((lang = ANY(ARRAY['ja'::text, 'zh'::text, 'en'::text])) OR (lang IS null))
);
-- Create index "idx_location_aliases_norm" to table: "location_aliases"
CREATE INDEX idx_location_aliases_norm ON public.location_aliases (alias_normalized);
-- Create index "idx_location_aliases_trgm" to table: "location_aliases"
CREATE INDEX idx_location_aliases_trgm ON public.location_aliases USING GIN (alias_normalized public.gin_trgm_ops);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.location_aliases TO catalog_svc;
GRANT SELECT ON TABLE public.location_aliases TO readonly;

-- Create "bangumi" table
CREATE TABLE public.bangumi (
  id text NOT NULL,
  title text NOT NULL,
  title_cn text NULL,
  cover_url text NULL,
  air_date text NULL,
  summary text NULL,
  eps_count integer NULL,
  rating real NULL,
  points_count integer NULL DEFAULT 0,
  primary_color text NULL,
  city text NULL,
  platform text NULL,
  created_at timestamptz NULL DEFAULT now(),
  updated_at timestamptz NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE TRIGGER trg_bangumi_updated_at
  BEFORE UPDATE ON public.bangumi
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.bangumi TO catalog_svc;
GRANT SELECT ON TABLE public.bangumi TO agent_svc, readonly;

-- Create "points" table
CREATE TABLE public.points (
  id text NOT NULL,
  bangumi_id text NULL,
  name text NOT NULL,
  name_cn text NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  location public.GEOGRAPHY(POINT,4326) NULL,
  image text NULL,
  episode integer NULL,
  time_seconds integer NULL DEFAULT 0,
  scene_desc text NULL,
  embedding public.vector(1024) NULL,
  origin text NULL,
  origin_url text NULL,
  city text NULL,
  created_at timestamptz NULL DEFAULT now(),
  updated_at timestamptz NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT points_bangumi_id_fkey FOREIGN KEY (bangumi_id) REFERENCES public.bangumi (id) ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create index "idx_points_bangumi" to table: "points"
CREATE INDEX idx_points_bangumi ON public.points (bangumi_id);
-- Create index "idx_points_embedding" to table: "points"
CREATE INDEX idx_points_embedding ON public.points USING HNSW (embedding public.vector_cosine_ops);
-- Create index "idx_points_location" to table: "points"
CREATE INDEX idx_points_location ON public.points USING GIST (location);
CREATE TRIGGER trg_points_sync_coordinates
  BEFORE INSERT OR UPDATE ON public.points
  FOR EACH ROW EXECUTE FUNCTION public.sync_points_coordinates();
CREATE TRIGGER trg_points_updated_at
  BEFORE UPDATE ON public.points
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.points TO catalog_svc;
GRANT SELECT ON TABLE public.points TO agent_svc, readonly;

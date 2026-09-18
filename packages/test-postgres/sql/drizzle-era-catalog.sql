-- The catalog schema `workers/catalog`'s Drizzle query layer still reads and writes, frozen as a
-- TEST FIXTURE when the migration authority moved to Prisma (#1636).
--
-- This is not a migration and not an authority: no checksum file, no revision ledger, no CLI, and
-- nothing applies it to a shared or live database. Two integration lanes need a database whose
-- `points.latitude` / `longitude` are plain scalars and whose `points.embedding` exists, because
-- their query code still writes that shape; the data plane the Prisma chain builds makes the
-- coordinates GENERATED and omits `embedding`. #1629–#1631 move that query layer onto Prisma and
-- delete this file with the branch that reads it.
--
-- The role block is deliberately absent: the five service roles are cluster-global and
-- `@animichi/test-postgres` creates them once for the whole container. So is `photo_offers`:
-- #1604 deleted the surface that wrote it, so no lane needs it.

-- ── 20260826000000_extensions.sql ──
-- Neon data-plane baseline (2026-08-26 hard cut): Postgres extensions shared by the
-- catalog, agent, and users schemas that follow. Extension objects have no owning
-- service role; DDL remains exclusive to the migrator.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

-- ── 20260826000002_functions.sql ──
-- Neon data-plane baseline: shared trigger functions. sync_points_coordinates()
-- and update_updated_at() have no owning service role; they run BEFORE INSERT/UPDATE
-- on tables declared in the catalog, agent, and users migrations that follow.
CREATE FUNCTION public.sync_points_coordinates() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.location IS NULL
      AND NEW.latitude IS NOT NULL
      AND NEW.longitude IS NOT NULL THEN
    NEW.location := ST_SetSRID(
      ST_MakePoint(NEW.longitude, NEW.latitude),
      4326
    )::geography;
  ELSIF NEW.location IS NOT NULL THEN
    NEW.latitude := ST_Y(NEW.location::geometry);
    NEW.longitude := ST_X(NEW.location::geometry);
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- ── 20260826000003_catalog.sql ──
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

-- ── 20260826000004_agent.sql ──
-- Neon data-plane baseline: agent bounded context (11 tables + 1 sequence).
-- agent_svc holds the write grants (SELECT/INSERT/UPDATE/DELETE, or SELECT/USAGE on the
-- sequence) on every object below; jobs_svc and readonly hold read-only grants where
-- noted per table. sessions must precede messages (FK); the ordering is preserved below.
--
-- readonly is intentionally granted on only turn_outbox_events and turn_reservations,
-- not the other 9 tables (system-health-audit 2026-08-26 §3): sessions, messages,
-- feedback, request_log, and the agent_memory* tables all carry user-generated content
-- or PII, and widening SELECT access to them needs a deliberate per-table review, not
-- a blanket grant. Revisit table-by-table if a real analytics/human-SELECT need shows up.

CREATE SEQUENCE public.agent_memory_versions
    START WITH 0
    INCREMENT BY 1
    MINVALUE 0
    NO MAXVALUE
    CACHE 1;
GRANT SELECT, USAGE ON SEQUENCE public.agent_memory_versions TO agent_svc;

-- Create "agent_memory" table
CREATE TABLE public.agent_memory (
  path text NOT NULL,
  content text NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  last_operation_id text NULL,
  PRIMARY KEY (path)
);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.agent_memory TO agent_svc;

-- Create "agent_memory_metadata" table
CREATE TABLE public.agent_memory_metadata (
  id boolean NOT NULL DEFAULT true,
  versions_initialized boolean NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT agent_memory_metadata_id_check CHECK (id)
);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.agent_memory_metadata TO agent_svc;

-- Create "agent_memory_operations" table
CREATE TABLE public.agent_memory_operations (
  id text NOT NULL,
  fingerprint text NOT NULL,
  version text NULL,
  existed boolean NOT NULL,
  completed boolean NOT NULL,
  PRIMARY KEY (id)
);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.agent_memory_operations TO agent_svc;

-- Create "anon_daily_message_count" table
CREATE TABLE public.anon_daily_message_count (
  usage_date date NOT NULL,
  anon_id text NOT NULL,
  message_count bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usage_date, anon_id)
);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.anon_daily_message_count TO agent_svc;
GRANT SELECT, DELETE ON TABLE public.anon_daily_message_count TO jobs_svc;

-- Create "daily_usage" table
CREATE TABLE public.daily_usage (
  usage_date date NOT NULL,
  scope text NOT NULL,
  requests bigint NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  cost_usd numeric(14,6) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usage_date, scope),
  CONSTRAINT daily_usage_scope_check CHECK (scope = ANY(ARRAY['anon'::text, 'user'::text, 'byok'::text]))
);
-- Create index "idx_daily_usage_scope_date" to table: "daily_usage"
CREATE INDEX idx_daily_usage_scope_date ON public.daily_usage (scope, usage_date DESC);
GRANT SELECT, INSERT, UPDATE ON TABLE public.daily_usage TO agent_svc;

-- Create "feedback" table
CREATE TABLE public.feedback (
  id uuid NOT NULL DEFAULT uuidv7(),
  session_id text NULL,
  query_text text NOT NULL,
  intent text NULL,
  rating text NOT NULL,
  comment text NULL,
  created_at timestamptz NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT feedback_rating_check CHECK (rating = ANY(ARRAY['good'::text, 'bad'::text]))
);
-- Create index "idx_feedback_created" to table: "feedback"
CREATE INDEX idx_feedback_created ON public.feedback (created_at DESC);
-- Create index "idx_feedback_intent" to table: "feedback"
CREATE INDEX idx_feedback_intent ON public.feedback (intent);
-- Create index "idx_feedback_rating" to table: "feedback"
CREATE INDEX idx_feedback_rating ON public.feedback (rating);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.feedback TO agent_svc;

-- Create "request_log" table
CREATE TABLE public.request_log (
  id uuid NOT NULL DEFAULT uuidv7(),
  created_at timestamptz NOT NULL DEFAULT now(),
  session_id text NULL,
  query_text text NOT NULL,
  locale text NOT NULL DEFAULT 'ja',
  plan_steps jsonb NULL,
  intent text NULL,
  status text NULL,
  latency_ms integer NULL,
  plan_quality_score real NULL,
  PRIMARY KEY (id)
);
-- Create index "idx_request_log_created" to table: "request_log"
CREATE INDEX idx_request_log_created ON public.request_log (created_at DESC);
-- Create index "idx_request_log_intent" to table: "request_log"
CREATE INDEX idx_request_log_intent ON public.request_log (intent);
-- Create index "idx_request_log_locale" to table: "request_log"
CREATE INDEX idx_request_log_locale ON public.request_log (locale);
-- Create index "idx_request_log_unscored" to table: "request_log"
CREATE INDEX idx_request_log_unscored ON public.request_log (id) WHERE (plan_quality_score IS null);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.request_log TO agent_svc;

-- Create "turn_outbox_events" table
CREATE TABLE public.turn_outbox_events (
  id uuid NOT NULL DEFAULT uuidv7(),
  session_id text NULL,
  turn_key text NOT NULL,
  kind text NOT NULL,
  payload jsonb NULL,
  attempts integer NOT NULL DEFAULT 0,
  delivered_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT turn_outbox_events_turn_kind UNIQUE (turn_key, kind),
  CONSTRAINT turn_outbox_events_kind_check CHECK (kind = ANY(ARRAY['usage'::text, 'quota'::text, 'audit'::text]))
);
-- Create index "idx_turn_outbox_undelivered" to table: "turn_outbox_events"
CREATE INDEX idx_turn_outbox_undelivered ON public.turn_outbox_events (created_at) WHERE (delivered_at IS null);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.turn_outbox_events TO agent_svc;
GRANT SELECT ON TABLE public.turn_outbox_events TO readonly;

-- Create "turn_reservations" table
CREATE TABLE public.turn_reservations (
  id uuid NOT NULL DEFAULT uuidv7(),
  session_id text NULL,
  turn_key text NOT NULL,
  payer text NOT NULL,
  identity_id text NULL,
  revision integer NOT NULL,
  digest text NULL,
  status text NOT NULL DEFAULT 'reserved',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text NOT NULL DEFAULT '',
  lease_expires_at timestamptz NOT NULL DEFAULT now(),
  request_digest text NULL,
  outcome_payload jsonb NULL,
  PRIMARY KEY (id),
  CONSTRAINT turn_reservations_session_revision UNIQUE (session_id, revision),
  CONSTRAINT turn_reservations_session_turn_key UNIQUE (session_id, turn_key),
  CONSTRAINT turn_reservations_payer_check CHECK (payer = ANY(ARRAY['anon'::text, 'user'::text, 'byok'::text])),
  CONSTRAINT turn_reservations_status_check CHECK (status = ANY(ARRAY['reserved'::text, 'running'::text, 'completed'::text, 'failed'::text]))
);
-- Create index "idx_turn_reservations_session_revision" to table: "turn_reservations"
CREATE INDEX idx_turn_reservations_session_revision ON public.turn_reservations (session_id, revision DESC);
-- Create index "idx_turn_reservations_sweep" to table: "turn_reservations"
CREATE INDEX idx_turn_reservations_sweep ON public.turn_reservations (status, lease_expires_at) WHERE (status = ANY(ARRAY['reserved'::text, 'running'::text]));
-- Create index "turn_reservations_null_session_key" to table: "turn_reservations"
CREATE UNIQUE INDEX turn_reservations_null_session_key ON public.turn_reservations (turn_key) WHERE (session_id IS null);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.turn_reservations TO agent_svc;
GRANT SELECT ON TABLE public.turn_reservations TO readonly;

-- Create "sessions" table
CREATE TABLE public.sessions (
  id text NOT NULL,
  user_id text NULL,
  title text NULL,
  first_query text NULL,
  state jsonb NOT NULL DEFAULT '{}',
  metadata jsonb NULL DEFAULT '{}',
  lifecycle text NULL DEFAULT 'active',
  created_at timestamptz NULL DEFAULT now(),
  updated_at timestamptz NULL DEFAULT now(),
  expires_at timestamptz NULL,
  PRIMARY KEY (id)
);
-- Create index "idx_sessions_lifecycle" to table: "sessions"
CREATE INDEX idx_sessions_lifecycle ON public.sessions (lifecycle);
-- Create index "idx_sessions_user" to table: "sessions"
CREATE INDEX idx_sessions_user ON public.sessions (user_id);
-- Create index "idx_sessions_user_updated" to table: "sessions"
CREATE INDEX idx_sessions_user_updated ON public.sessions (user_id, updated_at DESC);
CREATE TRIGGER trg_sessions_updated_at
  BEFORE UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.sessions TO agent_svc;
GRANT SELECT, DELETE ON TABLE public.sessions TO jobs_svc;

-- Create "messages" table
CREATE TABLE public.messages (
  id uuid NOT NULL DEFAULT uuidv7(),
  session_id text NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  response_data jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions (id) ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT messages_role_check CHECK (role = ANY(ARRAY['user'::text, 'assistant'::text]))
);
-- Create index "idx_messages_session_created" to table: "messages"
CREATE INDEX idx_messages_session_created ON public.messages (session_id, created_at);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.messages TO agent_svc;

-- ── 20260826000005_users.sql ──
-- Neon data-plane baseline: users bounded context (3 tables).
-- users_svc holds the write grants (SELECT/INSERT/UPDATE/DELETE) on every table below;
-- agent_svc, jobs_svc, and readonly hold read-only SELECT grants where noted per table.
-- saved_route_anime carries the sole cross-context foreign key (bangumi_id ->
-- catalog.bangumi), so this file must be applied after 20260826000003_catalog.sql.
-- saved_routes must precede saved_route_anime (FK); the ordering is preserved below.

-- Create "saved_route_idempotency" table
CREATE TABLE public.saved_route_idempotency (
  owner_user_id text NOT NULL,
  op text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  state text NOT NULL DEFAULT 'in_progress',
  result jsonb NULL,
  result_id uuid NULL,
  created_at timestamptz NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (owner_user_id, op, key),
  CONSTRAINT sr_idem_state_check CHECK (state = ANY(ARRAY['in_progress'::text, 'committed'::text]))
);
-- Create index "idx_saved_route_idempotency_expires" to table: "saved_route_idempotency"
CREATE INDEX idx_saved_route_idempotency_expires ON public.saved_route_idempotency (expires_at);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.saved_route_idempotency TO users_svc;
GRANT SELECT ON TABLE public.saved_route_idempotency TO readonly;

-- Create "saved_routes" table
CREATE TABLE public.saved_routes (
  id uuid NOT NULL DEFAULT uuidv7(),
  point_ids text[] NOT NULL,
  created_at timestamptz NULL DEFAULT now(),
  user_id text NULL,
  title text NULL,
  status text NOT NULL DEFAULT 'draft',
  saved_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT routes_pkey PRIMARY KEY (id),
  CONSTRAINT routes_status_check CHECK (status = ANY(ARRAY['draft'::text, 'saved'::text, 'completed'::text]))
);
-- Create index "idx_saved_routes_user" to table: "saved_routes"
CREATE INDEX idx_saved_routes_user ON public.saved_routes (user_id);
CREATE TRIGGER trg_routes_updated_at
  BEFORE UPDATE ON public.saved_routes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
GRANT SELECT ON TABLE public.saved_routes TO agent_svc, jobs_svc, readonly;
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.saved_routes TO users_svc;

-- Create "saved_route_anime" table
CREATE TABLE public.saved_route_anime (
  saved_route_id uuid NOT NULL,
  bangumi_id text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  CONSTRAINT route_anime_pkey PRIMARY KEY (saved_route_id, bangumi_id),
  CONSTRAINT route_anime_route_id_position_key UNIQUE (saved_route_id, position),
  CONSTRAINT route_anime_bangumi_id_fkey FOREIGN KEY (bangumi_id) REFERENCES public.bangumi (id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT route_anime_route_id_fkey FOREIGN KEY (saved_route_id) REFERENCES public.saved_routes (id) ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create index "idx_saved_route_anime_bangumi" to table: "saved_route_anime"
CREATE INDEX idx_saved_route_anime_bangumi ON public.saved_route_anime (bangumi_id);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.saved_route_anime TO users_svc;
GRANT SELECT ON TABLE public.saved_route_anime TO readonly;

-- ── 20260829000000_fix_coordinate_sync_precedence.sql ──
-- #1217 follow-up: the baseline's geography branch rewrites the scalars
-- unconditionally, which fixed the geography-only update but silently
-- REVERTS a scalar-only update on a row whose location is already set —
-- the BEFORE trigger sees the old (non-null) NEW.location and overwrites
-- the just-written latitude/longitude from it. Both representations are
-- kept in sync in both directions from here on.
--
-- Precedence rule (explicit, per statement):
--   1. A NULL location is never terminal — it is rebuilt from the scalar
--      pair, which is NOT NULL on both tables.
--   2. A geography write wins: scalars are rewritten from the new point.
--   3. A scalar-only write wins: the geography moves to the new scalars.
--   4. When one statement writes both, rule 2 applies — geography is
--      canonical because idx_points_location serves spatial search from it.
-- A write that touches neither representation (e.g. updated_at-only) does
-- no ST_* work at all.

CREATE OR REPLACE FUNCTION public.sync_points_coordinates() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  scalars_changed boolean := TRUE;
  location_changed boolean := TRUE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    scalars_changed := NEW.latitude IS DISTINCT FROM OLD.latitude
                    OR NEW.longitude IS DISTINCT FROM OLD.longitude;
    location_changed := NEW.location IS DISTINCT FROM OLD.location;
  END IF;

  IF NEW.location IS NULL THEN
    NEW.location := ST_SetSRID(
      ST_MakePoint(NEW.longitude, NEW.latitude),
      4326
    )::geography;
  ELSIF location_changed THEN
    NEW.latitude := ST_Y(NEW.location::geometry);
    NEW.longitude := ST_X(NEW.location::geometry);
  ELSIF scalars_changed THEN
    NEW.location := ST_SetSRID(
      ST_MakePoint(NEW.longitude, NEW.latitude),
      4326
    )::geography;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 20260902000000_agent_runs.sql ──
-- Agent turn runs (W1-1, issue #1250): the durable per-turn record the intake writes,
-- the AgentSession Durable Object settles, and the singleton RunSweeper DO scans.
-- One row per agent turn, plus one row per tool step so an alarm retry replays what
-- already happened instead of re-running it (spec 2026-09-01 §三).
--
-- Ownership: agent bounded context. agent_svc holds the write grants. readonly gets
-- SELECT on runs for the same reason it has it on turn_reservations and
-- turn_outbox_events (see the header of 20260826000004_agent.sql): a run row carries
-- ids, a status, counters and timestamps -- no user-generated content and no PII.
-- run_steps is deliberately NOT granted to readonly: a tool's input and result carry
-- the visitor's own query text. No DELETE grant on either: rows are retained with
-- their session and disappear through the FK cascade, which runs under the
-- constraint's own privileges, not the deleter's.
--
-- Purely additive against the deployed consumers one version back (US25/#1052):
-- two new tables plus one nullable column and one PARTIAL unique index on messages.
-- The Python agent still deployed one version back neither reads nor writes any of
-- it, and rows it writes leave client_message_id NULL, which the partial index ignores.

-- The client-supplied id of the user message that opened one turn. It is the intake
-- dedupe key: a replayed POST /v1/chat must find the existing message instead of
-- appending a second one. Nullable because every message written before this
-- migration has none, so the uniqueness is a PARTIAL index over the non-null values
-- -- it states "at most one message per (session, client id)" directly instead of
-- leaning on the NULLS DISTINCT default to excuse the legacy rows.
-- `atlas migrate lint` reports MF101 (a unique index may fail on existing
-- duplicates) here; it does not read the WHERE predicate. Every row that exists
-- when this runs has client_message_id NULL, so the indexed set is empty.
ALTER TABLE public.messages ADD COLUMN client_message_id text NULL;
-- Create index "messages_session_client_message_id" to table: "messages"
CREATE UNIQUE INDEX messages_session_client_message_id ON public.messages (session_id, client_message_id) WHERE (client_message_id IS NOT null);

-- Create "runs" table
CREATE TABLE public.runs (
  id uuid NOT NULL DEFAULT uuidv7(),
  session_id text NOT NULL,
  message_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'running',
  failure_reason text NULL,
  lease_owner text NULL,
  lease_expires_at timestamptz NULL,
  deadline_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  payer text NOT NULL,
  quota_identity_id text NULL,
  quota_usage_date date NULL,
  quota_refunded_at timestamptz NULL,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  cost_usd numeric(14,6) NOT NULL DEFAULT 0,
  usage_settled_at timestamptz NULL,
  PRIMARY KEY (id),
  CONSTRAINT runs_message_id_key UNIQUE (message_id),
  CONSTRAINT runs_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions (id) ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT runs_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages (id) ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT runs_status_check CHECK (status = ANY(ARRAY['running'::text, 'succeeded'::text, 'failed'::text])),
  CONSTRAINT runs_payer_check CHECK (payer = ANY(ARRAY['anon'::text, 'user'::text, 'byok'::text])),
  CONSTRAINT runs_failure_reason_check CHECK (failure_reason IS null OR failure_reason = ANY(ARRAY['lease_expired'::text, 'deadline_exceeded'::text, 'provider_failed'::text, 'tool_failed'::text, 'cancelled'::text, 'internal_error'::text])),
  CONSTRAINT runs_failed_has_reason_check CHECK ((status = 'failed') = (failure_reason IS NOT null)),
  CONSTRAINT runs_terminal_is_finished_check CHECK ((status = 'running') = (finished_at IS null)),
  CONSTRAINT runs_lease_held_check CHECK ((lease_owner IS null) = (lease_expires_at IS null)),
  CONSTRAINT runs_lease_within_deadline_check CHECK (lease_expires_at <= deadline_at),
  CONSTRAINT runs_quota_reservation_check CHECK ((quota_identity_id IS null) = (quota_usage_date IS null)),
  CONSTRAINT runs_quota_refund_check CHECK (quota_refunded_at IS null OR quota_identity_id IS NOT null)
);
-- Create index "idx_runs_session_started" to table: "runs"
CREATE INDEX idx_runs_session_started ON public.runs (session_id, started_at DESC);
-- The whole RunSweeper scan, in one partial index over the only rows it cares about.
-- A lease is a (owner, expiry) pair or neither (runs_lease_held_check), so a run the
-- intake committed but never armed with setAlarm has lease_expires_at NULL and sorts
-- last in this index -- the sweeper's `lease_expires_at IS NULL OR lease_expires_at <
-- now()` reads both cases from here. runs_lease_within_deadline_check caps every
-- renewal at deadline_at, so a live-but-wedged writer cannot renew its way out of the
-- scan either. Column order mirrors idx_turn_reservations_sweep.
-- Create index "idx_runs_sweep" to table: "runs"
CREATE INDEX idx_runs_sweep ON public.runs (status, lease_expires_at) WHERE (status = 'running');
-- Admission: one session runs at most one turn at a time, so the intake's INSERT
-- is the whole busy-session decision -- a second concurrent turn loses on this
-- index rather than on a read-then-write race. That is the single-winner property
-- turn_reservations got from turn_reservations_session_revision; it is partial on
-- `running` so a session's settled turns never collide with the next one.
-- Create index "runs_one_running_per_session" to table: "runs"
CREATE UNIQUE INDEX runs_one_running_per_session ON public.runs (session_id) WHERE (status = 'running');
GRANT SELECT, INSERT, UPDATE ON TABLE public.runs TO agent_svc;
GRANT SELECT ON TABLE public.runs TO readonly;

-- One row per tool step of one run. The loop persists a step's result BEFORE it
-- continues, so an alarm that reruns the same run after an eviction replays every
-- step that already has a result instead of calling the tool again (spec §三 "工具
-- 步骤幂等"). (run_id, step_index) is therefore both the primary key and the
-- idempotency key a side-effecting tool must accept; result and finished_at appear
-- together, which is exactly the "already done" predicate the replay reads.
-- Create "run_steps" table
CREATE TABLE public.run_steps (
  run_id uuid NOT NULL,
  step_index integer NOT NULL,
  tool_name text NOT NULL,
  input jsonb NOT NULL,
  result jsonb NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  PRIMARY KEY (run_id, step_index),
  CONSTRAINT run_steps_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.runs (id) ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT run_steps_step_index_check CHECK (step_index >= 0),
  CONSTRAINT run_steps_settled_check CHECK ((result IS null) = (finished_at IS null))
);
GRANT SELECT, INSERT, UPDATE ON TABLE public.run_steps TO agent_svc;

-- ── 20260904000000_platform_usage_scope.sql ──
-- The platform usage scope (W2 follow-up, issue #1292): a fourth value for
-- daily_usage.scope, for the tokens the PLATFORM paid inside a turn somebody
-- else paid for.
--
-- Where that spend comes from. A caller-keyed (BYOK) turn still translates
-- anime titles on the SERVER's key: Python's D18
-- (interfaces/public_api.py::_server_title_translator) forces
-- translate_anime_title off the caller's credential so the tool cannot inherit
-- it, and the TypeScript tier wires the same rule (#1289,
-- workers/edge/src/agent/session/session-turn.ts::translationModel). Those
-- tokens are ours, not the caller's -- and runs.payer = 'byok' prices the whole
-- run at zero, so without a scope of their own they would be metered at zero
-- and vanish from the meter entirely.
--
-- runs_payer_check is deliberately NOT widened. runs.payer is who pays for one
-- TURN, and no turn is ever opened on the platform's behalf: the intake
-- classifies a turn 'anon', 'user' or 'byok' and nothing else writes that
-- column, so admitting a fourth payer would admit a value no writer can
-- produce. The two vocabularies therefore stop being identical here: every
-- payer is a usage scope, and 'platform' is a scope no payer has.
--
-- This scope is where the TypeScript tier deliberately DIVERGES from Python
-- rather than porting it, so read the Python names carefully. Python's
-- "platform" is a two-valued PAYER label that selects the PRICE --
-- AttributedUsage(usage, "platform") (public_api.py:946) reaches
-- `prices = platform_prices if item.payer == "platform" else UsagePrices(0, 0)`
-- (public_api.py:1118, outbox_dispatch.py:87-90) -- while the SCOPE it writes
-- is always re-derived from the identity by scope_for_identity
-- (application/identity.py:27), whose UsageScope has the same three values as
-- runs.payer and no fourth. Python therefore folded the BYOK turn's
-- translation into the CALLER's own 'anon'/'user' day row at platform price.
-- This tier cannot: it reads the scope off runs.payer rather than an identity
-- it would have to be handed, and 'byok' is priced at zero, so the same fold
-- would either meter our own spend at nothing or report it as the caller's.
--
-- Purely additive against the deployed consumers one version back (US25/#1052).
-- Widening a CHECK admits every row the old one admitted, so writers one
-- version back keep committing and readers one version back keep reading; and
-- nothing writes 'platform' until the edge carrying this settlement is
-- deployed, which is the migration-before-consumer order CD already enforces.
-- Modify "daily_usage" table
ALTER TABLE public.daily_usage DROP CONSTRAINT daily_usage_scope_check;
ALTER TABLE public.daily_usage ADD CONSTRAINT daily_usage_scope_check CHECK (scope = ANY(ARRAY['anon'::text, 'user'::text, 'byok'::text, 'platform'::text]));

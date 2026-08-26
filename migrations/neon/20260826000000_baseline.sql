-- Canonical Neon data-plane baseline (2026-08-26 hard cut).
-- Apply only to an empty public schema. Staging is backed up and reset by CD;
-- production remains behind its manual environment approval.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog_svc') THEN
    CREATE ROLE catalog_svc NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_svc') THEN
    CREATE ROLE agent_svc NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'users_svc') THEN
    CREATE ROLE users_svc NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jobs_svc') THEN
    CREATE ROLE jobs_svc NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly') THEN
    CREATE ROLE readonly NOLOGIN;
  END IF;
END $$;

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
    NEW.latitude := COALESCE(NEW.latitude, ST_Y(NEW.location::geometry));
    NEW.longitude := COALESCE(NEW.longitude, ST_X(NEW.location::geometry));
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

CREATE SEQUENCE public.agent_memory_versions
    START WITH 0
    INCREMENT BY 1
    MINVALUE 0
    NO MAXVALUE
    CACHE 1;

-- Create "agent_memory" table
CREATE TABLE "public"."agent_memory" (
  "path" text NOT NULL,
  "content" text NOT NULL,
  "version" bigint NOT NULL DEFAULT 1,
  "last_operation_id" text NULL,
  PRIMARY KEY ("path")
);
-- Create "agent_memory_metadata" table
CREATE TABLE "public"."agent_memory_metadata" (
  "id" boolean NOT NULL DEFAULT true,
  "versions_initialized" boolean NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "agent_memory_metadata_id_check" CHECK (id)
);
-- Create "agent_memory_operations" table
CREATE TABLE "public"."agent_memory_operations" (
  "id" text NOT NULL,
  "fingerprint" text NOT NULL,
  "version" text NULL,
  "existed" boolean NOT NULL,
  "completed" boolean NOT NULL,
  PRIMARY KEY ("id")
);
-- Create "aliases" table
CREATE TABLE "public"."aliases" (
  "id" uuid NOT NULL DEFAULT uuidv7(),
  "bangumi_id" text NOT NULL,
  "alias" text NOT NULL,
  "alias_normalized" text NOT NULL,
  "source" text NOT NULL,
  "priority" integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("id"),
  CONSTRAINT "aliases_work_id_alias_source_key" UNIQUE ("bangumi_id", "alias", "source")
);
-- Create index "idx_aliases_normalized" to table: "aliases"
CREATE INDEX "idx_aliases_normalized" ON "public"."aliases" ("alias_normalized");
-- Create "anon_daily_message_count" table
CREATE TABLE "public"."anon_daily_message_count" (
  "usage_date" date NOT NULL,
  "anon_id" text NOT NULL,
  "message_count" bigint NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("usage_date", "anon_id")
);
-- Create "catalog_provenance" table
CREATE TABLE "public"."catalog_provenance" (
  "id" uuid NOT NULL DEFAULT uuidv7(),
  "scope" text NOT NULL,
  "entity_id" text NOT NULL,
  "work_id" text NULL,
  "source" text NOT NULL,
  "upstream_id" text NULL,
  "attribution" text NULL,
  "license" text NULL,
  "field_map" jsonb NULL,
  "captured_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
-- Create index "idx_catalog_provenance_work" to table: "catalog_provenance"
CREATE INDEX "idx_catalog_provenance_work" ON "public"."catalog_provenance" ("work_id");
-- Create index "uq_catalog_provenance_scope_entity" to table: "catalog_provenance"
CREATE UNIQUE INDEX "uq_catalog_provenance_scope_entity" ON "public"."catalog_provenance" ("scope", "entity_id");
-- Create "catalog_runs" table
CREATE TABLE "public"."catalog_runs" (
  "run_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "targets" jsonb NULL,
  "source_outcomes" jsonb NULL,
  "budget_used" jsonb NULL,
  "failures" jsonb NULL,
  "published_versions" jsonb NULL,
  "started_at" timestamptz NULL,
  "finished_at" timestamptz NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("run_id")
);
-- Create index "idx_catalog_runs_status" to table: "catalog_runs"
CREATE INDEX "idx_catalog_runs_status" ON "public"."catalog_runs" ("status");
-- Create "cluster_version" table
CREATE TABLE "public"."cluster_version" (
  "id" uuid NOT NULL DEFAULT uuidv7(),
  "bangumi_id" text NOT NULL,
  "version" integer NOT NULL,
  "is_current" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "cluster_version_work_id_version_key" UNIQUE ("bangumi_id", "version")
);
-- Create index "idx_cluster_version_current" to table: "cluster_version"
CREATE INDEX "idx_cluster_version_current" ON "public"."cluster_version" ("bangumi_id", "is_current");
-- Create index "uq_cluster_version_one_current" to table: "cluster_version"
CREATE UNIQUE INDEX "uq_cluster_version_one_current" ON "public"."cluster_version" ("bangumi_id") WHERE is_current;
-- Create "daily_usage" table
CREATE TABLE "public"."daily_usage" (
  "usage_date" date NOT NULL,
  "scope" text NOT NULL,
  "requests" bigint NOT NULL DEFAULT 0,
  "input_tokens" bigint NOT NULL DEFAULT 0,
  "output_tokens" bigint NOT NULL DEFAULT 0,
  "cost_usd" numeric(14,6) NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("usage_date", "scope"),
  CONSTRAINT "daily_usage_scope_check" CHECK (scope = ANY (ARRAY['anon'::text, 'user'::text, 'byok'::text]))
);
-- Create index "idx_daily_usage_scope_date" to table: "daily_usage"
CREATE INDEX "idx_daily_usage_scope_date" ON "public"."daily_usage" ("scope", "usage_date" DESC);
-- Create "feedback" table
CREATE TABLE "public"."feedback" (
  "id" uuid NOT NULL DEFAULT uuidv7(),
  "session_id" text NULL,
  "query_text" text NOT NULL,
  "intent" text NULL,
  "rating" text NOT NULL,
  "comment" text NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "feedback_rating_check" CHECK (rating = ANY (ARRAY['good'::text, 'bad'::text]))
);
-- Create index "idx_feedback_created" to table: "feedback"
CREATE INDEX "idx_feedback_created" ON "public"."feedback" ("created_at" DESC);
-- Create index "idx_feedback_intent" to table: "feedback"
CREATE INDEX "idx_feedback_intent" ON "public"."feedback" ("intent");
-- Create index "idx_feedback_rating" to table: "feedback"
CREATE INDEX "idx_feedback_rating" ON "public"."feedback" ("rating");
-- Create "ingest_jobs" table
CREATE TABLE "public"."ingest_jobs" (
  "work_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "stage" text NULL,
  "error" text NULL,
  "error_code" text NULL,
  "negative_cached_until" timestamptz NULL,
  "started_at" timestamptz NULL,
  "finished_at" timestamptz NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("work_id")
);
-- Create "itinerary_snapshots" table
CREATE TABLE "public"."itinerary_snapshots" (
  "id" uuid NOT NULL DEFAULT uuidv7(),
  "bangumi_id" text NOT NULL,
  "cluster_version" integer NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "route_snapshots_pkey" PRIMARY KEY ("id")
);
-- Create index "idx_itinerary_snapshots_bangumi_version" to table: "itinerary_snapshots"
CREATE INDEX "idx_itinerary_snapshots_bangumi_version" ON "public"."itinerary_snapshots" ("bangumi_id", "cluster_version");
-- Create "leg_cache" table
CREATE TABLE "public"."leg_cache" (
  "from_cluster" text NOT NULL,
  "to_cluster" text NOT NULL,
  "mode" text NOT NULL,
  "duration_minutes" double precision NULL,
  "distance_m" double precision NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("from_cluster", "to_cluster", "mode")
);
-- Create "locations" table
CREATE TABLE "public"."locations" (
  "id" text NOT NULL,
  "name" text NOT NULL,
  "kind" text NOT NULL,
  "latitude" double precision NOT NULL,
  "longitude" double precision NOT NULL,
  "location" public.geography(Point,4326) NULL,
  "source" text NOT NULL,
  "pref" text NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "locations_kind_check" CHECK (kind = ANY (ARRAY['station'::text, 'city'::text, 'ward'::text, 'landmark'::text, 'prefecture'::text])),
  CONSTRAINT "locations_source_check" CHECK (source = ANY (ARRAY['seed'::text, 'mlit'::text, 'geonames'::text, 'manual'::text]))
);
-- Create "media_assets" table
CREATE TABLE "public"."media_assets" (
  "point_id" text NOT NULL,
  "r2_key" text NULL,
  "content_hash" text NULL,
  "last_origin_pull" timestamptz NULL,
  "tombstoned" boolean NOT NULL DEFAULT false,
  PRIMARY KEY ("point_id")
);
-- Create "raw_anitabi" table
CREATE TABLE "public"."raw_anitabi" (
  "work_id" text NOT NULL,
  "payload" jsonb NOT NULL,
  "fetched_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("work_id")
);
-- Create "raw_bangumi" table
CREATE TABLE "public"."raw_bangumi" (
  "work_id" text NOT NULL,
  "payload" jsonb NOT NULL,
  "fetched_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("work_id")
);
-- Create "raw_payload_history" table
CREATE TABLE "public"."raw_payload_history" (
  "seq" bigserial NOT NULL,
  "work_id" text NOT NULL,
  "source" text NOT NULL,
  "payload" jsonb NOT NULL,
  "run_id" text NULL,
  "fetched_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("seq")
);
-- Create index "idx_raw_payload_history_work_source" to table: "raw_payload_history"
CREATE INDEX "idx_raw_payload_history_work_source" ON "public"."raw_payload_history" ("work_id", "source", "seq" DESC);
-- Create "request_log" table
CREATE TABLE "public"."request_log" (
  "id" uuid NOT NULL DEFAULT uuidv7(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "session_id" text NULL,
  "query_text" text NOT NULL,
  "locale" text NOT NULL DEFAULT 'ja',
  "plan_steps" jsonb NULL,
  "intent" text NULL,
  "status" text NULL,
  "latency_ms" integer NULL,
  "plan_quality_score" real NULL,
  PRIMARY KEY ("id")
);
-- Create index "idx_request_log_created" to table: "request_log"
CREATE INDEX "idx_request_log_created" ON "public"."request_log" ("created_at" DESC);
-- Create index "idx_request_log_intent" to table: "request_log"
CREATE INDEX "idx_request_log_intent" ON "public"."request_log" ("intent");
-- Create index "idx_request_log_locale" to table: "request_log"
CREATE INDEX "idx_request_log_locale" ON "public"."request_log" ("locale");
-- Create index "idx_request_log_unscored" to table: "request_log"
CREATE INDEX "idx_request_log_unscored" ON "public"."request_log" ("id") WHERE (plan_quality_score IS NULL);
-- Create "saved_route_idempotency" table
CREATE TABLE "public"."saved_route_idempotency" (
  "owner_user_id" text NOT NULL,
  "op" text NOT NULL,
  "key" text NOT NULL,
  "fingerprint" text NOT NULL,
  "state" text NOT NULL DEFAULT 'in_progress',
  "result" jsonb NULL,
  "result_id" uuid NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  PRIMARY KEY ("owner_user_id", "op", "key"),
  CONSTRAINT "sr_idem_state_check" CHECK (state = ANY (ARRAY['in_progress'::text, 'committed'::text]))
);
-- Create index "idx_saved_route_idempotency_expires" to table: "saved_route_idempotency"
CREATE INDEX "idx_saved_route_idempotency_expires" ON "public"."saved_route_idempotency" ("expires_at");
-- Create "series_edges" table
CREATE TABLE "public"."series_edges" (
  "from_bangumi_id" text NOT NULL,
  "to_bangumi_id" text NOT NULL,
  "relation" text NOT NULL,
  PRIMARY KEY ("from_bangumi_id", "to_bangumi_id", "relation")
);
-- Create index "idx_series_edges_to_bangumi" to table: "series_edges"
CREATE INDEX "idx_series_edges_to_bangumi" ON "public"."series_edges" ("to_bangumi_id");
-- Create "turn_outbox_events" table
CREATE TABLE "public"."turn_outbox_events" (
  "id" uuid NOT NULL DEFAULT uuidv7(),
  "session_id" text NULL,
  "turn_key" text NOT NULL,
  "kind" text NOT NULL,
  "payload" jsonb NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "delivered_at" timestamptz NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "turn_outbox_events_turn_kind" UNIQUE ("turn_key", "kind"),
  CONSTRAINT "turn_outbox_events_kind_check" CHECK (kind = ANY (ARRAY['usage'::text, 'quota'::text, 'audit'::text]))
);
-- Create index "idx_turn_outbox_undelivered" to table: "turn_outbox_events"
CREATE INDEX "idx_turn_outbox_undelivered" ON "public"."turn_outbox_events" ("created_at") WHERE (delivered_at IS NULL);
-- Create "turn_reservations" table
CREATE TABLE "public"."turn_reservations" (
  "id" uuid NOT NULL DEFAULT uuidv7(),
  "session_id" text NULL,
  "turn_key" text NOT NULL,
  "payer" text NOT NULL,
  "identity_id" text NULL,
  "revision" integer NOT NULL,
  "digest" text NULL,
  "status" text NOT NULL DEFAULT 'reserved',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "lease_owner" text NOT NULL DEFAULT '',
  "lease_expires_at" timestamptz NOT NULL DEFAULT now(),
  "request_digest" text NULL,
  "outcome_payload" jsonb NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "turn_reservations_session_revision" UNIQUE ("session_id", "revision"),
  CONSTRAINT "turn_reservations_session_turn_key" UNIQUE ("session_id", "turn_key"),
  CONSTRAINT "turn_reservations_payer_check" CHECK (payer = ANY (ARRAY['anon'::text, 'user'::text, 'byok'::text])),
  CONSTRAINT "turn_reservations_status_check" CHECK (status = ANY (ARRAY['reserved'::text, 'running'::text, 'completed'::text, 'failed'::text]))
);
-- Create index "idx_turn_reservations_session_revision" to table: "turn_reservations"
CREATE INDEX "idx_turn_reservations_session_revision" ON "public"."turn_reservations" ("session_id", "revision" DESC);
-- Create index "idx_turn_reservations_sweep" to table: "turn_reservations"
CREATE INDEX "idx_turn_reservations_sweep" ON "public"."turn_reservations" ("status", "lease_expires_at") WHERE (status = ANY (ARRAY['reserved'::text, 'running'::text]));
-- Create index "turn_reservations_null_session_key" to table: "turn_reservations"
CREATE UNIQUE INDEX "turn_reservations_null_session_key" ON "public"."turn_reservations" ("turn_key") WHERE (session_id IS NULL);
-- Create "location_aliases" table
CREATE TABLE "public"."location_aliases" (
  "alias" text NOT NULL,
  "alias_normalized" text NOT NULL,
  "location_id" text NOT NULL,
  "lang" text NULL,
  "priority" integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("alias_normalized", "location_id"),
  CONSTRAINT "location_aliases_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "location_aliases_lang_check" CHECK ((lang = ANY (ARRAY['ja'::text, 'zh'::text, 'en'::text])) OR (lang IS NULL))
);
-- Create index "idx_location_aliases_norm" to table: "location_aliases"
CREATE INDEX "idx_location_aliases_norm" ON "public"."location_aliases" ("alias_normalized");
-- Create index "idx_location_aliases_trgm" to table: "location_aliases"
CREATE INDEX "idx_location_aliases_trgm" ON "public"."location_aliases" USING GIN ("alias_normalized" public.gin_trgm_ops);
-- Create "sessions" table
CREATE TABLE "public"."sessions" (
  "id" text NOT NULL,
  "user_id" text NULL,
  "title" text NULL,
  "first_query" text NULL,
  "state" jsonb NOT NULL DEFAULT '{}',
  "metadata" jsonb NULL DEFAULT '{}',
  "lifecycle" text NULL DEFAULT 'active',
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  "expires_at" timestamptz NULL,
  PRIMARY KEY ("id")
);
-- Create index "idx_sessions_lifecycle" to table: "sessions"
CREATE INDEX "idx_sessions_lifecycle" ON "public"."sessions" ("lifecycle");
-- Create index "idx_sessions_user" to table: "sessions"
CREATE INDEX "idx_sessions_user" ON "public"."sessions" ("user_id");
-- Create index "idx_sessions_user_updated" to table: "sessions"
CREATE INDEX "idx_sessions_user_updated" ON "public"."sessions" ("user_id", "updated_at" DESC);
-- Create "messages" table
CREATE TABLE "public"."messages" (
  "id" uuid NOT NULL DEFAULT uuidv7(),
  "session_id" text NOT NULL,
  "role" text NOT NULL,
  "content" text NOT NULL,
  "response_data" jsonb NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "messages_role_check" CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text]))
);
-- Create index "idx_messages_session_created" to table: "messages"
CREATE INDEX "idx_messages_session_created" ON "public"."messages" ("session_id", "created_at");
-- Create "bangumi" table
CREATE TABLE "public"."bangumi" (
  "id" text NOT NULL,
  "title" text NOT NULL,
  "title_cn" text NULL,
  "cover_url" text NULL,
  "air_date" text NULL,
  "summary" text NULL,
  "eps_count" integer NULL,
  "rating" real NULL,
  "points_count" integer NULL DEFAULT 0,
  "primary_color" text NULL,
  "city" text NULL,
  "platform" text NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
-- Create "points" table
CREATE TABLE "public"."points" (
  "id" text NOT NULL,
  "bangumi_id" text NULL,
  "name" text NOT NULL,
  "name_cn" text NULL,
  "latitude" double precision NOT NULL,
  "longitude" double precision NOT NULL,
  "location" public.geography(Point,4326) NULL,
  "image" text NULL,
  "episode" integer NULL,
  "time_seconds" integer NULL DEFAULT 0,
  "scene_desc" text NULL,
  "embedding" public.vector(1024) NULL,
  "origin" text NULL,
  "origin_url" text NULL,
  "city" text NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "points_bangumi_id_fkey" FOREIGN KEY ("bangumi_id") REFERENCES "public"."bangumi" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create index "idx_points_bangumi" to table: "points"
CREATE INDEX "idx_points_bangumi" ON "public"."points" ("bangumi_id");
-- Create index "idx_points_embedding" to table: "points"
CREATE INDEX "idx_points_embedding" ON "public"."points" USING HNSW ("embedding" public.vector_cosine_ops);
-- Create index "idx_points_location" to table: "points"
CREATE INDEX "idx_points_location" ON "public"."points" USING GIST ("location");
-- Create "saved_routes" table
CREATE TABLE "public"."saved_routes" (
  "id" uuid NOT NULL DEFAULT uuidv7(),
  "point_ids" text[] NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "user_id" text NULL,
  "title" text NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "saved_at" timestamptz NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "routes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "routes_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'saved'::text, 'completed'::text]))
);
-- Create index "idx_saved_routes_user" to table: "saved_routes"
CREATE INDEX "idx_saved_routes_user" ON "public"."saved_routes" ("user_id");
-- Create "saved_route_anime" table
CREATE TABLE "public"."saved_route_anime" (
  "saved_route_id" uuid NOT NULL,
  "bangumi_id" text NOT NULL,
  "position" integer NOT NULL DEFAULT 0,
  CONSTRAINT "route_anime_pkey" PRIMARY KEY ("saved_route_id", "bangumi_id"),
  CONSTRAINT "route_anime_route_id_position_key" UNIQUE ("saved_route_id", "position"),
  CONSTRAINT "route_anime_bangumi_id_fkey" FOREIGN KEY ("bangumi_id") REFERENCES "public"."bangumi" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "route_anime_route_id_fkey" FOREIGN KEY ("saved_route_id") REFERENCES "public"."saved_routes" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create index "idx_saved_route_anime_bangumi" to table: "saved_route_anime"
CREATE INDEX "idx_saved_route_anime_bangumi" ON "public"."saved_route_anime" ("bangumi_id");

-- Trigger wiring.
CREATE TRIGGER trg_bangumi_updated_at
  BEFORE UPDATE ON public.bangumi
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_locations_sync_coordinates
  BEFORE INSERT OR UPDATE ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.sync_points_coordinates();
CREATE TRIGGER trg_points_sync_coordinates
  BEFORE INSERT OR UPDATE ON public.points
  FOR EACH ROW EXECUTE FUNCTION public.sync_points_coordinates();
CREATE TRIGGER trg_points_updated_at
  BEFORE UPDATE ON public.points
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_routes_updated_at
  BEFORE UPDATE ON public.saved_routes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_sessions_updated_at
  BEFORE UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Runtime role matrix. DDL remains exclusive to migrator.
GRANT USAGE ON SCHEMA public TO catalog_svc, agent_svc, users_svc, jobs_svc, readonly;

GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.agent_memory TO agent_svc;
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.agent_memory_metadata TO agent_svc;
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.agent_memory_operations TO agent_svc;
GRANT SELECT, USAGE ON SEQUENCE public.agent_memory_versions TO agent_svc;

GRANT ALL ON TABLE public.aliases TO catalog_svc;
GRANT SELECT ON TABLE public.aliases TO readonly;
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.anon_daily_message_count TO agent_svc;
GRANT SELECT, DELETE ON TABLE public.anon_daily_message_count TO jobs_svc;

GRANT ALL ON TABLE public.bangumi TO catalog_svc;
GRANT SELECT ON TABLE public.bangumi TO agent_svc, readonly;
GRANT ALL ON TABLE public.catalog_provenance TO catalog_svc;
GRANT SELECT ON TABLE public.catalog_provenance TO readonly;
GRANT ALL ON TABLE public.catalog_runs TO catalog_svc;
GRANT SELECT ON TABLE public.catalog_runs TO readonly;
GRANT ALL ON TABLE public.cluster_version TO catalog_svc;
GRANT SELECT ON TABLE public.cluster_version TO readonly;

GRANT SELECT, INSERT, UPDATE ON TABLE public.daily_usage TO agent_svc;
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.feedback TO agent_svc;
GRANT ALL ON TABLE public.ingest_jobs TO catalog_svc;
GRANT ALL ON TABLE public.itinerary_snapshots TO catalog_svc;
GRANT SELECT ON TABLE public.itinerary_snapshots TO readonly;
GRANT ALL ON TABLE public.leg_cache TO catalog_svc;
GRANT SELECT ON TABLE public.leg_cache TO readonly;

GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.location_aliases TO catalog_svc;
GRANT SELECT ON TABLE public.location_aliases TO readonly;
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.locations TO catalog_svc;
GRANT SELECT ON TABLE public.locations TO readonly;
GRANT ALL ON TABLE public.media_assets TO catalog_svc;
GRANT SELECT ON TABLE public.media_assets TO readonly;
GRANT ALL ON TABLE public.points TO catalog_svc;
GRANT SELECT ON TABLE public.points TO agent_svc, readonly;

GRANT ALL ON TABLE public.raw_anitabi TO catalog_svc;
GRANT SELECT ON TABLE public.raw_anitabi TO readonly;
GRANT ALL ON TABLE public.raw_bangumi TO catalog_svc;
GRANT SELECT ON TABLE public.raw_bangumi TO readonly;
GRANT ALL ON TABLE public.raw_payload_history TO catalog_svc;
GRANT SELECT ON TABLE public.raw_payload_history TO readonly;
GRANT SELECT, USAGE ON SEQUENCE public.raw_payload_history_seq_seq TO catalog_svc;
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.request_log TO agent_svc;

GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.saved_route_anime TO users_svc;
GRANT SELECT ON TABLE public.saved_route_anime TO readonly;
GRANT SELECT ON TABLE public.saved_routes TO agent_svc, jobs_svc, readonly;
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.saved_routes TO users_svc;
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.saved_route_idempotency TO users_svc;
GRANT SELECT ON TABLE public.saved_route_idempotency TO readonly;
GRANT ALL ON TABLE public.series_edges TO catalog_svc;
GRANT SELECT ON TABLE public.series_edges TO readonly;

GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.sessions TO agent_svc;
GRANT SELECT, DELETE ON TABLE public.sessions TO jobs_svc;
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.messages TO agent_svc;
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.turn_reservations TO agent_svc;
GRANT SELECT ON TABLE public.turn_reservations TO readonly;
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.turn_outbox_events TO agent_svc;
GRANT SELECT ON TABLE public.turn_outbox_events TO readonly;


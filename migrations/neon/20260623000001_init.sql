-- 0001_init.sql
-- Neon-compatible consolidated schema.
-- Source: supabase/migrations/ (all 13 files, later ALTERs folded into final shape).
-- Removed: auth.users FK (2 places), ENABLE ROW LEVEL SECURITY (all tables),
--          CREATE POLICY (all), auth.uid() references.
-- Kept: extensions, all tables, all indexes, HNSW, PostGIS GIST, service roles.
-- Waitlist: dropped (20260425120000_drop_waitlist.sql).
-- bangumi: +city, +platform columns (20260406130000, 20260510170000).
-- points: +city column (20260510180000).

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_points_coordinates()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Catalog tables
-- ---------------------------------------------------------------------------

-- bangumi: final shape (+city from 20260406130000, +platform from 20260510170000)
CREATE TABLE IF NOT EXISTS bangumi (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    title_cn        TEXT,
    cover_url       TEXT,
    air_date        TEXT,
    summary         TEXT,
    eps_count       INTEGER,
    rating          REAL,
    points_count    INTEGER DEFAULT 0,
    primary_color   TEXT,
    city            TEXT,
    platform        TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_bangumi_updated_at ON bangumi;
CREATE TRIGGER trg_bangumi_updated_at
    BEFORE UPDATE ON bangumi
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- points: final shape (+city from 20260510180000; lat/lng NOT NULL per points_alignment)
CREATE TABLE IF NOT EXISTS points (
    id              TEXT PRIMARY KEY,
    bangumi_id      TEXT REFERENCES bangumi(id),
    name            TEXT NOT NULL,
    name_cn         TEXT,
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    location        GEOGRAPHY(POINT, 4326),
    image           TEXT,
    episode         INTEGER,
    time_seconds    INTEGER DEFAULT 0,
    scene_desc      TEXT,
    embedding       vector(1024),
    origin          TEXT,
    origin_url      TEXT,
    city            TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_points_updated_at ON points;
CREATE TRIGGER trg_points_updated_at
    BEFORE UPDATE ON points
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_points_sync_coordinates ON points;
CREATE TRIGGER trg_points_sync_coordinates
    BEFORE INSERT OR UPDATE ON points
    FOR EACH ROW EXECUTE FUNCTION sync_points_coordinates();

-- Ingest singleflight + negative cache
CREATE TABLE IF NOT EXISTS ingest_jobs (
    work_id               TEXT PRIMARY KEY,
    status                TEXT NOT NULL DEFAULT 'pending',
    stage                 TEXT,
    error                 TEXT,
    error_code            TEXT,
    negative_cached_until TIMESTAMPTZ,
    started_at            TIMESTAMPTZ,
    finished_at           TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Atomic version pointer (blue/green publish)
CREATE TABLE IF NOT EXISTS cluster_version (
    id         SERIAL PRIMARY KEY,
    work_id    TEXT NOT NULL,
    version    INTEGER NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (work_id, version)
);

-- Route snapshots (immutable, bound to a cluster_version)
CREATE TABLE IF NOT EXISTS route_snapshots (
    id              SERIAL PRIMARY KEY,
    work_id         TEXT NOT NULL,
    cluster_version INTEGER NOT NULL,
    payload         JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Alias pipeline
CREATE TABLE IF NOT EXISTS aliases (
    id               SERIAL PRIMARY KEY,
    work_id          TEXT NOT NULL,
    alias            TEXT NOT NULL,
    alias_normalized TEXT NOT NULL,
    source           TEXT NOT NULL,
    priority         INTEGER NOT NULL DEFAULT 0,
    UNIQUE (work_id, alias, source)
);

-- Series relation graph
CREATE TABLE IF NOT EXISTS series_edges (
    from_work_id TEXT NOT NULL,
    to_work_id   TEXT NOT NULL,
    relation     TEXT NOT NULL,
    PRIMARY KEY (from_work_id, to_work_id, relation)
);

-- Walk-leg duration cache
CREATE TABLE IF NOT EXISTS leg_cache (
    from_cluster     TEXT NOT NULL,
    to_cluster       TEXT NOT NULL,
    mode             TEXT NOT NULL,
    duration_minutes DOUBLE PRECISION,
    distance_m       DOUBLE PRECISION,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (from_cluster, to_cluster, mode)
);

-- Raw zones (replayable)
CREATE TABLE IF NOT EXISTS raw_anitabi (
    work_id    TEXT PRIMARY KEY,
    payload    JSONB NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw_bangumi (
    work_id    TEXT PRIMARY KEY,
    payload    JSONB NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lazy R2 media assets
CREATE TABLE IF NOT EXISTS media_assets (
    point_id         TEXT PRIMARY KEY,
    r2_key           TEXT,
    content_hash     TEXT,
    last_origin_pull TIMESTAMPTZ,
    tombstoned       BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------------------
-- Operational tables
-- ---------------------------------------------------------------------------

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    user_id     TEXT,
    state       JSONB NOT NULL DEFAULT '{}',
    metadata    JSONB DEFAULT '{}',
    lifecycle   TEXT DEFAULT 'active',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    expires_at  TIMESTAMPTZ
);

DROP TRIGGER IF EXISTS trg_sessions_updated_at ON sessions;
CREATE TRIGGER trg_sessions_updated_at
    BEFORE UPDATE ON sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Routes
CREATE TABLE IF NOT EXISTS routes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      TEXT REFERENCES sessions(id),
    bangumi_id      TEXT REFERENCES bangumi(id),
    origin_station  TEXT,
    origin_location GEOGRAPHY(POINT, 4326),
    point_ids       TEXT[] NOT NULL,
    total_distance  REAL,
    total_duration  INTEGER,
    route_data      JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
    session_id  TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    title       TEXT,
    first_query TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Conversation messages (FK to conversations preserved; auth.users FK removed)
CREATE TABLE IF NOT EXISTS conversation_messages (
    id            SERIAL PRIMARY KEY,
    session_id    TEXT NOT NULL REFERENCES conversations(session_id) ON DELETE CASCADE,
    role          TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content       TEXT NOT NULL,
    response_data JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User memory
CREATE TABLE IF NOT EXISTS user_memory (
    user_id        TEXT PRIMARY KEY,
    visited_anime  JSONB NOT NULL DEFAULT '[]'::jsonb,
    visited_points JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Feedback
CREATE TABLE IF NOT EXISTS feedback (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  TEXT,
    query_text  TEXT NOT NULL,
    intent      TEXT,
    rating      TEXT NOT NULL CHECK (rating IN ('good', 'bad')),
    comment     TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Request log
CREATE TABLE IF NOT EXISTS request_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session_id          TEXT,
    query_text          TEXT NOT NULL,
    locale              TEXT NOT NULL DEFAULT 'ja',
    plan_steps          JSONB,
    intent              TEXT,
    status              TEXT,
    latency_ms          INTEGER,
    plan_quality_score  REAL
);

-- API keys (auth.users FK removed; user_id is plain UUID NOT NULL)
CREATE TABLE IF NOT EXISTS api_keys (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL,
    name         TEXT NOT NULL,
    key_hash     TEXT NOT NULL UNIQUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    revoked      BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- points: geospatial + embedding + FK
CREATE INDEX IF NOT EXISTS idx_points_location
    ON points USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_points_embedding
    ON points USING HNSW (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_points_bangumi
    ON points (bangumi_id);

-- sessions
CREATE INDEX IF NOT EXISTS idx_sessions_user
    ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_lifecycle
    ON sessions (lifecycle);

-- routes
CREATE INDEX IF NOT EXISTS idx_routes_session
    ON routes (session_id);
CREATE INDEX IF NOT EXISTS idx_routes_bangumi
    ON routes (bangumi_id);

-- feedback
CREATE INDEX IF NOT EXISTS idx_feedback_rating
    ON feedback (rating);
CREATE INDEX IF NOT EXISTS idx_feedback_intent
    ON feedback (intent);
CREATE INDEX IF NOT EXISTS idx_feedback_created
    ON feedback (created_at DESC);

-- request_log
CREATE INDEX IF NOT EXISTS idx_request_log_created
    ON request_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_log_locale
    ON request_log (locale);
CREATE INDEX IF NOT EXISTS idx_request_log_intent
    ON request_log (intent);
CREATE INDEX IF NOT EXISTS idx_request_log_unscored
    ON request_log (id)
    WHERE plan_quality_score IS NULL;

-- api_keys
CREATE INDEX IF NOT EXISTS idx_api_keys_hash
    ON api_keys (key_hash)
    WHERE NOT revoked;
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id
    ON api_keys (user_id);

-- conversations
CREATE INDEX IF NOT EXISTS idx_conversations_user_id_updated_at
    ON conversations (user_id, updated_at DESC);

-- conversation_messages
CREATE INDEX IF NOT EXISTS idx_messages_session_created
    ON conversation_messages (session_id, created_at);

-- cluster_version
CREATE INDEX IF NOT EXISTS idx_cluster_version_current
    ON cluster_version (work_id, is_current);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cluster_version_one_current
    ON cluster_version (work_id) WHERE is_current;

-- route_snapshots
CREATE INDEX IF NOT EXISTS idx_route_snapshots_work_version
    ON route_snapshots (work_id, cluster_version);

-- aliases
CREATE INDEX IF NOT EXISTS idx_aliases_normalized ON aliases (alias_normalized);

-- series_edges
CREATE INDEX IF NOT EXISTS idx_series_edges_to ON series_edges (to_work_id);

-- ---------------------------------------------------------------------------
-- Service roles (idempotent; no-ops if roles exist)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog_svc') THEN
        CREATE ROLE catalog_svc NOLOGIN;
    END IF;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_svc') THEN
        CREATE ROLE agent_svc NOLOGIN;
    END IF;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
DECLARE
    t TEXT;
    catalog_tables CONSTANT TEXT[] := ARRAY[
        'bangumi', 'points', 'cluster_version', 'route_snapshots', 'aliases',
        'series_edges', 'leg_cache', 'raw_anitabi', 'raw_bangumi',
        'media_assets', 'ingest_jobs'
    ];
BEGIN
    FOREACH t IN ARRAY catalog_tables LOOP
        IF to_regclass('public.' || t) IS NOT NULL THEN
            EXECUTE format('GRANT ALL ON public.%I TO catalog_svc', t);
        END IF;
    END LOOP;
END $$;

DO $$
DECLARE
    t TEXT;
    op_tables CONSTANT TEXT[] := ARRAY[
        'sessions', 'conversations', 'conversation_messages', 'user_memory',
        'routes', 'request_log', 'feedback'
    ];
BEGIN
    FOREACH t IN ARRAY op_tables LOOP
        IF to_regclass('public.' || t) IS NOT NULL THEN
            EXECUTE format(
                'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO agent_svc', t
            );
        END IF;
    END LOOP;
END $$;

DO $$
DECLARE
    t TEXT;
    ro_tables CONSTANT TEXT[] := ARRAY['bangumi', 'points'];
BEGIN
    FOREACH t IN ARRAY ro_tables LOOP
        IF to_regclass('public.' || t) IS NOT NULL THEN
            EXECUTE format('GRANT SELECT ON public.%I TO agent_svc', t);
        END IF;
    END LOOP;
END $$;

-- Wave 1: data-platform ingest infrastructure (Ingest -> Enrich -> Publish).
-- Adds catalog-pipeline tables: singleflight job tracking, atomic version
-- pointers, no-drift route snapshots, alias pipeline, series graph, leg cache,
-- raw zones, and lazy-R2 media assets. work_id == bangumi.id (TEXT).
-- Additive only; does not alter existing bangumi/points/operational tables.

-- Singleflight + negative cache. A job is created BEFORE the bangumi row is
-- published, so no FK to bangumi.
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

-- Atomic version pointer: is_current flips in one txn = blue/green publish.
CREATE TABLE IF NOT EXISTS cluster_version (
    id         SERIAL PRIMARY KEY,
    work_id    TEXT NOT NULL,
    version    INTEGER NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (work_id, version)
);
CREATE INDEX IF NOT EXISTS idx_cluster_version_current
    ON cluster_version (work_id, is_current);

-- At most one current version per work (partial unique index).
CREATE UNIQUE INDEX IF NOT EXISTS uq_cluster_version_one_current
    ON cluster_version (work_id) WHERE is_current;

-- Route snapshots bound to a cluster_version so shared routes never drift.
CREATE TABLE IF NOT EXISTS route_snapshots (
    id              SERIAL PRIMARY KEY,
    work_id         TEXT NOT NULL,
    cluster_version INTEGER NOT NULL,
    payload         JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- No-drift read path: WHERE work_id = $1 AND cluster_version = $2.
CREATE INDEX IF NOT EXISTS idx_route_snapshots_work_version
    ON route_snapshots (work_id, cluster_version);
-- cluster_version is intentionally NOT FK'd to cluster_version.version: a snapshot
-- must survive version GC (immutability is the whole point).

-- Alias pipeline (4 sources). alias_normalized = NFKC-folded; exact-match via the
-- btree below. Fuzzy search (pg_trgm GIN index + extension) is added in Wave 2 when
-- the alias-search read path lands — a btree does NOT accelerate %/similarity().
CREATE TABLE IF NOT EXISTS aliases (
    id               SERIAL PRIMARY KEY,
    work_id          TEXT NOT NULL,
    alias            TEXT NOT NULL,
    alias_normalized TEXT NOT NULL,
    source           TEXT NOT NULL,
    priority         INTEGER NOT NULL DEFAULT 0,
    UNIQUE (work_id, alias, source)
);
CREATE INDEX IF NOT EXISTS idx_aliases_normalized ON aliases (alias_normalized);

-- Series relation graph (Bangumi relations) for series-aware resolve.
CREATE TABLE IF NOT EXISTS series_edges (
    from_work_id TEXT NOT NULL,
    to_work_id   TEXT NOT NULL,
    relation     TEXT NOT NULL,
    PRIMARY KEY (from_work_id, to_work_id, relation)
);
-- PK prefix covers forward traversal (from_work_id); index reverse traversal too
-- (series-aware resolve asks "is X a sequel of Y" in both directions).
CREATE INDEX IF NOT EXISTS idx_series_edges_to ON series_edges (to_work_id);

-- Walk-leg duration cache (ORS -> Google), pre-warmed during enrich.
CREATE TABLE IF NOT EXISTS leg_cache (
    from_cluster     TEXT NOT NULL,
    to_cluster       TEXT NOT NULL,
    mode             TEXT NOT NULL,
    duration_minutes DOUBLE PRECISION,
    distance_m       DOUBLE PRECISION,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (from_cluster, to_cluster, mode)
);

-- Raw zones (replayable, never read by serving).
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

-- Lazy R2 media assets (one upload per asset, edge-cached).
CREATE TABLE IF NOT EXISTS media_assets (
    point_id         TEXT PRIMARY KEY,
    r2_key           TEXT,
    content_hash     TEXT,
    last_origin_pull TIMESTAMPTZ,
    tombstoned       BOOLEAN NOT NULL DEFAULT FALSE
);

-- Enable RLS on all new tables, consistent with existing tables (bangumi/points/...).
-- No policies = PostgREST/anon deny-all; the backend reads via a direct privileged
-- connection (bypasses RLS), same as it already does for bangumi/points.
ALTER TABLE ingest_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cluster_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE series_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE leg_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_anitabi ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_bangumi ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;

-- Single-writer discipline: app role reads catalog only; pipeline role writes.
-- Guarded so it applies on Supabase (anon/authenticated/service_role exist) and
-- safely no-ops on a plain testcontainer (superuser, roles absent).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        GRANT SELECT ON ingest_jobs, cluster_version, route_snapshots, aliases,
            series_edges, leg_cache, media_assets TO authenticated, anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT ALL ON ingest_jobs, cluster_version, route_snapshots, aliases,
            series_edges, leg_cache, raw_anitabi, raw_bangumi, media_assets
            TO service_role;
    END IF;
END $$;

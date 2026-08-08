-- Auth-stripped Atlas twin of supabase/migrations/20260716120000_route_anime.sql.
CREATE TABLE IF NOT EXISTS route_anime (
    route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    bangumi_id TEXT NOT NULL REFERENCES bangumi(id),
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (route_id, bangumi_id),
    UNIQUE (route_id, position)
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'routes'
          AND column_name = 'bangumi_id'
    ) THEN
        INSERT INTO route_anime (route_id, bangumi_id, position)
        SELECT id, bangumi_id, 0
        FROM routes
        WHERE bangumi_id IS NOT NULL
        ON CONFLICT DO NOTHING;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_route_anime_bangumi ON route_anime (bangumi_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON route_anime TO agent_svc;
DROP INDEX IF EXISTS idx_routes_bangumi;
ALTER TABLE routes DROP COLUMN IF EXISTS bangumi_id;

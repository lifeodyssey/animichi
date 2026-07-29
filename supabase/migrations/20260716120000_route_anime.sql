-- Normalize route-to-anime identity for single- and multi-work itineraries.
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
ALTER TABLE route_anime ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE route_anime FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON route_anime TO agent_svc;
DROP POLICY IF EXISTS route_anime_agent_svc_all ON route_anime;
CREATE POLICY route_anime_agent_svc_all ON route_anime
    FOR ALL TO agent_svc USING (true) WITH CHECK (true);

DROP INDEX IF EXISTS idx_routes_bangumi;
ALTER TABLE routes DROP COLUMN IF EXISTS bangumi_id;

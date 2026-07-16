-- Normalize route-to-anime identity for single- and multi-work itineraries.
CREATE TABLE route_anime (
    route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    bangumi_id TEXT NOT NULL REFERENCES bangumi(id),
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (route_id, bangumi_id),
    UNIQUE (route_id, position)
);

INSERT INTO route_anime (route_id, bangumi_id, position)
SELECT id, bangumi_id, 0
FROM routes
WHERE bangumi_id IS NOT NULL;

CREATE INDEX idx_route_anime_bangumi ON route_anime (bangumi_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON route_anime TO agent_svc;

DROP INDEX IF EXISTS idx_routes_bangumi;
ALTER TABLE routes DROP COLUMN bangumi_id;

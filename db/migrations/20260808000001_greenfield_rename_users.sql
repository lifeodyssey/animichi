-- G1 users slice (#852): greenfield rename of the users data plane.
-- routes → saved_routes (SavedRoute), route_anime → saved_route_anime (D1
-- decision A: keep data, no DROP). claim_session_id renames the anonymous
-- claim key (D2) and the agent-era origin/geometry/route columns are retired.
-- The cross-BC FK from session_id to sessions(id) is removed (greenfield
-- principle 4: no cross-BC FK from the users BC). Append-only migration.

ALTER TABLE routes RENAME TO saved_routes;
ALTER TABLE saved_routes RENAME COLUMN session_id TO claim_session_id;
ALTER TABLE saved_routes DROP COLUMN IF EXISTS origin_station;
ALTER TABLE saved_routes DROP COLUMN IF EXISTS origin_location;
ALTER TABLE saved_routes DROP COLUMN IF EXISTS total_distance;
ALTER TABLE saved_routes DROP COLUMN IF EXISTS total_duration;
ALTER TABLE saved_routes DROP COLUMN IF EXISTS route_data;

ALTER TABLE saved_routes DROP CONSTRAINT IF EXISTS routes_session_id_fkey;

ALTER INDEX IF EXISTS idx_routes_session RENAME TO idx_saved_routes_claim_session;
ALTER INDEX IF EXISTS idx_routes_user RENAME TO idx_saved_routes_user;

-- D1 (C5 decision A, conservative: keep data): route_anime → saved_route_anime.
ALTER TABLE route_anime RENAME TO saved_route_anime;
ALTER TABLE saved_route_anime RENAME COLUMN route_id TO saved_route_id;
ALTER INDEX IF EXISTS idx_route_anime_bangumi RENAME TO idx_saved_route_anime_bangumi;

-- GRANT re-baseline: users_svc + readonly keep the tables, agent_svc loses the
-- legacy writer grants (init op_tables / 20260718000001 route_anime grants);
-- the agent legacy writer was deleted with the /v1/routes endpoint (D4).
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE saved_routes FROM agent_svc;
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE saved_route_anime FROM agent_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE saved_routes TO users_svc;
GRANT SELECT ON TABLE saved_routes TO readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE saved_route_anime TO users_svc;
GRANT SELECT ON TABLE saved_route_anime TO readonly;

-- S2.8 evolves routes into the Users service's saved-route shape. session_id is
-- retained for the future flow that claims anonymous routes after authentication.
ALTER TABLE routes ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE routes ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE routes ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'saved', 'completed'));
ALTER TABLE routes ADD COLUMN IF NOT EXISTS saved_at TIMESTAMPTZ;
ALTER TABLE routes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_routes_user ON routes (user_id);
DROP TRIGGER IF EXISTS trg_routes_updated_at ON routes;
CREATE TRIGGER trg_routes_updated_at BEFORE UPDATE ON routes FOR EACH ROW EXECUTE FUNCTION update_updated_at();

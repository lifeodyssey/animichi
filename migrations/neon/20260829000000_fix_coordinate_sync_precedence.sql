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

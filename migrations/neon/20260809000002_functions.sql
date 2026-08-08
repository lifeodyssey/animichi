-- Trigger functions

CREATE FUNCTION public.sync_points_coordinates() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;




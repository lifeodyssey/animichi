CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX idx_location_aliases_trgm
    ON location_aliases USING GIN (alias_normalized gin_trgm_ops);

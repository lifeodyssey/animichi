-- Neon data-plane baseline (2026-08-26 hard cut): Postgres extensions shared by the
-- catalog, agent, and users schemas that follow. Extension objects have no owning
-- service role; DDL remains exclusive to the migrator.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

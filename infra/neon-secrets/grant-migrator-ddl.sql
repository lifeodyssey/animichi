-- #1050 / #1136 staging remainder. Applied as neondb_owner (not migrator, not Atlas).
-- public ACL is pg_database_owner=UC + PUBLIC=U; neon_superuser has no CREATE.
-- FK to existing tables needs REFERENCES; table owner can GRANT that.
GRANT USAGE, CREATE ON SCHEMA public TO migrator;
GRANT REFERENCES ON ALL TABLES IN SCHEMA public TO migrator;

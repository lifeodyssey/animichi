-- #1050 / #1134 staging remainder. Applied as neondb_owner (not migrator, not Atlas).
-- public ACL is pg_database_owner=UC + PUBLIC=U; neon_superuser has no CREATE.
-- #1132/#1133: GRANT migrator TO neondb_owner is permission-denied (no ADMIN OPTION).
-- OWNER TO migrator is a later #1050 card; this step must not fail the GRANT job.
GRANT USAGE, CREATE ON SCHEMA public TO migrator;

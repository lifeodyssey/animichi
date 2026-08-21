-- #1050 / #1132 staging remainder. Applied as neondb_owner (not migrator, not Atlas).
-- public ACL is pg_database_owner=UC + PUBLIC=U; neon_superuser has no CREATE.
-- ALTER OWNER requires the session role be able to SET ROLE migrator.
GRANT USAGE, CREATE ON SCHEMA public TO migrator;
GRANT migrator TO neondb_owner;
ALTER TABLE public.turn_reservations OWNER TO migrator;

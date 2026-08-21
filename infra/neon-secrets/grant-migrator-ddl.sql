-- #1050 staging remainder. Applied as neondb_owner (not migrator, not Atlas).
-- public ACL is pg_database_owner=UC + PUBLIC=U; neon_superuser has no CREATE.
GRANT USAGE, CREATE ON SCHEMA public TO migrator;
ALTER TABLE public.turn_reservations OWNER TO migrator;

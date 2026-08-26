-- Neon data-plane baseline: runtime service roles (catalog_svc, agent_svc, users_svc,
-- jobs_svc, readonly) and schema usage. Table/sequence privileges for each role are
-- granted alongside their owning tables in 20260826000003_catalog.sql,
-- 20260826000004_agent.sql, and 20260826000005_users.sql.
DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['catalog_svc', 'agent_svc', 'users_svc', 'jobs_svc', 'readonly']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', role_name);
    END IF;
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO catalog_svc, agent_svc, users_svc, jobs_svc, readonly;

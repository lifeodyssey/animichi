-- Service roles (NOLOGIN; grants reference them)

DO $$
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog_svc') THEN
    CREATE ROLE catalog_svc NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_svc') THEN
    CREATE ROLE agent_svc NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'users_svc') THEN
    CREATE ROLE users_svc NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jobs_svc') THEN
    CREATE ROLE jobs_svc NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly') THEN
    CREATE ROLE readonly NOLOGIN;
  END IF;
END $$;

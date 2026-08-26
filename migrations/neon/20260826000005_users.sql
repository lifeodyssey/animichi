-- Neon data-plane baseline: users bounded context (3 tables).
-- users_svc holds the write grants (SELECT/INSERT/UPDATE/DELETE) on every table below;
-- agent_svc, jobs_svc, and readonly hold read-only SELECT grants where noted per table.
-- saved_route_anime carries the sole cross-context foreign key (bangumi_id ->
-- catalog.bangumi), so this file must be applied after 20260826000003_catalog.sql.
-- saved_routes must precede saved_route_anime (FK); the ordering is preserved below.

-- Create "saved_route_idempotency" table
CREATE TABLE public.saved_route_idempotency (
  owner_user_id text NOT NULL,
  op text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  state text NOT NULL DEFAULT 'in_progress',
  result jsonb NULL,
  result_id uuid NULL,
  created_at timestamptz NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (owner_user_id, op, key),
  CONSTRAINT sr_idem_state_check CHECK (state = ANY(ARRAY['in_progress'::text, 'committed'::text]))
);
-- Create index "idx_saved_route_idempotency_expires" to table: "saved_route_idempotency"
CREATE INDEX idx_saved_route_idempotency_expires ON public.saved_route_idempotency (expires_at);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.saved_route_idempotency TO users_svc;
GRANT SELECT ON TABLE public.saved_route_idempotency TO readonly;

-- Create "saved_routes" table
CREATE TABLE public.saved_routes (
  id uuid NOT NULL DEFAULT uuidv7(),
  point_ids text[] NOT NULL,
  created_at timestamptz NULL DEFAULT now(),
  user_id text NULL,
  title text NULL,
  status text NOT NULL DEFAULT 'draft',
  saved_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT routes_pkey PRIMARY KEY (id),
  CONSTRAINT routes_status_check CHECK (status = ANY(ARRAY['draft'::text, 'saved'::text, 'completed'::text]))
);
-- Create index "idx_saved_routes_user" to table: "saved_routes"
CREATE INDEX idx_saved_routes_user ON public.saved_routes (user_id);
CREATE TRIGGER trg_routes_updated_at
  BEFORE UPDATE ON public.saved_routes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
GRANT SELECT ON TABLE public.saved_routes TO agent_svc, jobs_svc, readonly;
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.saved_routes TO users_svc;

-- Create "saved_route_anime" table
CREATE TABLE public.saved_route_anime (
  saved_route_id uuid NOT NULL,
  bangumi_id text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  CONSTRAINT route_anime_pkey PRIMARY KEY (saved_route_id, bangumi_id),
  CONSTRAINT route_anime_route_id_position_key UNIQUE (saved_route_id, position),
  CONSTRAINT route_anime_bangumi_id_fkey FOREIGN KEY (bangumi_id) REFERENCES public.bangumi (id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT route_anime_route_id_fkey FOREIGN KEY (saved_route_id) REFERENCES public.saved_routes (id) ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create index "idx_saved_route_anime_bangumi" to table: "saved_route_anime"
CREATE INDEX idx_saved_route_anime_bangumi ON public.saved_route_anime (bangumi_id);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.saved_route_anime TO users_svc;
GRANT SELECT ON TABLE public.saved_route_anime TO readonly;

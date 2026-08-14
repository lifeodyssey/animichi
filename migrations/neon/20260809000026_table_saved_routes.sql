-- Table saved_routes (indexes/constraints/triggers)

CREATE TABLE public.saved_routes (
    id uuid DEFAULT uuidv7() CONSTRAINT routes_id_not_null NOT NULL,
    point_ids text[] CONSTRAINT routes_point_ids_not_null NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    user_id text,
    title text,
    status text DEFAULT 'draft'::text CONSTRAINT routes_status_not_null NOT NULL,
    saved_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() CONSTRAINT routes_updated_at_not_null NOT NULL,
    CONSTRAINT routes_status_check CHECK ((status = ANY(ARRAY['draft'::text, 'saved'::text, 'completed'::text])))
);

ALTER TABLE ONLY public.saved_routes
    ADD CONSTRAINT routes_pkey PRIMARY KEY (id);

CREATE INDEX idx_saved_routes_user ON public.saved_routes USING btree (user_id);

CREATE TRIGGER trg_routes_updated_at BEFORE UPDATE ON public.saved_routes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

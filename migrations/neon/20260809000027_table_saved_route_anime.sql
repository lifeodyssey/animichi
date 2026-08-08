-- Table saved_route_anime (indexes/constraints/triggers)

CREATE TABLE public.saved_route_anime (
    saved_route_id uuid CONSTRAINT route_anime_route_id_not_null NOT NULL,
    bangumi_id text CONSTRAINT route_anime_bangumi_id_not_null NOT NULL,
    position integer DEFAULT 0 CONSTRAINT route_anime_position_not_null NOT NULL
);

ALTER TABLE ONLY public.saved_route_anime
    ADD CONSTRAINT route_anime_pkey PRIMARY KEY (saved_route_id, bangumi_id);

ALTER TABLE ONLY public.saved_route_anime
    ADD CONSTRAINT route_anime_route_id_position_key UNIQUE (saved_route_id, position);

ALTER TABLE ONLY public.saved_route_anime
    ADD CONSTRAINT route_anime_bangumi_id_fkey FOREIGN KEY (bangumi_id) REFERENCES public.bangumi(id);

ALTER TABLE ONLY public.saved_route_anime
    ADD CONSTRAINT route_anime_route_id_fkey FOREIGN KEY (saved_route_id) REFERENCES public.saved_routes(id) ON DELETE CASCADE;

CREATE INDEX idx_saved_route_anime_bangumi ON public.saved_route_anime USING btree (bangumi_id);

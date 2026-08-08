-- Table location_aliases (indexes/constraints/triggers)

CREATE TABLE public.location_aliases (
    alias text NOT NULL,
    alias_normalized text NOT NULL,
    location_id text NOT NULL,
    lang text,
    priority integer DEFAULT 0 NOT NULL,
    CONSTRAINT location_aliases_lang_check CHECK (((lang = ANY(ARRAY['ja'::text, 'zh'::text, 'en'::text])) OR (lang IS NULL)))
);

ALTER TABLE ONLY public.location_aliases
    ADD CONSTRAINT location_aliases_pkey PRIMARY KEY (alias_normalized, location_id);

ALTER TABLE ONLY public.location_aliases
    ADD CONSTRAINT location_aliases_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;

CREATE INDEX idx_location_aliases_norm ON public.location_aliases USING btree (alias_normalized);

CREATE INDEX idx_location_aliases_trgm ON public.location_aliases USING gin (alias_normalized public.gin_trgm_ops);

-- Table aliases (indexes/constraints/triggers)

CREATE TABLE public.aliases (
    id uuid DEFAULT uuidv7() NOT NULL,
    bangumi_id text CONSTRAINT aliases_work_id_not_null NOT NULL,
    alias text NOT NULL,
    alias_normalized text NOT NULL,
    source text NOT NULL,
    priority integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.aliases
    ADD CONSTRAINT aliases_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.aliases
    ADD CONSTRAINT aliases_work_id_alias_source_key UNIQUE (bangumi_id, alias, source);

CREATE INDEX idx_aliases_normalized ON public.aliases USING btree (alias_normalized);

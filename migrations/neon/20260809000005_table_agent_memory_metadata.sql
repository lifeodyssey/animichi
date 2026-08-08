-- Table agent_memory_metadata (indexes/constraints/triggers)

CREATE TABLE public.agent_memory_metadata (
    id boolean DEFAULT true NOT NULL,
    versions_initialized boolean NOT NULL,
    CONSTRAINT agent_memory_metadata_id_check CHECK (id)
);

ALTER TABLE ONLY public.agent_memory_metadata
    ADD CONSTRAINT agent_memory_metadata_pkey PRIMARY KEY (id);

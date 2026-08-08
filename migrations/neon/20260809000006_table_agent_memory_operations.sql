-- Table agent_memory_operations (indexes/constraints/triggers)

CREATE TABLE public.agent_memory_operations (
    id text NOT NULL,
    fingerprint text NOT NULL,
    version text,
    existed boolean NOT NULL,
    completed boolean NOT NULL
);

ALTER TABLE ONLY public.agent_memory_operations
    ADD CONSTRAINT agent_memory_operations_pkey PRIMARY KEY (id);

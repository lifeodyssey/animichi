-- Table agent_memory (indexes/constraints/triggers)

CREATE TABLE public.agent_memory (
    path text NOT NULL,
    content text NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    last_operation_id text
);

ALTER TABLE ONLY public.agent_memory
    ADD CONSTRAINT agent_memory_pkey PRIMARY KEY (path);

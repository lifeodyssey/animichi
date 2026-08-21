-- Table messages (indexes/constraints/triggers)
--
-- #992 cutover: the row identity is a native database-generated UUIDv7.
--
-- The ordered Session transcript (SESSION-3 #961). `messages` is a child of
-- the sole `sessions` aggregate; ordering is the GetSessionHistory boundary
-- contract (`created_at ASC`).

CREATE TABLE public.messages (
    id uuid DEFAULT uuidv7() NOT NULL,
    session_id text NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    response_data jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT messages_role_check CHECK ((role = ANY(ARRAY['user'::text, 'assistant'::text])))
);

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;

CREATE INDEX idx_messages_session_created ON public.messages USING btree (session_id, created_at);

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.messages TO agent_svc;

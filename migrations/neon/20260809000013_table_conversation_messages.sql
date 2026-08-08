-- Table conversation_messages (indexes/constraints/triggers)

CREATE TABLE public.conversation_messages (
    id integer NOT NULL,
    session_id text NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    response_data jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT conversation_messages_role_check CHECK ((role = ANY(ARRAY['user'::text, 'assistant'::text])))
);

ALTER TABLE ONLY public.conversation_messages
    ADD CONSTRAINT conversation_messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.conversation_messages
    ADD CONSTRAINT conversation_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.conversations(session_id) ON DELETE CASCADE;

CREATE INDEX idx_messages_session_created ON public.conversation_messages USING btree (session_id, created_at);

ALTER SEQUENCE public.conversation_messages_id_seq OWNED BY public.conversation_messages.id;

-- serial default: id
ALTER TABLE ONLY public.conversation_messages ALTER COLUMN id SET DEFAULT nextval('public.conversation_messages_id_seq'::regclass);

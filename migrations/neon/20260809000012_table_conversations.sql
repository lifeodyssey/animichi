-- Table conversations (indexes/constraints/triggers)

CREATE TABLE public.conversations (
    session_id text NOT NULL,
    user_id text NOT NULL,
    title text,
    first_query text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (session_id);

CREATE INDEX idx_conversations_user_id_pattern ON public.conversations USING btree (user_id text_pattern_ops);

CREATE INDEX idx_conversations_user_id_updated_at ON public.conversations USING btree (user_id, updated_at DESC);

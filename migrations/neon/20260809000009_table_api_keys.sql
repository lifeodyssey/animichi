-- Table api_keys (indexes/constraints/triggers)

CREATE TABLE public.api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    key_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    revoked boolean DEFAULT false NOT NULL
);

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_key_hash_key UNIQUE (key_hash);

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);

CREATE INDEX idx_api_keys_hash ON public.api_keys USING btree (key_hash) WHERE (NOT revoked);

CREATE INDEX idx_api_keys_user_id ON public.api_keys USING btree (user_id);

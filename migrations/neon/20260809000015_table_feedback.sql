-- Table feedback (indexes/constraints/triggers)

CREATE TABLE public.feedback (
    id uuid DEFAULT uuidv7() NOT NULL,
    session_id text,
    query_text text NOT NULL,
    intent text,
    rating text NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT feedback_rating_check CHECK ((rating = ANY(ARRAY['good'::text, 'bad'::text])))
);

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_pkey PRIMARY KEY (id);

CREATE INDEX idx_feedback_created ON public.feedback USING btree (created_at DESC);

CREATE INDEX idx_feedback_intent ON public.feedback USING btree (intent);

CREATE INDEX idx_feedback_rating ON public.feedback USING btree (rating);

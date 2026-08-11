-- TurnOutcome (TURN-3 #951): lease-guarded reserved/running/terminal lifecycle

ALTER TABLE public.turn_reservations
    ALTER COLUMN status SET DEFAULT 'reserved'::text;

ALTER TABLE public.turn_reservations
    ADD COLUMN lease_owner text NOT NULL DEFAULT '',
    ADD COLUMN lease_expires_at timestamp with time zone NOT NULL DEFAULT now();

-- Legacy TURN-2 in_flight rows are ambiguous (may have dispatched): map them
-- to running so the dispatch-certainty rule (never replay) applies.
UPDATE public.turn_reservations
    SET status = 'running'
    WHERE status = 'in_flight';

ALTER TABLE public.turn_reservations
    DROP CONSTRAINT turn_reservations_status_check;

ALTER TABLE public.turn_reservations
    ADD CONSTRAINT turn_reservations_status_check
        CHECK ((status = ANY(ARRAY['reserved'::text, 'running'::text, 'completed'::text, 'failed'::text])));

-- Indexed demand-driven sweep: reclaim expired leases in bounded batches.
CREATE INDEX idx_turn_reservations_sweep
    ON public.turn_reservations USING btree (status, lease_expires_at)
    WHERE (status = ANY(ARRAY['reserved'::text, 'running'::text]));

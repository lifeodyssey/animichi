-- The sessionless photo-offer namespace (#1600, Card F of the #1317 decomposition).
--
-- Why a durable home. SearchPhoto issues one candidate offer per recognition turn and
-- ConfirmPhotoOffer consumes it, but the namespace is a process-local dict today
-- (apps/agent/src/animichi/infrastructure/photo_offers.py, "In-process only ... a shared
-- store is a later ops decision"). A Worker has no process to be local to, and photo
-- search is moving to the edge tier (Card G), where an offer issued by one isolate must be
-- confirmable from another. This table is that home. No reader ships in this card, so
-- nothing changes behaviourally.
--
-- What a row is. One offer, keyed by its own opaque `offer_id`: the identity it was issued
-- to, the server-derived `signals` and the `candidates` the user was shown, and
-- `expires_at`. `signals` and `candidates` stay jsonb — each is a value object the writer
-- stores whole and the confirm replays whole, not a set of fields anything queries. The
-- namespace is deliberately SESSIONLESS: an offer is never keyed by a session, so there is
-- no session column here, by design.
--
-- Bounded namespace, with the same semantics as the in-memory store. An offer lives ten
-- minutes — the writer stamps `expires_at` with its own clock plus `PHOTO_OFFER_TTL`
-- (apps/agent/src/animichi/application/search_photo.py) — and the sweep that keeps the
-- namespace bounded (expired rows first, oldest first) reads `idx_photo_offers_expiry`.
-- The 1,000-offer cap stays a writer rule: PostgreSQL cannot constrain a row count, and a
-- trigger would be a heavier mechanism than the semantics justify.
--
-- Ownership (migrations/AGENTS.md, D21): agent_svc holds SELECT/INSERT/UPDATE/DELETE and
-- is the only role with any privilege here, in the turn_reservations shape. No other
-- service role, and no readonly grant: a row carries one visitor's image recognition
-- result.
--
-- Purely additive against the deployed consumers one version back (US25/#1052): a new
-- table, its index and its grants change nothing an existing reader or writer sees.

-- Create "photo_offers" table
CREATE TABLE public.photo_offers (
  offer_id text NOT NULL,
  identity_id text NOT NULL,
  signals jsonb NOT NULL,
  candidates jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (offer_id)
);
-- Create index "idx_photo_offers_expiry" to table: "photo_offers"
CREATE INDEX idx_photo_offers_expiry ON public.photo_offers (expires_at);
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.photo_offers TO agent_svc;

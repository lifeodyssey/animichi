-- Drop api_keys (AUTH-1 #945): the sk_* identity API-key path and its
-- mint/verify/persistence surface are deleted, so the table has no producer.
-- The historical create (20260809000009) and its grant
-- (20260809000030, api_keys -> agent_svc) stay as append-only history;
-- DROP TABLE removes the grant together with the table, so no new grant
-- revocation is needed.

DROP TABLE IF EXISTS public.api_keys;

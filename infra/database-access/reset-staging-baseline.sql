\if :drop_marker_schema
DROP TABLE prisma_contract.marker, prisma_contract.ledger, prisma_contract.contract;
DROP SCHEMA prisma_contract;
\endif
-- #1949: each half runs as its own transaction on its own connection — the marker schema's drop
-- as its owner `migrator`, this rebuild of `public` as `neondb_owner`. A half-reset a re-run
-- finishes is cheaper than a seat in `migrator` would be.
\if :public_reset
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
-- WITH GRANT OPTION, because the chain hands this schema on: its access migration runs as
-- `migrator` and grants the five data-plane service roles USAGE here. A role without the option
-- does not fail that grant — it warns "no privileges were granted" and grants nothing — so the
-- chain's postcheck failed staging for the two roles no membership covers for it (#1896).
GRANT USAGE, CREATE ON SCHEMA public TO migrator WITH GRANT OPTION;
\endif

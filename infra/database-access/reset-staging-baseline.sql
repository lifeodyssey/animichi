\if :drop_marker_schema
DROP TABLE prisma_contract.marker, prisma_contract.ledger, prisma_contract.contract;
DROP SCHEMA prisma_contract;
\endif
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
-- WITH GRANT OPTION, because the chain hands this schema on: its access migration runs as
-- `migrator` and grants the five data-plane service roles USAGE here. A role without the option
-- does not fail that grant — it warns "no privileges were granted" and grants nothing — so the
-- chain's postcheck failed staging for the two roles no membership covers for it (#1896).
GRANT USAGE, CREATE ON SCHEMA public TO migrator WITH GRANT OPTION;

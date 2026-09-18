\if :drop_marker_schema
DROP TABLE prisma_contract.marker, prisma_contract.ledger, prisma_contract.contract;
DROP SCHEMA prisma_contract;
\endif
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT USAGE, CREATE ON SCHEMA public TO migrator;

# ORM, migration, and IaC test boundaries

Date: 2026-08-12

## Question

Should Pulumi tests be the sole way Animichi verifies PostgreSQL schema,
grants, and ORM behavior?

## Finding

No. Pulumi, Atlas, PostgreSQL, and SQLModel/SQLAlchemy own different observable
boundaries and need separate tests.

| Layer | Authority | Required evidence |
|---|---|---|
| Cloud resources and secret wiring | Pulumi | Mock/unit tests for resource inputs; preview or ephemeral integration for deployed outputs |
| Database schema and migration history | Atlas migrations | Hash/validate/lint plus apply-from-zero against disposable PostgreSQL |
| Reflected schema shape | Migrated PostgreSQL | SQLAlchemy `Inspector` checks for tables, columns, constraints, foreign keys, and indexes |
| Effective service-role access | PostgreSQL role reached through its scoped DSN | Positive and negative SQLModel operations using the actual role |
| Application persistence behavior | SQLModel/SQLAlchemy adapter | Real-PostgreSQL transaction, concurrency, rollback, CAS, and lease contract tests |

## Primary-source evidence

1. Pulumi distinguishes fast in-memory unit tests, property tests against real
   stack values, and integration tests that deploy infrastructure and validate
   its behavior. Its unit-test documentation explicitly says mocks perform no
   real work. Therefore a mocked Pulumi role declaration cannot prove effective
   PostgreSQL privileges.
   - https://www.pulumi.com/docs/iac/concepts/testing/
   - https://www.pulumi.com/docs/iac/guides/testing/unit/

2. Atlas describes database schema as code that Atlas plans, verifies, tests,
   and applies. `atlas migrate lint` is designed for local and CI migration
   safety checks. Atlas migration tests start from the migration directory's
   zero state and run against a dev database.
   - https://atlasgo.io/atlas-schema
   - https://atlasgo.io/versioned/lint
   - https://atlasgo.io/testing/migrate

3. PostgreSQL exposes effective table grants as database state through
   `role_table_grants`. Grants are therefore observable properties of the
   migrated database, not merely properties of Pulumi source code.
   - https://www.postgresql.org/docs/17/infoschema-role-table-grants.html

4. SQLAlchemy provides reflection and `Inspector` as public APIs for loading
   tables, columns, constraints, foreign keys, and indexes from the actual
   database. Schema checks do not require handwritten SQL in Python.
   - https://docs.sqlalchemy.org/en/20/core/reflection.html

5. Neon recommends database branches for CI workflows and testing queries.
   A disposable branch can host the end-to-end Pulumi/Atlas/role/ORM check
   without targeting staging or production.
   - https://neon.com/docs/get-started-with-neon/workflow-primer

## Recommended Animichi policy

- Keep Atlas SQL migrations as the sole schema authority.
- Ban handwritten SQL from all Python, including tests.
- Verify schema shape through SQLAlchemy reflection rather than SQL strings.
- Verify grants by connecting with each service-role DSN and attempting a
  minimal matrix of allowed and denied SQLModel operations.
- Keep Pulumi unit/preview tests for role, secret, and binding declarations.
- Run the complete chain on a disposable Neon branch in CI and destroy the
  branch after the job.
- Do not infer deployed database behavior from Pulumi mocks or preview alone.

## CI consequence

The role-scoped Neon integration must be blocking if the PR changes Pulumi
role wiring, Atlas migrations/grants, SQLModel mappings, or persistence code.
Unaffected PRs can skip it through path filtering. Local pre-commit should run
the static no-raw-SQL gate and fast Pulumi/Atlas checks, not provision cloud
infrastructure.

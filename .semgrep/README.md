# Raw-SQL policy — repository Semgrep ruleset (#999)

This directory is the repository-owned Semgrep configuration for the **ORM-only
database access** boundary (part of #992, ticket #999). It makes the Drizzle
seams enforceable across the TypeScript workers (`workers/catalog`,
`workers/users`). The ruleset is loaded
by the `semgrep` CI job and the pre-commit hook via `--config .semgrep`.

## Rules

| Rule | Language | Rejects |
|------|----------|---------|
| `ts-no-complete-sql-statement` | TypeScript | A `sql\`...\`` tagged template that **starts** a complete `SELECT` / `INSERT` / `UPDATE` / `DELETE` in `workers/catalog/src` / `workers/users/src` |
| `ts-no-sql-raw` | TypeScript | `sql.raw(...)` in `workers/catalog/src` / `workers/users/src` |
| `ts-no-direct-neon-seam-bypass` | TypeScript | Direct `neon()` / `neonsql()` / `NeonSql` construction that bypasses the `CatalogDb` / `UsersDb` seam (`db/client.ts`) |

### Scope

- The rules are scoped via `paths.include: [/workers/catalog/src,
  /workers/users/src]`; `test/` and `tests/` directories are already excluded by
  the default `.semgrepignore` patterns (required restatement).
- Atlas migration SQL under `migrations/neon/` is out of scope: the rules are
  TypeScript-only and never match `.sql` files.

## Narrow exceptions (documented AT-C fully)

The ORM boundary has exactly two sanctioned escapes. Both are enforced by
`paths.exclude` on the relevant rules and are the ONLY places raw PostgreSQL is
allowed:

1. **Atlas migrations** (`migrations/neon/`) — schema DDL owned by Atlas/`atlas
   migrate`. Out of scope by language; the rules do not target `.sql` files.
2. **Dedicated typed-expression modules** — complete hand-written SQL may live
   only in:
   - `workers/catalog/src/db/expressions.ts` — Drizzle `SQL` *fragments* only;
     never a complete `SELECT`/`INSERT`/`UPDATE`/`DELETE`; the sole sanctioned
     `sql.raw()` caller (composing identifiers into a fragment).
3. **The sanctioned seam files** constructing the single Drizzle client:
   - `workers/catalog/src/db/client.ts` (the `CatalogDb` seam)
   - `workers/users/src/db/client.ts` (the `UsersDb` seam)

These exceptions are mirrored in the rule `paths.exclude` directives and are
asserted to stay non-violating by the self-test (`scripts/semgrep-raw-sql-test.sh`).

## Self-test

Run from the repo root:

    scripts/semgrep-raw-sql-test.sh

It fails closed and asserts each gate:

- **(a) Forbidden examples FAIL** — `.semgrep/tests/fixtures/forbidden/` holds one
  representative violation per rule; the mirror scan under the include paths must
  exit non-zero (each of the 3 rules must fire).
- **(b) Approved exceptions PASS** — the real sanctioned seam files must yield
  zero findings.
- **Baseline clean** — the current `workers/*/src` runtime trees must already be violation-free (no false positives on live code).

`semgrep --test` is not used directly because the ruleset lives under `.semgrep/`
(a dot-directory, which Semgrep's test-mode config discovery excludes by design);
the mirror-scan script above is the equivalent fail-closed check and the one the
CI/pre-commit wiring invokes.

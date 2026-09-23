# Raw-SQL policy — repository Semgrep ruleset (#999, #1633)

This directory is the repository-owned Semgrep configuration for the **plan-only
database access** boundary across the TypeScript workers (`workers/catalog`,
`workers/users`) and the private geography pack. The ruleset is loaded by the
`semgrep` CI job and the pre-commit hook via `--config .semgrep`.

## The rule

| Rule | Language | Rejects |
|------|----------|---------|
| `ts-no-prisma-raw-escape` | TypeScript | The client's whole-query raw lane (``db.raw.sql`…` ``) and a hand-built `new RawExpr(...)`, in `workers/*/src` or `packages/prisma-geography/src` outside the sanctioned seam directories |

Until #1633 this was three rules — `ts-no-complete-sql-statement`,
`ts-no-sql-raw` and `ts-no-direct-neon` — written against Drizzle's shapes
(``sql`…` ``, `sql.raw(...)`, `neon(...)`). They guarded one invariant between
them: application code does not hand the database SQL the query layer never
built. When Drizzle left the repository those three patterns became unmatchable,
so all three would have gone green by absence while the invariant they protected
had a brand-new way to be broken. The one rule that replaced them is the same
invariant stated against the shapes that exist now.

### What it does NOT reject, deliberately

``fns.raw`…` `` / ``match.raw`…` `` inside a builder callback. Those are the
sanctioned fragment form, and the query layer is full of them — the gazetteer's
trigram ranking, every ingest predicate, the publish window. Their interpolations
are BOUND values, so no caller input reaches SQL text. A rule that caught them
would catch most of `src/`, which is why `.semgrep/tests/fixtures/approved/`
holds a real builder plan written in that form and the self-test asserts it
scans clean.

### Scope

- `paths.include: [/workers/catalog/src, /workers/users/src,
  /packages/prisma-geography/src]`; `test/` and `tests/` directories are already
  excluded by the default `.semgrepignore` patterns.
- The migration chain's own DDL is out of scope: the rule is TypeScript-only and
  never matches `.sql` files, and the chain's TypeScript lives outside the
  included paths.

## The sanctioned escape, by PATH

`paths.exclude` names **directories**, not files:

- `workers/catalog/src/db/` — the one construction site (`prisma.ts`) and the
  plan repairs beside it (`plans.ts`: the conflict clause and the server-clock
  write, neither of which the builder's surface can state).
- `workers/users/src/db/` — the same for the users worker.

The previous ruleset excluded single files
(`workers/catalog/src/db/expressions.ts`), which stops holding the moment a file
is renamed. A directory exclusion survives a rename inside it and does not
extend to a new file outside it — `scripts/semgrep-raw-sql-test.sh` proves the
second half by scanning the real seam modules from the seam path.

## Self-test

Run from the repo root:

    scripts/semgrep-raw-sql-test.sh

It fails closed and asserts each gate:

- **(a) Escape hatches FAIL, by name, ONE AT A TIME** — `.semgrep/tests/fixtures/
  forbidden/` holds one fixture per forbidden surface, and each is scanned in its
  own mirror tree; the finding must carry the rule id `ts-no-prisma-raw-escape`.
  The id is checked rather than the exit code, because `semgrep --error` also
  exits non-zero when it loaded no rules at all: a gate reading only the exit
  code would report "rejected" for a ruleset that had been deleted.

  One fixture per surface is the point. The two surfaces used to share a file and
  a single scan, with the gate asking only whether the id appeared somewhere —
  so either finding satisfied the whole check, and deleting the `$DB.raw.sql`
  branch from the rule left this gate green with that escape hatch wide open.
  The gate now also refuses to run with fewer fixtures than the rule has
  `pattern-either` branches, so emptying the directory cannot pass by proving
  nothing.
- **(b) Sanctioned shapes PASS** — the `fns.raw` builder-plan fixture and the
  real seam directories' modules must yield zero findings. Every copy is checked
  explicitly: these functions run from a `||` list, which suppresses `set -e`
  inside them, and a silently-skipped copy is how this script came to report
  "sanctioned exceptions pass" while scanning a tree missing the users seam that
  #1632 had deleted.
- **(c) Baseline clean** — the live `workers/*/src` trees must already be
  violation-free.

`semgrep --test` is not used directly because the ruleset lives under `.semgrep/`
(a dot-directory, which Semgrep's test-mode config discovery excludes by design);
the mirror-scan script above is the equivalent fail-closed check and the one the
CI/pre-commit wiring invokes.

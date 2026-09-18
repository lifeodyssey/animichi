import assert from "node:assert/strict";
import { test } from "node:test";
import { DATA_PLANE_ACCESS } from "../migrations/app/20260913T1711_data_plane_baseline/access.ts";
import emittedOperations from "../migrations/app/20260913T1711_data_plane_baseline/ops.json" with { type: "json" };

// #1591(b): the postcheck must assert the grants the migration issues, because
// `neon_superuser` membership answers has_table_privilege for every table
// regardless of ACL. These two files are the same claim in two places — the
// authored source and the sealed graph the migrator applies — so the test pins
// them together: editing one without re-emitting the other (node
// migrations/app/<dir>/migration.ts) fails here rather than shipping.

/** One `GRANT ... ON TABLE` as a caller of the operation reads it: who receives it, on which
 * table, and what they receive. */
interface TableGrant {
  readonly grantee: string;
  readonly table: string;
  readonly grants: string;
}

/** The table grants the operation ISSUES, read back out of its own DDL rather than imported
 * from the list that renders it. A grant the migration writes and no postcheck covers — the
 * defect this card is about — then fails here, and so does a postcheck for a grant it does not
 * write. `ON SCHEMA` and `ON SEQUENCE` carry no table and fall out of the pattern. */
function issuedTableGrants(): TableGrant[] {
  const statements = /GRANT (.+) ON TABLE (.+) TO (\w+)$/u;
  const issues = DATA_PLANE_ACCESS.execute
    .map(({ sql }) => statements.exec(sql))
    .filter((match) => match !== null);
  assert.equal(issues.length, DATA_PLANE_ACCESS.execute.filter(({ sql }) => sql.includes('ON TABLE')).length);
  return issues.flatMap(([, grants = '', tables = '', grantee = '']) =>
    tables.split(', ').map((qualified) => ({ grantee, table: qualified.replace('public.', ''), grants })));
}

/** The same three facts read back out of a postcheck step's failure text, which is what the
 * runner puts in `MIGRATION.POSTCHECK_FAILED`: a description that does not carry the role and
 * the table reports a divergence a reader cannot act on. */
const STATED_GRANT = /^verify (\w+)'s explicit grants on (\w+) are exactly ([A-Z, ]+?)(?: \(no [^)]*\))?$/u;

function statedTableGrants(): TableGrant[] {
  return DATA_PLANE_ACCESS.postcheck.flatMap(({ description, sql }) => {
    const match = STATED_GRANT.exec(description);
    if (match === null || !sql.includes('information_schema.role_table_grants')) return [];
    assert.match(sql, /WHERE grantee = '/u);
    const [, grantee = '', table = '', grants = ''] = match;
    return [{ grantee, table, grants }];
  });
}

void test("the sealed graph carries the operation the migration source declares", () => {
  const emitted = emittedOperations.find((operation) => operation.id === DATA_PLANE_ACCESS.id);
  assert.deepEqual(emitted, DATA_PLANE_ACCESS);
});

void test("every table grant the operation issues is checked by role and table, and nothing else is", () => {
  const issued = issuedTableGrants();
  const stated = statedTableGrants();
  assert.ok(issued.length > 50, `expected the whole matrix, read ${String(issued.length)} grants`);
  const ordered = (grants: readonly TableGrant[]) =>
    grants.map(({ grantee, table, grants: privileges }) => `${grantee} ${table} ${privileges}`).sort();
  assert.deepEqual(ordered(stated), ordered(issued));
  assert.equal(new Set(stated.map(({ grantee, table }) => `${grantee} ${table}`)).size, stated.length);
});

void test("no postcheck step reads effective privileges", () => {
  for (const { description, sql } of DATA_PLANE_ACCESS.postcheck) {
    assert.doesNotMatch(sql, /has_table_privilege/u, description);
  }
});

void test("the append-only step names the grants it forbids without claiming enforcement", () => {
  const step = DATA_PLANE_ACCESS.postcheck.find(({ description }) => description.includes("on pi_records are"));
  assert.ok(step);
  assert.match(step.description, /agent_svc's explicit grants on pi_records are exactly INSERT, SELECT/u);
  assert.match(step.description, /no UPDATE or DELETE grants/u);
  assert.doesNotMatch(step.description, /enforce|cannot/iu);
});

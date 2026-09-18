import assert from "node:assert/strict";
import { test } from "node:test";
import { DATA_PLANE_ACCESS } from "../migrations/app/20260913T1711_data_plane_baseline/access.ts";
import emittedOperations from "../migrations/app/20260913T1711_data_plane_baseline/ops.json" with { type: "json" };

// #1591(a): the postcheck must assert the grants the migration issues, because
// `neon_superuser` membership answers has_table_privilege for every table
// regardless of ACL. These two files are the same claim in two places — the
// authored source and the sealed graph the migrator applies — so the test pins
// them together: editing one without re-emitting the other (node
// migrations/app/<dir>/migration.ts) fails here rather than shipping.

const GRANTED_TABLES = [
  "pi_sessions",
  "pi_scalar_values",
  "pi_list_values",
  "agent_admissions",
  "agent_open_operations",
  "agent_settlements",
  "pi_records",
  "sessions",
  "turn_reservations",
  "anon_daily_message_count",
  "daily_usage",
] as const;

// One table's own step, matched on the whole phrase rather than the bare name: `sessions` is a
// substring of `pi_sessions`, so a name search would hand back another table's verdict and pass.
const stepFor = (table: string) =>
  DATA_PLANE_ACCESS.postcheck.find((candidate) => candidate.description.includes(`grants on ${table} are`));

void test("the sealed graph carries the operation the migration source declares", () => {
  const emitted = emittedOperations.find((operation) => operation.id === DATA_PLANE_ACCESS.id);
  assert.deepEqual(emitted, DATA_PLANE_ACCESS);
});

void test("every postcheck step reads explicit grants and names its table", () => {
  const steps = DATA_PLANE_ACCESS.postcheck;
  assert.equal(steps.filter((step) => step.sql.includes("information_schema.role_table_grants")).length, GRANTED_TABLES.length);
  for (const table of GRANTED_TABLES) {
    const step = stepFor(table);
    assert.ok(step, `no postcheck step names ${table}`);
    assert.match(step.sql, /information_schema\.role_table_grants/u);
    assert.doesNotMatch(step.sql, /has_table_privilege/u);
  }
});

void test("the append-only step names the grants it forbids without claiming enforcement", () => {
  const step = stepFor("pi_records");
  assert.ok(step);
  assert.match(step.description, /explicit grants/u);
  assert.match(step.description, /no UPDATE or DELETE grants/u);
  assert.doesNotMatch(step.description, /enforce|cannot/iu);
});

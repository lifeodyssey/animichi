import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT_SERVICE_ACCESS } from "../migrations/app/20260910T0407_native_agent_contract/access.ts";
import emittedOperations from "../migrations/app/20260910T0407_native_agent_contract/ops.json" with { type: "json" };

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
] as const;

void test("the sealed graph carries the operation the migration source declares", () => {
  const emitted = emittedOperations.find((operation) => operation.id === AGENT_SERVICE_ACCESS.id);
  assert.deepEqual(emitted, AGENT_SERVICE_ACCESS);
});

void test("every postcheck step reads explicit grants and names its table", () => {
  const steps = AGENT_SERVICE_ACCESS.postcheck;
  assert.equal(steps.length, GRANTED_TABLES.length);
  for (const table of GRANTED_TABLES) {
    const step = steps.find((candidate) => candidate.description.includes(table));
    assert.ok(step, `no postcheck step names ${table}`);
    assert.match(step.sql, /information_schema\.role_table_grants/u);
    assert.doesNotMatch(step.sql, /has_table_privilege/u);
  }
});

void test("the append-only step names the grants it forbids without claiming enforcement", () => {
  const step = AGENT_SERVICE_ACCESS.postcheck.find((candidate) => candidate.description.includes("pi_records"));
  assert.ok(step);
  assert.match(step.description, /explicit grants/u);
  assert.match(step.description, /no UPDATE or DELETE grants/u);
  assert.doesNotMatch(step.description, /enforce|cannot/iu);
});

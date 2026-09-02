/**
 * W1-2 lane contract (#1251). The agent-tier database arm is a separate lane
 * for the same reason `bundle-smoke/` is one: it needs Docker and the offline
 * `animichi-test-postgres` image, which the node:test suite must never need.
 * It also keeps its own directory rather than joining the W0-S4 spike's
 * `db-test/`: that lane fails closed without a `SPIKE_TEST_DATABASE_URL` it
 * expects someone else to provision, and it is deleted when the spike closes.
 *
 * It is deliberately NOT in `gate_edge` yet. That gate is also CI's
 * `CI / affected (edge)` leg, and that leg builds no Postgres image — wiring it
 * in means changing two contracts this repo pins on purpose (the image step's
 * `if:` in `.github/scripts/test_pr_verification_contract.rb`, scoped to
 * agent/db/catalog, and the edge `ci_lanes` list pinned by
 * `bundle-smoke-lane.test.ts`). Until an owner makes that call, what CAN be
 * pinned is that the lane exists under one exact name, is documented where an
 * agent will read it, and never reaches a deploy.
 *
 * test-type: unit (reads checked-in files; no network, no clock).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string): string => readFileSync(`${ROOT}${path}`, "utf8");

interface EdgePackageManifest {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
}
const EDGE_PACKAGE = JSON.parse(read("workers/edge/package.json")) as EdgePackageManifest;

interface ComponentManifest {
  components: { name: string; deploy_excludes: string[] }[];
}
const MANIFEST = JSON.parse(read(".github/ci/components.json")) as ComponentManifest;

void test("the database arm runs under one exact command, apart from the spike lane", () => {
  assert.equal(EDGE_PACKAGE.scripts["test:agent-db"], 'node --test "agent-db-test/*.test.ts"');
  assert.equal(EDGE_PACKAGE.scripts["test:spike-db"], 'node --test "db-test/*.test.ts"');
});

void test("the arm and its Docker prerequisite are documented where an agent reads", () => {
  assert.match(read("workers/edge/AGENTS.md"), /pnpm run test:agent-db/);
  assert.match(read("workers/edge/agent-db-test/README.md"), /animichi-test-postgres:18-3\.6-pgvector-0\.8\.5/);
});

void test("neither database lane is part of the deployed edge", () => {
  const edge = MANIFEST.components.find((component) => component.name === "edge");
  assert.ok(edge?.deploy_excludes.includes("workers/edge/agent-db-test/**"));
  assert.ok(edge?.deploy_excludes.includes("workers/edge/db-test/**"));
  assert.equal(typeof EDGE_PACKAGE.devDependencies.testcontainers, "string");
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";

// #1050 AC3 proof (issue #1051 amendment 2): the migrator applies the committed chain on a
// disposable branch, runtime roles unchanged — include the test/evidence in this diff.
//
// This is the machine-checkable half of "runtime roles unchanged": applying the committed chain
// to ANY disposable branch must leave the runtime role matrix exactly as it found it. The chain
// that used to be read here was Atlas's, and it CREATED those roles; the Prisma chain does not
// (spec §4.8.5, as #1915 amended it, puts role DDL in the migrator's SQL step, outside the
// chain), which makes the claim narrower and stronger:
//   - the chain never creates, drops, reassigns or alters a runtime role — it PRECHECKS them;
//   - every runtime role is still granted by the chain, so a role that vanished from the matrix
//     would be a role the data plane silently stopped serving;
//   - the migrator LOGIN is IaC's, and the chain grants it nothing.
//
// test-type: unit (reads the checked-in migration modules; no network, no clock, no mocks).

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CHAIN = `${ROOT}packages/pi-session-neon/migrations/app/`;
const RUNTIME_ROLES = ["catalog_svc", "users_svc", "agent_svc", "jobs_svc", "readonly"];

/** Every authored module of the chain, joined: the emitted `ops.json` beside them is derived
 * from exactly this source, so a claim proved here is a claim about what gets executed. */
function chainSource(): string {
  return readdirSync(CHAIN, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => readdirSync(`${CHAIN}${entry.name}`)
      .filter((file) => file.endsWith(".ts"))
      .map((file) => readFileSync(`${CHAIN}${entry.name}/${file}`, "utf8")))
    .join("\n");
}

const chain = chainSource();

void test("the chain never creates or mutates a runtime role", () => {
  const mutation = /(create\s+role|drop\s+(role|owned)|reassign\s+owned|alter\s+role)/gi;
  const offenders = [...chain.matchAll(mutation)]
    .map((match) => chain.slice(Math.max(0, match.index - 120), match.index + 120))
    .filter((window) => RUNTIME_ROLES.some((role) => new RegExp(`\\b${role}\\b`, "i").test(window)));
  assert.deepEqual(offenders, [], "role DDL belongs to the migrator's SQL step, outside the chain (spec §4.8.5 as amended by #1915); the chain only prechecks");
});

void test("the chain prechecks every runtime role and grants to each of them", () => {
  for (const role of RUNTIME_ROLES) {
    assert.match(chain, new RegExp(`'${role}'`), `the role precheck must list ${role}`);
    assert.match(chain, new RegExp(`TO [^\\n]*${role}\\b`, "i"), `the chain must grant to ${role}`);
  }
});

void test("the migrator role is not a runtime-serving role in the chain", () => {
  assert.doesNotMatch(chain, /CREATE ROLE migrator\b/i, "IaC owns the migrator LOGIN");
  assert.doesNotMatch(chain, /TO migrator\b/i, "the chain must not grant runtime privileges to migrator");
});

void test("database-access IaC provisions the migrator LOGIN role + DSN secret", () => {
  const infra = readFileSync(`${ROOT}infra/database-access/index.ts`, "utf8");
  assert.match(infra, /name: "migrator"/);
  assert.match(infra, /secretName: "MIGRATOR_DATABASE_URL"/);
});

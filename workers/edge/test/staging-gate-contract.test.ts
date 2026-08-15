import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";

// #1054 AC2/AC4 — the verifier is the SAME shared module as the migrator's:
// one implementation (@animichi/contract/oidc-github), two doors (the migrator
// #1051 and the staging gate #1054), each with a DISTINCT audience so a token
// minted for one door can never be replayed against the other (spec §"DISTINCT
// per-service audiences", seat-1 finding c). Read verbatim from both policy
// files so a drift to a second verifier implementation or a collapsed audience
// fails this file red.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const migratorPolicy = readFileSync(ROOT + "workers/migrator/src/policy.ts", "utf8");
const gatePolicy = readFileSync(ROOT + "workers/edge/src/staging-gate/policy.ts", "utf8");

// The shared module is the only verifier implementation either door may import.
void test("both the migrator and the staging gate import the shared oidc-github module", () => {
  const doors: [string, string][] = [["migrator", migratorPolicy], ["staging-gate", gatePolicy]];
  for (const [name, source] of doors) {
    assert.match(source, /@animichi\/contract\/oidc-github/, name + " must reuse the shared verifier module");
    assert.match(source, /GitHubOidcPolicy/, name + " builds a GitHubOidcPolicy from the shared module");
  }
});

void test("the migrator and staging-gate audiences are DISTINCT", () => {
  const migratorAud = /MIGRATOR_OIDC_AUDIENCE\s*=\s*"([^"]+)"/.exec(migratorPolicy)?.[1];
  const gateAud = /STAGING_GATE_OIDC_AUDIENCE\s*=\s*"([^"]+)"/.exec(gatePolicy)?.[1];
  assert.ok(migratorAud, "migrator audience constant must exist");
  assert.ok(gateAud, "staging-gate audience constant must exist");
  assert.ok(migratorAud !== gateAud, "the two doors must use distinct audiences (cross-service token replay guard)");
  assert.match(gateAud, /^animichi:github-actions:staging-gate$/, "staging-gate audience must carry the door's stem");
  assert.match(migratorAud, /^animichi:github-actions:migrator$/, "migrator audience must keep its own door's stem");
});
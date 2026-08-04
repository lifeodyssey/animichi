/** Staging topology with a malformed `stagingAllowedIps` entry.
 *
 * Separate file because `index.ts` builds at import time and a process can
 * load it once — see `testing/harness.ts`. The allowlist value is
 * interpolated into a firewall expression, so a non-IP entry must fail the
 * build loudly instead of producing a broken rule. The build-time throw
 * surfaces as an engine-side serialization rejection that is not catchable
 * on the build promise, so the rejection path is pinned directly on
 * `buildIpClause`; the valid path is covered in `topology-staging.test.ts`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStack, ofType, type Built } from "./testing/harness.ts";

const RULESET = "cloudflare:index/ruleset:Ruleset";

// Installs mocks + config and loads index.ts, so the module-level resources
// never attempt a real engine RPC; the helper import below reuses that load.
const built: Built[] = await buildStack("staging", {
  cloudflareAccountId: "acct",
  cloudflareZoneId: "zone",
  webRoutesEnabled: "true",
  stagingDomain: "staging.animichi.com",
  stagingGateEnabled: "true",
  stagingGateToken: "test-token-not-a-real-secret",
});

const { buildIpClause } = await import("./index.ts");

test("the gate ruleset still builds when the allowlist is absent", () => {
  const gates = ofType(built, RULESET).filter(
    (r) => r.inputs.phase === "http_request_firewall_custom",
  );
  assert.equal(gates.length, 1);
});

test("buildIpClause throws on a non-IP entry", () => {
  assert.throws(
    () => buildIpClause('1.2.3.4, evil"input'),
    /stagingAllowedIps entry "evil"input" is not a valid IP or CIDR/,
  );
});

test("buildIpClause throws on an out-of-range IPv4 octet", () => {
  assert.throws(
    () => buildIpClause("999.1.1.1"),
    /stagingAllowedIps entry "999\.1\.1\.1" is not a valid IP or CIDR/,
  );
});

test("buildIpClause throws on an out-of-range CIDR prefix", () => {
  assert.throws(
    () => buildIpClause("10.0.0.0/40"),
    /stagingAllowedIps entry "10\.0\.0\.0\/40" is not a valid IP or CIDR/,
  );
});

test("buildIpClause joins valid entries space-separated", () => {
  assert.equal(
    buildIpClause(" 1.2.3.4, 203.0.113.0/24 , "),
    " and not (ip.src in {1.2.3.4 203.0.113.0/24})",
  );
});

test("buildIpClause returns an empty clause for an empty list", () => {
  assert.equal(buildIpClause(" , ,"), "");
});

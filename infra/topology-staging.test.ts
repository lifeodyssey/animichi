/** Staging topology with both flags ON.
 *
 * Separate file because `index.ts` builds at import time and a process can
 * load it once — see `testing/harness.ts`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStack, only, ofType, unseal, type Built } from "./testing/harness.ts";

const built: Built[] = await buildStack("staging", {
  cloudflareAccountId: "acct",
  cloudflareZoneId: "zone",
  webRoutesEnabled: "true",
  stagingDomain: "staging.animichi.com",
  stagingGateEnabled: "true",
  stagingGateToken: "test-token-not-a-real-secret",
});

const CUSTOM_DOMAIN = "cloudflare:index/workersCustomDomain:WorkersCustomDomain";
const ROUTE = "cloudflare:index/workersRoute:WorkersRoute";
const DNS = "cloudflare:index/dnsRecord:DnsRecord";
const RULESET = "cloudflare:index/ruleset:Ruleset";

test("staging targets the stack-suffixed Workers, not the production ones", () => {
  const domain = only(built, CUSTOM_DOMAIN);
  assert.equal(domain.inputs.hostname, "staging.animichi.com");
  assert.equal(domain.inputs.service, "animichi-web-staging");
});

test("staging gets the SAME three edge routes as prod", () => {
  // The bug this exists to prevent: a staging hostname pointed wholly at the
  // web Worker. `apps/web` calls `/v1/chat` on its own origin, so that
  // configuration leaves staging with no chat API at all — and nothing else
  // in the pipeline would notice.
  const patterns = ofType(built, ROUTE).map((r) => r.inputs.pattern).sort();
  assert.deepEqual(patterns, [
    "staging.animichi.com/healthz",
    "staging.animichi.com/img/*",
    "staging.animichi.com/v1/*",
  ]);
  for (const route of ofType(built, ROUTE)) {
    assert.equal(route.inputs.script, "animichi-staging");
  }
});

test("no www placeholder and no redirect on staging", () => {
  assert.deepEqual(ofType(built, DNS), []);
  const rulesets = ofType(built, RULESET).map((r) => r.name);
  assert.deepEqual(rulesets, ["staging-access-gate"]);
});

test("the WAF gate blocks, and matches the staging host", () => {
  const rules = unseal(only(built, RULESET).inputs.rules).value as Record<string, unknown>[];
  assert.equal(rules[0].action, "block");
  const expression = String(rules[0].expression);
  assert.match(expression, /http\.host eq "staging\.animichi\.com"/);
  assert.match(expression, /not \(http\.cookie contains "animichi_staging=/);
  assert.match(expression, /not \(any\(http\.request\.headers\["x-staging-key"\]/);
});

test("the gate rule is sealed as a SECRET before it reaches state", () => {
  // The load-bearing one for a public repo. `pulumi stack export` runs before
  // every `pulumi up` and lands in R2; anything not marked secret is written
  // there in the clear. Note the seal propagated to the WHOLE rules array, not
  // just the expression string, so the token cannot leak via a sibling field.
  //
  // Mutation-tested, and the result is worth recording because it is not the
  // obvious one: dropping `pulumi.secret(...)` alone does NOT fail this, and
  // downgrading `requireSecret` to `require` alone does NOT either. Each is
  // sufficient on its own — secretness is viral through `pulumi.interpolate`,
  // and `pulumi.secret` forces it regardless of the input. Only removing BOTH
  // fails this test. That is the correct sensitivity for a defence-in-depth
  // invariant: it asserts the property (sealed), not either mechanism, so
  // refactoring one away stays green while actually losing the seal goes red.
  assert.equal(unseal(only(built, RULESET).inputs.rules).isSecret, true);
});

test("the www redirect on prod is NOT secret — the seal is not blanket", () => {
  // Guards the test above from being vacuous: if every input came back sealed,
  // the secret assertion would pass no matter what the code did.
  const routes = ofType(built, ROUTE);
  assert.ok(routes.length > 0);
  assert.equal(unseal(routes[0].inputs.pattern).isSecret, false);
});

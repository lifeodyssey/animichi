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
  stagingAllowedIps: "1.2.3.4, 203.0.113.0/24",
});

const CUSTOM_DOMAIN = "cloudflare:index/workersCustomDomain:WorkersCustomDomain";
const ROUTE = "cloudflare:index/workersRoute:WorkersRoute";
const DNS = "cloudflare:index/dnsRecord:DnsRecord";
const RULESET = "cloudflare:index/ruleset:Ruleset";
const ZONE_DNSSEC = "cloudflare:index/zoneDnssec:ZoneDnssec";
const ZONE_SETTING = "cloudflare:index/zoneSetting:ZoneSetting";

test("staging targets the stack-suffixed Workers, not the production ones", () => {
  const domain = only(built, CUSTOM_DOMAIN);
  assert.equal(domain.inputs.hostname, "staging.animichi.com");
  assert.equal(domain.inputs.service, "animichi-web-staging");
});

test("staging gets the SAME API and map routes as prod", () => {
  // The bug this exists to prevent: a staging hostname pointed wholly at the
  // web Worker. `apps/web` calls `/v1/chat` on its own origin, so that
  // configuration leaves staging with no chat API at all — and nothing else
  // in the pipeline would notice.
  const patterns = ofType(built, ROUTE).map((r) => r.inputs.pattern).sort();
  assert.deepEqual(patterns, [
    "staging.animichi.com/healthz",
    "staging.animichi.com/img/*",
    "staging.animichi.com/tiles/*",
    "staging.animichi.com/v1/*",
  ]);
  for (const route of ofType(built, ROUTE)) {
    assert.equal(route.inputs.zoneId, "zone", "a route on the wrong zone matches nothing");
    assert.equal(route.inputs.script, "animichi-staging");
  }
});

test("no www placeholder and no redirect on staging", () => {
  assert.deepEqual(ofType(built, DNS).filter((r) => r.inputs.name === "www.animichi.com"), []);
  const rulesets = ofType(built, RULESET).map((r) => r.name).sort();
  assert.deepEqual(rulesets, ["staging-access-gate"]);
});

test("staging declares no CAA records — prod owns the zone certificates", () => {
  // PR #776: zone hardening is prod-only. A staging CAA record would pin a
  // hostname on the same zone the prod stack manages.
  assert.deepEqual(ofType(built, DNS).filter((r) => r.inputs.type === "CAA"), []);
});

test("the WAF gate blocks, and matches the staging host", () => {
  const gate = ofType(built, RULESET).find((r) => r.name === "staging-access-gate");
  assert.ok(gate, "staging access gate missing");
  const rules = unseal(gate.inputs.rules).value as Record<string, unknown>[];
  assert.equal(rules[0].action, "block");
  const expression = String(rules[0].expression);
  assert.match(expression, /http\.host eq "staging\.animichi\.com"/);
  assert.match(expression, /not \(http\.cookie contains "animichi_staging=/);
  assert.match(expression, /not \(any\(http\.request\.headers\["x-staging-key"\]/);
  // #769: the allowlist clause is space-separated inside the braces, and the
  // exchange path passes through ahead of any future endpoint existing.
  assert.match(expression, /not \(ip\.src in \{1\.2\.3\.4 203\.0\.113\.0\/24\}\)/);
  assert.match(expression, /not \(http\.request\.uri\.path eq "\/staging-gate\/exchange"\)/);
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
  const gate = ofType(built, RULESET).find((r) => r.name === "staging-access-gate");
  assert.ok(gate, "staging access gate missing");
  assert.equal(unseal(gate.inputs.rules).isSecret, true);
});

test("staging owns none of the zone-hardening resources", () => {
  // PR #776: prod is the single owner of zone metadata. Two stacks declaring
  // the same zone resources (DNSSEC, security header, rate-limit ruleset)
  // would fight over them on `pulumi up`, so staging must expect NONE of them
  // even with zoneId and routes configured.
  assert.deepEqual(ofType(built, ZONE_DNSSEC), []);
  assert.deepEqual(ofType(built, ZONE_SETTING), []);
  const rateLimit = ofType(built, RULESET).find((r) => r.name === "animichi-api-rate-limit");
  assert.equal(rateLimit, undefined, "staging must not declare the rate-limit ruleset");
});

test("an ordinary input on this same stack is NOT sealed", () => {
  // Control for the test above. If `unseal` reported everything as secret —
  // a wrong sentinel, a changed wire format — that assertion would pass no
  // matter what the code did. A route pattern is the nearest non-secret input.
  //
  // Named for what it does. The first version called itself "the www redirect
  // on prod is NOT secret", which was wrong twice over: this file builds
  // staging, and the assertion is on a route pattern, not the redirect.
  const routes = ofType(built, ROUTE);
  assert.ok(routes.length > 0);
  assert.equal(unseal(routes[0].inputs.pattern).isSecret, false);
});

test("staging map bucket is isolated from production", () => {
  const buckets = ofType(built, "cloudflare:index/r2Bucket:R2Bucket");
  assert.equal(buckets.length, 2);
  assert.deepEqual(buckets.map((bucket) => bucket.inputs.name), ["catalog-media-staging", "map-tiles-staging"]);
  assert.equal(buckets.every((bucket) => bucket.inputs.accountId === "acct"), true);
});

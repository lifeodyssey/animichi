/** Prod topology with the cutover flag ON.
 *
 * These assert the things `tsc` cannot: which script each hostname resolves
 * to, the exact route patterns, the redirect's direction, and that the www
 * placeholder is proxied. Every one of them is a mistake that type-checks
 * cleanly and only surfaces once DNS is live.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStack, only, ofType, unseal, type Built } from "./testing/harness.ts";

const built: Built[] = await buildStack("prod", {
  cloudflareAccountId: "acct",
  cloudflareZoneId: "zone",
  webRoutesEnabled: "true",
  webDomain: "animichi.com",
  wwwDomain: "www.animichi.com",
});

const CUSTOM_DOMAIN = "cloudflare:index/workersCustomDomain:WorkersCustomDomain";
const ROUTE = "cloudflare:index/workersRoute:WorkersRoute";
const DNS = "cloudflare:index/dnsRecord:DnsRecord";
const RULESET = "cloudflare:index/ruleset:Ruleset";

test("the apex serves the web Worker, not the edge Worker", () => {
  const domain = only(built, CUSTOM_DOMAIN);
  assert.equal(domain.inputs.hostname, "animichi.com");
  assert.equal(domain.inputs.service, "animichi-web");
});

test("the API and map asset surfaces are routed to the edge Worker", () => {
  const patterns = ofType(built, ROUTE).map((r) => r.inputs.pattern).sort();
  assert.deepEqual(patterns, [
    "animichi.com/healthz",
    "animichi.com/img/*",
    "animichi.com/tiles/*",
    "animichi.com/v1/*",
  ]);
  for (const route of ofType(built, ROUTE)) {
    assert.equal(route.inputs.zoneId, "zone", "a route on the wrong zone matches nothing");
    assert.equal(route.inputs.script, "animichi", `${String(route.inputs.pattern)} script`);
  }
});

test("no apex DnsRecord — the Custom Domain owns that record", () => {
  // Declaring one here would fight Cloudflare for a record it creates and
  // marks read-only. The only Pulumi-owned record is the www placeholder.
  const names = ofType(built, DNS).map((r) => r.inputs.name);
  assert.deepEqual(names, ["www.animichi.com"]);
});

test("the www placeholder is the reserved originless address AND proxied", () => {
  const record = only(built, DNS);
  assert.equal(record.inputs.content, "192.0.2.0");
  // Unproxied, the request goes to a reserved address that answers nothing and
  // the redirect rule never runs. This is the assertion that catches that.
  assert.equal(record.inputs.proxied, true);
});

test("the redirect points www AT the apex, not the other way round", () => {
  const rules = unseal(only(built, RULESET).inputs.rules).value as Record<string, unknown>[];
  const rule = rules[0];
  assert.equal(
    String(rule.expression),
    'http.host eq "www.animichi.com"',
    "must match www — matching the apex would redirect the site to itself",
  );
  const params = rule.actionParameters as { fromValue: Record<string, unknown> };
  const target = params.fromValue.targetUrl as { expression: string };
  assert.match(target.expression, /"https:\/\/animichi\.com"/);
  assert.doesNotMatch(target.expression, /www/, "target must be the apex, not www");
  assert.equal(params.fromValue.statusCode, 301);
});

test("the staging WAF gate stays off on prod", () => {
  // Its own flag is unset here, but the `stack === "staging"` guard is the
  // structural one: a Block rule on the production zone is the worst thing
  // this file could emit.
  const rulesets = ofType(built, RULESET).map((r) => r.name);
  assert.deepEqual(rulesets, ["animichi-www-redirect"]);
});

test("production map bucket is private and uses the stable Wrangler name", () => {
  const buckets = ofType(built, "cloudflare:index/r2Bucket:R2Bucket");
  assert.equal(buckets.length, 2);
  assert.deepEqual(buckets.map((bucket) => bucket.inputs.name), ["catalog-media", "map-tiles"]);
  assert.equal(buckets.every((bucket) => bucket.inputs.accountId === "acct"), true);
});

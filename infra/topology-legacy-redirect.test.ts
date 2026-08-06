/** Prod topology with legacy domains onboarded.
 *
 * The `legacyRedirectZones` config is the manual-ops switch for the retired
 * production domains (`seichijunrei.app` / `seichijunrei.zhenjia.dev`, per the
 * seo-geo-plan §3 migration checklist and the iter-0 AC): each entry is the
 * zone id of a legacy domain whose DNS is delegated to Cloudflare. This file
 * pins the rule shape for that permutation; `topology-prod.test.ts` pins the
 * no-op default (no config → no ruleset).
 *
 * `WEB_DOMAIN` is deliberately NOT the real prod apex: the redirect target
 * must follow the configured domain, so a hardcoded `animichi.com` in
 * `index.ts` has to fail here instead of silently passing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStack, only, ofType, unseal, type Built } from "./testing/harness.ts";

const WEB_DOMAIN = "apex.example.com";

const built: Built[] = await buildStack("prod", {
  cloudflareAccountId: "acct",
  cloudflareZoneId: "zone",
  webRoutesEnabled: "true",
  webDomain: WEB_DOMAIN,
  wwwDomain: "www.apex.example.com",
  legacyRedirectZones: '["legacy-zone-1", "legacy-zone-2"]',
});

const { validateLegacyRedirectZones } = await import("./index.ts");

const RULESET = "cloudflare:index/ruleset:Ruleset";

const legacyRulesets = (): Built[] =>
  ofType(built, RULESET).filter((r) => r.name.startsWith("animichi-legacy-redirect-"));

const legacyRule = (ruleset: Built): Record<string, unknown> =>
  (unseal(ruleset.inputs.rules).value as Record<string, unknown>[])[0];

test("the apex still serves the web Worker (presence anchor)", () => {
  const domain = only(built, "cloudflare:index/workersCustomDomain:WorkersCustomDomain");
  assert.equal(domain.inputs.hostname, WEB_DOMAIN);
  assert.equal(domain.inputs.service, "animichi-web");
});

test("each onboarded legacy zone gets one ruleset, in its own zone", () => {
  const legacy = legacyRulesets();
  assert.equal(legacy.length, 2, "one ruleset per legacy zone id");
  assert.deepEqual(
    legacy.map((r) => r.inputs.zoneId).sort(),
    ["legacy-zone-1", "legacy-zone-2"],
    "the ruleset must live in the legacy zone, not the apex zone",
  );
});

test("each legacy ruleset is a zone-phase redirect matching every request", () => {
  for (const ruleset of legacyRulesets()) {
    assert.equal(ruleset.inputs.phase, "http_request_dynamic_redirect");
    const rule = legacyRule(ruleset);
    assert.equal(rule.action, "redirect");
    assert.equal(String(rule.expression), "true");
  }
});

test("the rule 301s onto the configured apex, preserving path and query", () => {
  for (const ruleset of legacyRulesets()) {
    const params = legacyRule(ruleset).actionParameters as { fromValue: Record<string, unknown> };
    assert.equal(params.fromValue.statusCode, 301);
    assert.equal(params.fromValue.preserveQueryString, true);
    const expression = (params.fromValue.targetUrl as { expression: string }).expression;
    assert.ok(expression.includes(`"https://${WEB_DOMAIN}"`), "targets the configured apex");
    assert.match(expression, /http\.request\.uri\.path/, "path preserved, not dropped");
  }
});

test("ruleset identity derives from the zone id, not the list position", () => {
  for (const ruleset of legacyRulesets()) {
    assert.ok(ruleset.name.includes(ruleset.inputs.zoneId as string));
    assert.ok((ruleset.inputs.name as string).includes(ruleset.inputs.zoneId as string));
  }
});

test("validateLegacyRedirectZones accepts unique zone ids", () => {
  assert.doesNotThrow(() => validateLegacyRedirectZones(["legacy-zone-1", "legacy-zone-2"]));
});

test("validateLegacyRedirectZones throws on duplicate zone ids", () => {
  assert.throws(
    () => validateLegacyRedirectZones(["legacy-zone-1", "legacy-zone-1"]),
    /legacyRedirectZones lists "legacy-zone-1" more than once/,
  );
});

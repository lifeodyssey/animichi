/** Prod topology with legacy domains onboarded.
 *
 * The `legacyRedirectZones` config is the manual-ops switch for the retired
 * production domains (`seichijunrei.app` / `seichijunrei.zhenjia.dev`, per the
 * seo-geo-plan §3 migration checklist and the iter-0 AC): each entry is the
 * zone id of a legacy domain whose DNS is delegated to Cloudflare. This file
 * pins the rule shape for that permutation; `topology-prod.test.ts` pins the
 * no-op default (no config → no ruleset).
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
  legacyRedirectZones: '["legacy-zone-1", "legacy-zone-2"]',
});

const RULESET = "cloudflare:index/ruleset:Ruleset";

test("the apex still serves the web Worker (presence anchor)", () => {
  const domain = only(built, "cloudflare:index/workersCustomDomain:WorkersCustomDomain");
  assert.equal(domain.inputs.hostname, "animichi.com");
  assert.equal(domain.inputs.service, "animichi-web");
});

test("each onboarded legacy zone gets one 301 ruleset in its own zone", () => {
  const legacy = ofType(built, RULESET).filter((r) => r.name.startsWith("animichi-legacy-redirect-"));
  assert.equal(legacy.length, 2, "one ruleset per legacy zone id");
  assert.deepEqual(
    legacy.map((r) => r.inputs.zoneId).sort(),
    ["legacy-zone-1", "legacy-zone-2"],
    "the ruleset must live in the legacy zone, not the animichi.com zone",
  );
  for (const ruleset of legacy) {
    assert.equal(ruleset.inputs.phase, "http_request_dynamic_redirect");
    const rule = (unseal(ruleset.inputs.rules).value as Record<string, unknown>[])[0];
    assert.equal(rule.action, "redirect");
    assert.equal(
      String(rule.expression),
      "true",
      "the whole legacy zone is one redirect target — it exists solely to 301",
    );
    const params = rule.actionParameters as { fromValue: Record<string, unknown> };
    assert.equal(params.fromValue.statusCode, 301);
    assert.equal(params.fromValue.preserveQueryString, true);
    const target = params.fromValue.targetUrl as { expression: string };
    assert.match(target.expression, /"https:\/\/animichi\.com"/);
    assert.match(target.expression, /http\.request\.uri\.path/, "path preserved, not dropped");
    assert.doesNotMatch(target.expression, /legacy-zone/, "target must be the apex");
  }
});

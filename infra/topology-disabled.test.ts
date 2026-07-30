/** Both flags OFF — the default every stack ships with today.
 *
 * This is the assertion that makes the flags meaningful. If the gate ever
 * stops gating, DNS and a WAF Block rule appear on a live zone the next time
 * anyone runs `pulumi up`, with no code change to point at.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStack, type Built } from "./testing/harness.ts";

// Only the account id — deliberately none of the domain/zone keys. If the
// program reaches for them while disabled, `config.require` throws and the
// import fails, which is itself the finding.
const built: Built[] = await buildStack("prod", { cloudflareAccountId: "acct" });

test("the R2 bucket is the only thing an ungated stack creates", () => {
  const types = built.map((r) => r.type);
  assert.deepEqual(types, ["cloudflare:index/r2Bucket:R2Bucket"]);
});

test("nothing that could publish the site is declared", () => {
  const publishing = built.filter((r) => /workersCustomDomain|workersRoute|dnsRecord|ruleset/i.test(r.type));
  assert.deepEqual(
    publishing.map((r) => `${r.type} ${r.name}`),
    [],
    "a resource here means the default-off flag no longer gates the cutover",
  );
});

/** An unrecognised stack must refuse to build rather than inherit a hostname.
 *
 * Codex review of #571 found this: every non-prod stack reads `stagingDomain`,
 * and the natural way to bootstrap a new stack is copying
 * `Pulumi.staging.yaml` — which carries `staging.animichi.com`. The new stack
 * would provision its own Workers against staging's hostname and take it over
 * on the next `pulumi up`, with nothing in the diff obviously wrong.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStack } from "./testing/harness.ts";

test("a stack with no hostname mapping throws instead of claiming staging's", async () => {
  await assert.rejects(
    () =>
      buildStack("preview", {
        cloudflareAccountId: "acct",
        cloudflareZoneId: "zone",
        webRoutesEnabled: "true",
        // Exactly what copying Pulumi.staging.yaml would give you.
        stagingDomain: "staging.animichi.com",
      }),
    /stack "preview" has no hostname mapping/,
  );
});

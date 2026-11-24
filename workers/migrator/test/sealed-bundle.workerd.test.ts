import { afterAll, describe, expect, it } from "vitest";
import { bootSealedMigrator, discardSealedRelease } from "./sealed-bundle";
import { TARGET } from "./sealed-migrations";
import { profileSealedStartup } from "./sealed-startup";
import { pinsSuiteBudget } from "./suite-budget-pin";
import { SEALED_BUNDLE_BUDGET_MS } from "./test-timeout-budget";

// SUT: the sealed migrator bundle CD publishes, built once by the release script and observed
// twice: started in workerd, and profiled by `wrangler check startup`. `build-worker.test.sh` proves
// it bundles; these prove it starts. Every CD step after the publish — `/healthz`, `/preflight`,
// `/migrate`, `/catalog-schema` — is served by this one bundle.
//
// Cloudflare refuses a Worker whose startup, the evaluation of its global scope, takes longer than a
// second, so Prisma control loads on the first call that needs it (`src/prisma-first-use.ts`). The
// boot proves the global scope evaluates to its end, the Durable Object class included. The profile
// proves that evaluation runs no Prisma control or ArkType, but it is no evidence of a successful
// start: a global scope that throws can read as an empty, fast start. Its count stands only beside
// this file's boot of the same release. Neither starts Prisma control itself. Its first call does,
// in `test/integration/prisma.workerd.integration.ts` and in every CD preflight.

let sealed: Awaited<ReturnType<typeof bootSealedMigrator>> | undefined;
afterAll(async () => { await sealed?.close(); await discardSealedRelease(); });

describe("the sealed migrator bundle in workerd", { timeout: SEALED_BUNDLE_BUDGET_MS }, () => {
  pinsSuiteBudget(SEALED_BUNDLE_BUDGET_MS);

  it("starts and answers /healthz with the schema identity it carries", async () => {
    sealed = await bootSealedMigrator();
    const response = await sealed.worker.dispatchFetch("https://migrator.test/healthz");
    expect({ status: response.status, body: await response.json() }).toMatchObject({
      status: 200, body: { status: "ok", service: "migrator", prismaTarget: TARGET },
    });
  });

  it("starts without running Prisma control or ArkType", async () => {
    const startup = await profileSealedStartup();
    expect(startup.prismaSourcesInBundle).toBeGreaterThan(0);
    expect(startup.prismaSamplesAtStartup).toBe(0);
  });
});

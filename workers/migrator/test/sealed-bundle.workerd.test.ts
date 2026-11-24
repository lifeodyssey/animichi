import { afterAll, describe, expect, it } from "vitest";
import { bootSealedMigrator, discardSealedRelease } from "./sealed-bundle";
import { TARGET } from "./sealed-migrations";
import { preflightSealedMigrator } from "./sealed-preflight";
import { profileSealedStartup } from "./sealed-startup";
import { pinsSuiteBudget } from "./suite-budget-pin";
import { SEALED_BUNDLE_BUDGET_MS } from "./test-timeout-budget";

// SUT: the sealed migrator bundle CD publishes, built once by the release script and observed three
// ways: started in workerd, profiled by `wrangler check startup`, and sent a preflight.
// `build-worker.test.sh` proves it bundles; these prove it starts, and that Prisma control then
// loads in it. Every CD step after the publish — `/healthz`, `/preflight`, `/migrate`,
// `/catalog-schema` — is served by this one bundle.
//
// Cloudflare refuses a Worker whose startup, the evaluation of its global scope, takes longer than a
// second, so Prisma control loads on the first call that needs it (`src/prisma-first-use.ts`). The
// boot proves the global scope evaluates to its end, the Durable Object class included. The profile
// proves that evaluation runs no Prisma control or ArkType, but it is no evidence of a successful
// start: a global scope that throws can read as an empty, fast start. Its count stands only beside
// this file's boot of the same release. The preflight proves Prisma control's first load: the
// snapshot store at the bundle handshake, then the control surface the preview needs, whose
// connection to a port nothing listens on Prisma reports as `DRIVER.CONNECTION_FAILED`. A load that
// fails is answered `preflight_unavailable` instead, so that code is the proof, and what loaded is
// what the release script bundled, the `fdir` alias in `wrangler.toml` included.
// `test/integration/prisma.workerd.integration.ts` runs the same load against a real database, on a
// build of its own.

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

  it("loads Prisma control on its first preview, which then fails only at the database", async () => {
    expect(await preflightSealedMigrator())
      .toEqual({ status: 422, body: { compatible: false, error: "DRIVER.CONNECTION_FAILED" } });
  });
});

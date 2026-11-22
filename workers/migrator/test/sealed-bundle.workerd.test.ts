import { afterAll, describe, expect, it } from "vitest";
import { bootSealedMigrator } from "./sealed-bundle";
import { TARGET } from "./sealed-migrations";
import { pinsSuiteBudget } from "./suite-budget-pin";
import { SEALED_BUNDLE_BUDGET_MS } from "./test-timeout-budget";

// SUT: the sealed migrator bundle CD publishes, built by the release script and started in
// workerd. `build-worker.test.sh` proves it bundles, and a bundle can bundle and still not start:
// under Prisma rc.24, `fdir` calls `createRequire(import.meta.url)` at module top level, and
// workerd leaves `import.meta.url` undefined. Every CD step after the publish — `/healthz`,
// `/preflight`, `/migrate`, `/catalog-schema` — is served by this one bundle.

let sealed: Awaited<ReturnType<typeof bootSealedMigrator>> | undefined;
afterAll(async () => { await sealed?.close(); });

describe("the sealed migrator bundle in workerd", { timeout: SEALED_BUNDLE_BUDGET_MS }, () => {
  pinsSuiteBudget(SEALED_BUNDLE_BUDGET_MS);

  it("starts and answers /healthz with the schema identity it carries", async () => {
    sealed = await bootSealedMigrator();
    const response = await sealed.worker.dispatchFetch("https://migrator.test/healthz");
    expect({ status: response.status, body: await response.json() }).toMatchObject({
      status: 200, body: { status: "ok", service: "migrator", prismaTarget: TARGET },
    });
  });
});

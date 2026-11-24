import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { nativeApp } from "./integration/prisma-fixture";
import { FIXED_NOW } from "./migrate.worker.helpers";

// SUT: `/preflight` and `/migrate` when Prisma's snapshot store fails to load at the bundle
// handshake. It loads on the first check that needs it rather than at startup, so the failure
// belongs to a request now, not to a Worker that cannot start. Each route answers it as it answers
// that check throwing: `/preflight` with its 503, and `/migrate` with Hono's 500, because its
// handshake runs before the route's catch. Neither answers the retryable 409 `stale_prisma_bundle`,
// which would send CD into its wait-and-retry loop.

vi.mock("@prisma/orm-postgres/migration-tools/contract-snapshot-store", () => {
  throw new Error("the snapshot store failed to load");
});
const DSN = "postgresql://fake:migrator@db.test/neondb";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW }); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it("answers /preflight with its 503", async () => {
  const response = await (await nativeApp(DSN)).preview();
  expect({ status: response.status, body: await response.json() })
    .toEqual({ status: 503, body: { error: "preflight_unavailable" } });
});

it("answers /migrate with Hono's 500 and logs what failed", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const response = await (await nativeApp(DSN)).migrate();
  expect({ status: response.status, body: await response.text() }).toEqual({ status: 500, body: "Internal Server Error" });
  expect(logged).toHaveBeenCalledOnce();
});

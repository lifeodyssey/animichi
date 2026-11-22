import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { nativeApp, TARGET } from "./integration/prisma-fixture";
import { FIXED_NOW } from "./migrate.worker.helpers";
import { BASELINE_EDGE, offlinePlan, reportedFailure, shownPlan } from "./prisma-control-results";

// SUT: the preview half of `src/prisma-control.ts` behind `/preflight` and `/migrate`, on rc.24's
// `executeMigrateShowPlan`. CD reads `{targetHash, markerHash, migrations, usedLiveMarker}` from
// this body (`schema-preflight.sh`, `record-receipt.mjs`), so its shape is pinned here even though
// rc.24 reports the live marker as `databaseMarkerHashBySpace`. A refusal is 422, never the
// retryable 409 that `stale_prisma_bundle` alone owns (`migrate.worker.handshake.test.ts`).

const native = vi.hoisted(() => ({ show: vi.fn(), connect: vi.fn(), migrate: vi.fn(), close: vi.fn() }));
vi.mock("@prisma/orm-toolchain/cli/control-api", async (original) => ({
  ...await original<typeof import("@prisma/orm-toolchain/cli/control-api")>(), executeMigrateShowPlan: native.show,
}));
vi.mock("@prisma/orm-postgres/control", () => ({ createPostgresControlClient: () => native }));
const ledger = vi.hoisted(() => ({ stranded: vi.fn() }));
vi.mock("../src/atlas-leftovers", async (original) => ({
  ...await original<typeof import("../src/atlas-leftovers")>(), carriesAtlasLeftovers: ledger.stranded,
}));
const DSN = "postgresql://fake:migrator@db.test/neondb";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW });
  vi.resetAllMocks();
  native.show.mockResolvedValue(shownPlan(TARGET));
  ledger.stranded.mockResolvedValue(false);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it("answers the body CD reads, from the live marker the preview read", async () => {
  const response = await (await nativeApp(DSN)).preview();
  expect({ status: response.status, body: await response.json() }).toEqual({ status: 200, body: {
    compatible: true, prisma: { targetHash: TARGET, markerHash: TARGET, migrations: [], usedLiveMarker: true },
  } });
});

it("reads an unsigned database's marker as empty and lists the edges from it", async () => {
  native.show.mockResolvedValue(shownPlan("empty", [BASELINE_EDGE]));
  const response = await (await nativeApp(DSN)).preview();
  expect(await response.json()).toEqual({ compatible: true, prisma: {
    targetHash: TARGET, markerHash: "empty", migrations: [BASELINE_EDGE], usedLiveMarker: true,
  } });
});

it("refuses a preview that never read the database's marker", async () => {
  native.show.mockResolvedValue(offlinePlan());
  const response = await (await nativeApp(DSN)).preview();
  expect({ status: response.status, body: await response.json() })
    .toEqual({ status: 422, body: { compatible: false, error: "prisma_marker_unavailable" } });
});

it("previews the sealed target on the live database, with advice that names no terminal command", async () => {
  await (await nativeApp(DSN)).preview();
  expect(native.show).toHaveBeenCalledWith(expect.objectContaining({
    db: DSN, to: TARGET, invocation: { cwd: "/bundle", configPath: undefined, dbGiven: false },
  }));
});

it("refuses a marker outside the sealed graph by Prisma's own code, before any DDL", async () => {
  native.show.mockResolvedValue(reportedFailure("MIGRATION.MARKER_MISMATCH", "The database's marker names no migration", {
    meta: { spaceId: "app", markerHash: "c".repeat(64), targetHash: TARGET },
  }));
  const app = await nativeApp(DSN);
  expect(await (await app.preview()).json()).toEqual({ compatible: false, error: "MIGRATION.MARKER_MISMATCH" });
  const refused = await app.migrate();
  expect({ status: refused.status, body: await refused.json() })
    .toEqual({ status: 422, body: { success: false, error: "MIGRATION.MARKER_MISMATCH" } });
  expect(native.connect).not.toHaveBeenCalled();
});

it("refuses an unreachable target with its code alone, never the driver detail", async () => {
  native.show.mockResolvedValue(reportedFailure("MIGRATION.PATH_UNREACHABLE", "No migration path", { why: "private SQL" }));
  const response = await (await nativeApp(DSN)).migrate();
  expect({ status: response.status, body: await response.json() })
    .toEqual({ status: 422, body: { success: false, error: "MIGRATION.PATH_UNREACHABLE" } });
  expect(native.connect).not.toHaveBeenCalled();
});

it("refuses a database still on the Atlas chain by name before Prisma reads it", async () => {
  ledger.stranded.mockResolvedValue(true);
  const app = await nativeApp(DSN);
  expect(await (await app.preview()).json()).toEqual({ compatible: false, error: "atlas_leftovers_present" });
  const refused = await app.migrate();
  expect({ status: refused.status, body: await refused.json() }).toEqual({ status: 422, body: { success: false, error: "atlas_leftovers_present" } });
  expect(native.show).not.toHaveBeenCalled();
  expect(native.connect).not.toHaveBeenCalled();
});

it("sanitizes thrown native preview errors", async () => {
  native.show.mockRejectedValue(new Error("postgresql://secret@private.test/db"));
  const response = await (await nativeApp(DSN)).preview();
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ compatible: false, error: "preflight_unavailable" });
});

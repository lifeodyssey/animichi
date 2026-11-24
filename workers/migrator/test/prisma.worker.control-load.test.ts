import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { nativeApp } from "./integration/prisma-fixture";
import { FIXED_NOW } from "./migrate.worker.helpers";

// SUT: `/preflight` and `/migrate` when the Prisma control behind the preview fails to load. It
// loads on the first preview that needs it rather than at startup, so the failure belongs to that
// request, answered where a preview that throws is answered: `/preflight` refuses with
// `preflight_unavailable`, and `/migrate` names `previewPrisma` as the step that threw.

vi.mock("@prisma/orm-postgres/control", () => {
  throw new Error("Prisma control failed to load");
});
const ledger = vi.hoisted(() => ({ stranded: vi.fn() }));
vi.mock("../src/atlas-leftovers", async (original) => ({
  ...await original<typeof import("../src/atlas-leftovers")>(), carriesAtlasLeftovers: ledger.stranded,
}));
const DSN = "postgresql://fake:migrator@db.test/neondb";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW });
  ledger.stranded.mockResolvedValue(false);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it("refuses /preflight as preflight_unavailable", async () => {
  const response = await (await nativeApp(DSN)).preview();
  expect({ status: response.status, body: await response.json() })
    .toEqual({ status: 422, body: { compatible: false, error: "preflight_unavailable" } });
});

it("names previewPrisma as the step of /migrate that threw, in the answer and the log", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const response = await (await nativeApp(DSN)).migrate();
  const { cause, ...answer } = await response.json<{ cause: unknown }>();
  expect({ status: response.status, answer })
    .toEqual({ status: 500, answer: { success: false, exitCode: 1, error: "migration_unavailable" } });
  expect(cause).toMatch(/^previewPrisma: /);
  expect(logged.mock.calls.flat().join(" ")).toMatch(/^\[migrator\] apply threw: previewPrisma: /);
});

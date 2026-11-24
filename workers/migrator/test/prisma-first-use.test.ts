import { expect, it, vi } from "vitest";
import { MIGRATIONS, TARGET } from "./sealed-migrations";
import { previewPrisma } from "../src/prisma-control";
import { hasPrismaSnapshot } from "../src/prisma-target";

// SUT: how the Worker loads its two slices of Prisma control, seen through the calls that need them.
// A slice loads on the first call that needs it, concurrent first calls share that one load, and a
// load that fails stays failed for the isolate: every later call gets the first error, and the slice
// is not asked for again. Each slice here fails to load, and its mock counts the asks. The count sits
// at the slice, the module the Worker's loader imports, because a module whose evaluation threw
// already keeps its error one level down.

const asked = vi.hoisted(() => ({ store: 0, surface: 0 }));
vi.mock("../src/prisma-snapshot-store", () => {
  asked.store += 1;
  throw new Error("the snapshot store failed to load");
});
vi.mock("../src/prisma-control-surface", () => {
  asked.surface += 1;
  throw new Error("Prisma control failed to load");
});
/** A direct DSN on a loopback port nothing listens on: no call here reaches a database. */
const DSN = "postgresql://fixture:fixture@127.0.0.1:1/neondb";

it("rejects concurrent first checks with the one failed load", async () => {
  const [first, second] = await Promise.allSettled([hasPrismaSnapshot(TARGET, MIGRATIONS), hasPrismaSnapshot(TARGET, MIGRATIONS)]);
  expect(first).toMatchObject({ status: "rejected" });
  expect(second).toEqual(first);
  expect(asked.store).toBe(1);
});

it("rejects a later check with the first failure, and asks for the snapshot store once", async () => {
  const failure = await hasPrismaSnapshot(TARGET, MIGRATIONS).catch((error: unknown) => error);
  await expect(hasPrismaSnapshot(TARGET, MIGRATIONS)).rejects.toBe(failure);
  expect(asked.store).toBe(1);
});

it("rejects a later preview with the first failure, and asks for the control surface once", async () => {
  const failure = await previewPrisma(DSN, TARGET, MIGRATIONS).catch((error: unknown) => error);
  await expect(previewPrisma(DSN, TARGET, MIGRATIONS)).rejects.toBe(failure);
  expect(asked.surface).toBe(1);
});

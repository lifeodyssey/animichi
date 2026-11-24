import { afterEach, expect, it, vi } from "vitest";
import { catalogRequest } from "./catalog-request";
import { loggedErrors } from "./logged-errors";

// SUT: how the catalog Worker loads its Prisma access, `src/db/prisma.ts`, seen through the
// requests that need it. It loads on the first request that needs it, concurrent first requests
// share that one load, and a load that fails stays failed for the isolate: every later request is
// answered from the first failure, and the module is not asked for again. Here the module fails to
// load, and its mock counts the asks. The count sits at `src/db/prisma.ts`, the module the Worker
// imports on first use, because a module whose evaluation threw already keeps its error one level
// down, and a throwing mock factory runs again on every import that asks for it.

const asked = vi.hoisted(() => ({ prismaAccess: 0 }));
vi.mock("../src/db/prisma", () => {
  asked.prismaAccess += 1;
  throw new Error("the catalog's Prisma access failed to load");
});

/** A connection string the boundary accepts; nothing dials it, because the load fails first. */
const DATABASE = { DATABASE_URL: "postgresql://fixture@db.test/catalog" };

/** How Hono answers a request whose handler threw, which is how a failed acquire is answered today. */
const FAILED = { status: 500, body: "Internal Server Error" };

/** One request through the `/catalog/*` boundary, which acquires the request's connection. */
async function nearby(): Promise<{ status: number; body: string }> {
  const response = await catalogRequest("/catalog/nearby", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lat: 36.1, lng: 139.6, radius_m: 5000 }),
  }, DATABASE);
  return { status: response.status, body: await response.text() };
}

afterEach(() => { vi.restoreAllMocks(); });

it("answers concurrent first requests from one failed load", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  expect(await Promise.all([nearby(), nearby()])).toEqual([FAILED, FAILED]);
  const [first, second] = loggedErrors(logged);
  expect(logged).toHaveBeenCalledTimes(2);
  expect(second).toBe(first);
  expect(asked.prismaAccess).toBe(1);
});

it("answers a later request from the first failure, and asks for the module once", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  expect(await nearby()).toEqual(FAILED);
  expect(await nearby()).toEqual(FAILED);
  const [first, later] = loggedErrors(logged);
  expect(logged).toHaveBeenCalledTimes(2);
  expect(later).toBe(first);
  expect(asked.prismaAccess).toBe(1);
});

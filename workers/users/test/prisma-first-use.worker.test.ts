import { afterEach, expect, it, vi } from "vitest";
import { createUsersApp } from "../src/index";
import { identityHeaders, TEST_ENV } from "./identity-fixture";

// SUT: how the users Worker loads its Prisma access, `src/db/prisma.ts`, seen through the requests
// that need it. It loads on the first request that needs it rather than at startup, so a module
// that cannot load no longer stops the Worker from starting: it fails that request, answered as a
// failed acquire is answered today, with Hono's 500. Concurrent first requests share that one load,
// and a load that fails stays failed for the isolate: every later request is answered from the
// first failure, and the module is not asked for again. Here the module fails to load, and its mock
// counts the asks. The count sits at `src/db/prisma.ts`, the module the Worker imports on first use,
// because a module whose evaluation threw already keeps its error one level down, and a throwing
// mock factory runs again on every import that asks for it.

const asked = vi.hoisted(() => ({ prismaAccess: 0 }));
vi.mock("../src/db/prisma", () => {
  asked.prismaAccess += 1;
  throw new Error("the users Worker's Prisma access failed to load");
});

/** How Hono answers a request whose handler threw, which is how a failed acquire is answered today. */
const FAILED = { status: 500, body: "Internal Server Error" };

/** One request through the `/v1/users/*` boundary, which acquires the request's connection. */
async function listSavedRoutes(): Promise<{ status: number; body: string }> {
  const response = await createUsersApp().request("/v1/users/saved-routes", { headers: identityHeaders("user-a") }, TEST_ENV);
  return { status: response.status, body: await response.text() };
}

/** What Hono logged for each request it answered with a 500: the error the handler threw. */
function loggedErrors(logged: { mock: { calls: unknown[][] } }): unknown[] {
  return logged.mock.calls.map(([error]) => error);
}

afterEach(() => { vi.restoreAllMocks(); });

it("starts and answers /healthz without asking for the module", async () => {
  expect((await createUsersApp().request("/healthz", {}, TEST_ENV)).status).toBe(200);
  expect(asked.prismaAccess).toBe(0);
});

it("answers concurrent first requests from one failed load", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  expect(await Promise.all([listSavedRoutes(), listSavedRoutes()])).toEqual([FAILED, FAILED]);
  const [first, second] = loggedErrors(logged);
  expect(logged).toHaveBeenCalledTimes(2);
  expect(second).toBe(first);
  expect(asked.prismaAccess).toBe(1);
});

it("answers a later request from the first failure, and asks for the module once", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  expect(await listSavedRoutes()).toEqual(FAILED);
  expect(await listSavedRoutes()).toEqual(FAILED);
  const [first, later] = loggedErrors(logged);
  expect(logged).toHaveBeenCalledTimes(2);
  expect(later).toBe(first);
  expect(asked.prismaAccess).toBe(1);
});

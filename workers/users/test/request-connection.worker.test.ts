import { beforeEach, expect, it, vi } from "vitest";
import { createUsersApp } from "../src/index";
import { fakeUsersPrisma } from "./fake-users-prisma";
import { FAILED_PROCEDURE } from "./failed-procedure-answer";
import { identityHeaders, TEST_ENV } from "./identity-fixture";

// SUT: the connection the users Worker's `/v1/users/*` boundary (`src/index.ts`) opens for a
// request, driven through the whole app with Prisma's `connect()` replaced by a double that writes
// down what happens to the connection it hands out. A request gets one connection; every query its
// handler makes runs inside it; it is closed when the handler is done, on success and on failure
// (spec §4.2); and a Prisma injected through `deps.makePrisma` opens none. The double runs a query
// a microtask after the call, as Prisma's lazy query does, so a scope that closed before its
// handler finished writes the close before the query.

const recorded = vi.hoisted(() => {
  const events: string[] = [];
  const answer = vi.fn<() => Promise<readonly never[]>>();
  const connection = () => ({
    query: () => Promise.resolve().then(() => { events.push("query"); return answer(); }),
    [Symbol.asyncDispose]: () => { events.push("close"); return Promise.resolve(); },
  });
  const connect = () => { events.push("connect"); return Promise.resolve(connection()); };
  return { events, answer, connect };
});

vi.mock("@prisma/orm-postgres/serverless", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@prisma/orm-postgres/serverless")>();
  return {
    default: (...options: Parameters<typeof actual.default>) => ({ ...actual.default(...options), connect: recorded.connect }),
  };
});

/** The caller's saved-route list through `app`; the double's empty answer makes it one query. */
async function listSavedRoutes(app: ReturnType<typeof createUsersApp>): Promise<Response> {
  return await app.request("/v1/users/saved-routes", { headers: identityHeaders("user-a") }, TEST_ENV);
}

beforeEach(() => {
  recorded.events.length = 0;
});

it("opens one connection for a request, runs the handler's query inside it, and closes it after", async () => {
  recorded.answer.mockResolvedValue([]);
  const response = await listSavedRoutes(createUsersApp());
  expect({ status: response.status, events: recorded.events }).toEqual({ status: 200, events: ["connect", "query", "close"] });
});

it("answers a query that fails after the connect with oRPC's 500, and still closes the connection", async () => {
  recorded.answer.mockRejectedValue(new Error("the query failed after the connection opened"));
  const response = await listSavedRoutes(createUsersApp());
  expect({ status: response.status, body: await response.text(), events: recorded.events })
    .toEqual({ ...FAILED_PROCEDURE, events: ["connect", "query", "close"] });
});

it("answers through a Prisma injected with deps.makePrisma, without opening a connection", async () => {
  const response = await listSavedRoutes(createUsersApp({ makePrisma: () => fakeUsersPrisma().prisma }));
  expect({ status: response.status, events: recorded.events }).toEqual({ status: 200, events: [] });
});

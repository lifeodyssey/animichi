import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { catalogRequest } from "./catalog-request";
import { FAILED_PROCEDURE } from "./failed-procedure-answer";

// SUT: the connection the catalog's `/catalog/*` boundary (`src/index.ts`) opens for a request,
// driven through the whole app with Prisma's `connect()` replaced by a double that writes down what
// happens to the connection it hands out. A request gets one connection; every query its handler
// makes runs inside it; it is closed when the handler is done, on success and on failure (spec
// §4.2). The double runs a query a microtask after the call, as Prisma's lazy query does, so a
// scope that closed before its handler finished writes the close before the query. Against a real
// socket the same lifetime is `nearby-runtime.integration.test.ts`'s.

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

/** A nearby read through the whole app; the double's empty answer makes it one query. */
function nearby(): Promise<Response> {
  return catalogRequest("/catalog/nearby", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lat: 36.1, lng: 139.6, radius_m: 5000 }),
  }, { DATABASE_URL: "postgresql://fixture@db.test/catalog" });
}

beforeEach(() => {
  recorded.events.length = 0;
  // A catalog route reaches its upstreams through `fetch`; nothing in this file may leave the machine.
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("this suite stubs every upstream"))));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("opens one connection for a request, runs the handler's query inside it, and closes it after", async () => {
  recorded.answer.mockResolvedValue([]);
  const response = await nearby();
  expect({ status: response.status, events: recorded.events }).toEqual({ status: 200, events: ["connect", "query", "close"] });
});

it("answers a query that fails after the connect with oRPC's 500, and still closes the connection", async () => {
  recorded.answer.mockRejectedValue(new Error("the query failed after the connection opened"));
  const response = await nearby();
  expect({ status: response.status, body: await response.text(), events: recorded.events })
    .toEqual({ ...FAILED_PROCEDURE, events: ["connect", "query", "close"] });
});

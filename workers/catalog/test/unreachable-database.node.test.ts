import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { catalogRequest } from "./catalog-request";
import { startDroppingDatabase, type DroppingDatabase } from "./dropping-database";
import { FAILED_PROCEDURE } from "./failed-procedure-answer";

// SUT: the catalog Worker's `/catalog/*` boundary (`src/index.ts`) while its database cannot be
// reached, driven through the whole app in plain Node with Prisma's real driver. Since Prisma rc.14
// `connect()` opens the connection before it returns, so the rc.14 upgrade guide (step 5 of
// `serverless-connect-returns-connection`) asks for two things: a request that needs no query is
// answered before `connect()`, and a `connect()` that fails is answered where a failed first query
// was answered before, which for a catalog route is oRPC's 500 with its JSON error body. The
// database is a loopback listener that counts the connections it takes and drops each one, so a
// case reads both the answer and whether the request connected. No case waits out Prisma's
// 20-second connect timeout: the listener drops at once, and a URL that is not a Postgres URL fails
// before any socket.

// The plain-Node pool has no workerd runtime; stub the runtime module so `src/index.ts` (which
// exports the `IngestEntrypoint` named entrypoint) loads.
vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class WorkerEntrypoint {
    readonly ctx: unknown;
    readonly env: unknown;

    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const JSON_POST = { method: "POST", headers: { "content-type": "application/json" } };
const NEARBY = { ...JSON_POST, body: JSON.stringify({ lat: 36.1, lng: 139.6, radius_m: 5000 }) };

/** A database that drops every connection, closed when the test ends. */
async function droppingDatabase(): Promise<DroppingDatabase> {
  const database = await startDroppingDatabase();
  onTestFinished(() => database.close());
  return database;
}

/** One request through the whole app with `url` as its database: its status and its body as text. */
async function answerOf(path: string, init: RequestInit, url: string): Promise<{ status: number; body: string }> {
  const response = await catalogRequest(path, init, { DATABASE_URL: url });
  return { status: response.status, body: await response.text() };
}

beforeEach(() => {
  // A catalog route reaches its upstreams through `fetch`; nothing in this file may leave the machine.
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("this suite stubs every upstream"))));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("answers a nearby read with oRPC's 500 when the database drops the connection, and logs the failure", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const database = await droppingDatabase();
  const answer = await answerOf("/catalog/nearby", NEARBY, database.url);
  expect({ ...answer, connections: database.connections() }).toEqual({ ...FAILED_PROCEDURE, connections: 1 });
  expect(logged).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: "DRIVER.CONNECTION_FAILED" }));
});

it("answers a nearby read with oRPC's 500 when the URL is not a Postgres URL, and logs the failure", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const database = await droppingDatabase();
  const answer = await answerOf("/catalog/nearby", NEARBY, database.url.replace("postgresql:", "http:"));
  expect({ ...answer, connections: database.connections() }).toEqual({ ...FAILED_PROCEDURE, connections: 0 });
  expect(logged).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: "RUNTIME.BINDING_INVALID" }));
});

it("answers a path no procedure serves with Hono's 404, without a connection", async () => {
  const database = await droppingDatabase();
  const answer = await answerOf("/catalog/never-a-procedure", { ...JSON_POST, body: "{}" }, database.url);
  expect({ ...answer, connections: database.connections() }).toEqual({ status: 404, body: "404 Not Found", connections: 0 });
});

it("answers input that fails the contract with oRPC's 400, without a connection", async () => {
  const database = await droppingDatabase();
  const invalid = { ...JSON_POST, body: JSON.stringify({ lat: 91, lng: 139.6, radius_m: 5000 }) };
  const answer = await answerOf("/catalog/nearby", invalid, database.url);
  expect({ status: answer.status, connections: database.connections() }).toEqual({ status: 400, connections: 0 });
  expect(answer.body).toContain('"code":"BAD_REQUEST"');
});

it("answers an undeclared public query parameter with its 400, without a connection", async () => {
  const database = await droppingDatabase();
  const answer = await answerOf("/catalog/public/popular?unexpected=1", {}, database.url);
  expect({ ...answer, connections: database.connections() })
    .toEqual({ status: 400, body: '{"error":"unexpected query parameters"}', connections: 0 });
});

it("answers /healthz without a connection", async () => {
  const database = await droppingDatabase();
  const answer = await answerOf("/healthz", {}, database.url);
  expect({ status: answer.status, connections: database.connections() }).toEqual({ status: 200, connections: 0 });
});

import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { createUsersApp } from "../src/index";
import { startDroppingDatabase, type DroppingDatabase } from "./dropping-database";
import { FAILED_PROCEDURE } from "./failed-procedure-answer";
import { identityHeaders } from "./identity-fixture";

// SUT: the users Worker's `/v1/users/*` boundary (`src/index.ts`) while its database cannot be
// reached, driven through the whole app in plain Node with Prisma's real driver. Since Prisma rc.14
// `connect()` opens the connection before it returns, so the rc.14 upgrade guide (step 5 of
// `serverless-connect-returns-connection`) asks for two things: a request that needs no query is
// answered before `connect()`, and a `connect()` that fails is answered where a failed first query
// was answered before, which for a users route is oRPC's 500 with its JSON error body. The
// database is a loopback listener that counts the connections it takes and drops each one, so a
// case reads both the answer and whether the request connected. No case waits out Prisma's
// 20-second connect timeout: the listener drops at once, and a URL that is not a Postgres URL fails
// before any socket.

const SAVED_ROUTES = "/v1/users/saved-routes";
const ADMITTED = { headers: identityHeaders("user-a", { "content-type": "application/json" }) };

/** A database that drops every connection, closed when the test ends. */
async function droppingDatabase(): Promise<DroppingDatabase> {
  const database = await startDroppingDatabase();
  onTestFinished(() => database.close());
  return database;
}

/** One request through the whole app with `url` as its database: its status and its body as text. */
async function answerOf(path: string, init: RequestInit, url: string): Promise<{ status: number; body: string }> {
  const response = await createUsersApp().request(path, init, { ENVIRONMENT: "test", DATABASE_URL: url });
  return { status: response.status, body: await response.text() };
}

afterEach(() => { vi.restoreAllMocks(); });

it("answers a saved-route list with oRPC's 500 when the database drops the connection, and logs the failure", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const database = await droppingDatabase();
  const answer = await answerOf(SAVED_ROUTES, ADMITTED, database.url);
  expect({ ...answer, connections: database.connections() }).toEqual({ ...FAILED_PROCEDURE, connections: 1 });
  expect(logged).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: "DRIVER.CONNECTION_FAILED" }));
});

it("answers a saved-route list with oRPC's 500 when the URL is not a Postgres URL, and logs the failure", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const database = await droppingDatabase();
  const answer = await answerOf(SAVED_ROUTES, ADMITTED, database.url.replace("postgresql:", "http:"));
  expect({ ...answer, connections: database.connections() }).toEqual({ ...FAILED_PROCEDURE, connections: 0 });
  expect(logged).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: "RUNTIME.BINDING_INVALID" }));
});

it("answers a path no procedure serves with Hono's 404, without a connection", async () => {
  const database = await droppingDatabase();
  const answer = await answerOf("/v1/users/never-a-procedure", ADMITTED, database.url);
  expect({ ...answer, connections: database.connections() }).toEqual({ status: 404, body: "404 Not Found", connections: 0 });
});

it("answers input that fails the contract with oRPC's 400, without a connection", async () => {
  const database = await droppingDatabase();
  const answer = await answerOf(SAVED_ROUTES, { ...ADMITTED, method: "POST", body: "{}" }, database.url);
  expect({ status: answer.status, connections: database.connections() }).toEqual({ status: 400, connections: 0 });
  expect(answer.body).toContain('"code":"BAD_REQUEST"');
});

it("answers a request it does not admit with its 401, without a connection", async () => {
  const database = await droppingDatabase();
  const answer = await answerOf(SAVED_ROUTES, {}, database.url);
  expect({ ...answer, connections: database.connections() }).toEqual({
    status: 401, body: '{"error":{"code":"unauthorized","message":"Valid credentials required."}}', connections: 0,
  });
});

it("answers /healthz without a connection", async () => {
  const database = await droppingDatabase();
  const answer = await answerOf("/healthz", {}, database.url);
  expect({ status: answer.status, connections: database.connections() }).toEqual({ status: 200, connections: 0 });
});

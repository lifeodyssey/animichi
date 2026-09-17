import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FIXED_NOW, productionEnv } from "./migrate.worker.helpers";
import { metadata, preflightRequest, recordingExecutor, signedApp } from "./preflight-fixtures";

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const REF = metadata.expectedPrismaRef;
const withRef = (expectedPrismaRef: unknown) => ({ ...metadata, expectedPrismaRef });

// The key set is compared EXACTLY, so an added field is an invalid request rather than an
// ignored one: that is what stops a caller smuggling SQL, a DSN or an environment override
// past a receiver that only looks at the fields it knows.
it.each([
  ["null", null], ["array", []], ["missing properties", {}],
  ["SQL", { ...metadata, sql: "DROP SCHEMA public CASCADE" }],
  ["DSN", { ...metadata, dsn: "postgresql://private:secret@evil.test/private" }],
  ["environment override", { ...metadata, environment: "production" }],
  ["URL", { ...metadata, url: "https://evil.test" }],
  ["retired Atlas head", { ...metadata, expectedHead: "20260915060017_photo_offers" }],
  ["retired Atlas checksum file", { ...metadata, atlasSum: "h1:anything\n" }],
  ["string flag", { ...metadata, stagingOnlyBaseline: "false" }],
  ["missing identity", { stagingOnlyBaseline: false }],
  ["identity type", withRef(10)],
  ["short identity", withRef(REF.slice(0, -1))],
  ["long identity", withRef(`${REF}0`)],
  ["upper-case identity", withRef(REF.toUpperCase())],
  ["non-hex identity", withRef(`${REF.slice(0, -1)}z`)],
  ["path traversal identity", withRef("../../etc/passwd")],
])("refuses %s metadata before secret resolution or the database", async (_name, body) => {
  const executor = recordingExecutor();
  const { app, token, env } = await signedApp({}, { selected: executor.selected });
  const get = vi.fn(() => Promise.resolve("private-dsn"));
  const response = await app.request(preflightRequest(body, token), undefined,
    { ...env, MIGRATOR_DATABASE_URL: { get } });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "invalid_preflight" });
  expect(get).not.toHaveBeenCalled();
  expect(executor.calls).toEqual([]);
});

it.each(["{", "", " ".repeat(65_537)])("refuses malformed or oversized JSON before the DSN (%#)", async (body) => {
  const { app, token, env } = await signedApp();
  const get = vi.fn(() => Promise.resolve("private-dsn"));
  const request = new Request(preflightRequest(metadata, token), { body });
  const response = await app.request(request, undefined, { ...env, MIGRATOR_DATABASE_URL: { get } });
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(await response.json()).toEqual({ error: "invalid_preflight" });
  expect(get).not.toHaveBeenCalled();
});

it("bounds content-length declared requests before the DSN", async () => {
  const { app, token, env } = await signedApp();
  const get = vi.fn(() => Promise.resolve("private-dsn"));
  const request = preflightRequest(metadata, token);
  request.headers.set("content-length", "65537");
  const response = await app.request(request, undefined, { ...env, MIGRATOR_DATABASE_URL: { get } });
  expect(response.status).toBe(413);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(get).not.toHaveBeenCalled();
});

it("bounds the decoded body even when content-length understates its size", async () => {
  const { app, token, env } = await signedApp();
  const get = vi.fn(() => Promise.resolve("private-dsn"));
  const request = preflightRequest({ ...metadata, padding: " ".repeat(65_537) }, token);
  request.headers.set("content-length", "1");
  const response = await app.request(request, undefined, { ...env, MIGRATOR_DATABASE_URL: { get } });
  expect(response.status).toBe(400);
  expect(get).not.toHaveBeenCalled();
});

it("refuses the staging-only baseline flag in production before the DSN", async () => {
  const { app, token } = await signedApp({ environment: "production" });
  const get = vi.fn(() => Promise.resolve("private-dsn"));
  const response = await app.request(preflightRequest({ ...metadata, stagingOnlyBaseline: true }, token), undefined,
    { ...productionEnv(), MIGRATOR_DATABASE_URL: { get } });
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ compatible: false, error: "staging_only_baseline" });
  expect(get).not.toHaveBeenCalled();
});

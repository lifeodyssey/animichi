import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { nativeApp, requestMetadata, TARGET } from "./integration/prisma-fixture";
import { FIXED_NOW, makeApp, testEnv } from "./migrate.worker.helpers";
import { preflightRequest } from "./preflight-fixtures";

const native = vi.hoisted(() => ({ show: vi.fn(), connect: vi.fn(), migrate: vi.fn(), close: vi.fn() }));
vi.mock("@prisma/orm-toolchain/cli/control-api", () => ({ executeMigrateShowPlan: native.show }));
vi.mock("@prisma/orm-postgres/control", () => ({ createPostgresControlClient: () => native }));
const ledger = vi.hoisted(() => ({ stranded: vi.fn() }));
vi.mock("../src/atlas-leftovers", async (original) => ({
  ...await original<typeof import("../src/atlas-leftovers")>(), carriesAtlasLeftovers: ledger.stranded,
}));
// #1915 — these tests judge the Prisma control boundary; the provisioning step beside it has
// its own suites, and its Neon HTTP batch would otherwise leave the mocked boundary.
const roles = vi.hoisted(() => ({ provision: vi.fn() }));
vi.mock("../src/service-roles", async (original) => ({
  ...await original<typeof import("../src/service-roles")>(),
  provisionServiceRoles: roles.provision,
}));
const DSN = "postgresql://fake:migrator@db.test/neondb";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW });
  vi.resetAllMocks();
  roles.provision.mockResolvedValue(undefined);
  native.show.mockResolvedValue({ ok: true, value: { migrations: [], renderMarkerHashBySpace: new Map([["app", TARGET]]), usedLiveMarker: true } });
  native.migrate.mockResolvedValue({ ok: true, value: { markerHash: TARGET, migrationsApplied: 0, applied: [] } });
  ledger.stranded.mockResolvedValue(false);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("returns the native marker and zero-operation receipt through authenticated HTTP", async () => {
  const app = await nativeApp(DSN);
  const response = await app.migrate();
  expect({ status: response.status, body: await response.json() }).toMatchObject({ status: 200, body: {
    success: true, prisma: { markerHash: TARGET, migrationsApplied: 0 },
  } });
  expect(native.close).toHaveBeenCalledOnce();
});

it("retains the public preview API's live-marker flag without assuming it is true", async () => {
  native.show.mockResolvedValue({ ok: true, value: { migrations: [], renderMarkerHashBySpace: new Map([["app", "empty"]]), usedLiveMarker: false } });
  const response = await (await nativeApp(DSN)).preview();
  expect(await response.json()).toMatchObject({ prisma: { markerHash: "empty", usedLiveMarker: false } });
});

it("refuses a native path failure before attempting either owner's DDL", async () => {
  native.show.mockResolvedValue({ ok: false, failure: { code: "NO_FORWARD_PATH", message: "private SQL" } });
  const response = await (await nativeApp(DSN)).migrate();
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ error: "NO_FORWARD_PATH" });
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

it("refuses a preview whose native marker is unavailable", async () => {
  native.show.mockResolvedValue({ ok: true, value: { migrations: [], renderMarkerHashBySpace: new Map(), usedLiveMarker: true } });
  const response = await (await nativeApp(DSN)).preview();
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ compatible: false, error: "prisma_marker_unavailable" });
});

it("sanitizes thrown native preview errors", async () => {
  native.show.mockRejectedValue(new Error("postgresql://secret@private.test/db"));
  const response = await (await nativeApp(DSN)).preview();
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ compatible: false, error: "preflight_unavailable" });
});

it("returns only the native failure code and closes the control client", async () => {
  native.migrate.mockResolvedValue({ ok: false, failure: { code: "DDL_FAILED", message: "private SQL" } });
  const response = await (await nativeApp(DSN)).migrate();
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ success: false, error: "DDL_FAILED" });
  expect(native.close).toHaveBeenCalledOnce();
});

// #1891 — `RUNNER_FAILED` alone is what staging could read. The failure's own fields beyond the
// code, with the names the control client's `MigrateFailure` declares, are the operator's only
// lead, so the 500 keeps them as a `cause` and the log carries the same line.
it("keeps a reported failure's fields beyond the code in the cause and the log", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  native.migrate.mockResolvedValue({ ok: false, failure: {
    code: "RUNNER_FAILED",
    summary: "Migration runner failed",
    why: 'type "restart_marker" does not exist',
    meta: { migration: "20260923_x" },
  } });
  const response = await (await nativeApp(DSN)).migrate();
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ success: false, exitCode: 1, error: "RUNNER_FAILED",
    cause: 'type "restart_marker" does not exist — Migration runner failed' });
  expect(logged.mock.calls.flat().join(" ")).toBe(
    '[migrator] apply failed: type "restart_marker" does not exist — Migration runner failed');
  expect(native.close).toHaveBeenCalledOnce();
});

// The reported path reaches a public repository's log exactly as the thrown one does, so the
// connection string a driver printed into `why` is replaced before either surface carries it.
it("redacts the connection string out of a reported failure's cause and log", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  native.migrate.mockResolvedValue({ ok: false, failure: {
    code: "RUNNER_FAILED",
    summary: "Migration runner failed",
    why: "connect postgresql://migrator:REDACT_ME_PLACEHOLDER@ep-fixture.neon.tech/neondb failed",
  } });
  const response = await (await nativeApp(DSN)).migrate();
  expect(await response.json()).toEqual({ success: false, exitCode: 1, error: "RUNNER_FAILED",
    cause: "connect postgresql://[redacted] failed — Migration runner failed" });
  expect(logged.mock.calls.flat().join(" ")).toBe(
    "[migrator] apply failed: connect postgresql://[redacted] failed — Migration runner failed");
});

// The other mutation: a failure that states nothing beyond its code must not grow an empty
// `cause` — the body keeps exactly the fields it kept before this card, and nothing is logged.
it("returns a failure stating nothing beyond its code as the code alone", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  native.migrate.mockResolvedValue({ ok: false, failure: { code: "RUNNER_FAILED", summary: "", why: undefined, meta: undefined } });
  const response = await (await nativeApp(DSN)).migrate();
  expect({ status: response.status, body: await response.json() })
    .toEqual({ status: 500, body: { success: false, exitCode: 1, error: "RUNNER_FAILED" } });
  expect(logged).not.toHaveBeenCalled();
});

// `toEqual`, not `toMatchObject`: a handled outcome states its identity and stops there. A
// `cause` appearing here would mean the thrown-failure channel had widened to swallow the
// outcomes that already name themselves, which is the same defect under a newer name (#1868).
it("refuses a successful native result that names a different marker", async () => {
  native.migrate.mockResolvedValue({ ok: true, value: { markerHash: "f".repeat(64), migrationsApplied: 0 } });
  const response = await (await nativeApp(DSN)).migrate();
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ success: false, exitCode: 1, error: "prisma_marker_mismatch" });
});

// The apply RAN and threw — the narrower of the two thrown failures (#1868), and the one
// whose cause reaches CD through a public repository's log, so the DSN in the driver's own
// message is replaced before either the response or the log line carries it.
it("names a thrown connection failure without its connection string, and still closes the native client", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  native.connect.mockRejectedValue(new Error(`refused postgresql://migrator:REDACT_ME_PLACEHOLDER@private.test/db`));
  const response = await (await nativeApp(DSN)).migrate();
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ success: false, exitCode: 1,
    error: "migration_unavailable", cause: "migratePrisma: refused postgresql://[redacted]" });
  expect(logged.mock.calls.flat().join(" ")).toBe("[migrator] apply threw: migratePrisma: refused postgresql://[redacted]");
  expect(native.close).toHaveBeenCalledOnce();
});

it("rejects native metadata carrying arbitrary SQL rather than ignoring the extra field", async () => {
  const { app, token } = await makeApp();
  const response = await app.request(preflightRequest({ ...requestMetadata, sql: "DROP TABLE pi_sessions" }, token), {}, testEnv());
  expect(response.status).toBe(400);
  expect(native.show).not.toHaveBeenCalled();
});

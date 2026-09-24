import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeApp, post, testEnv } from "./migrate.worker.helpers";
import { MIGRATIONS, TARGET } from "./sealed-migrations";
import { migrateSelected, preflightSelected } from "../src/selected-migration";
import type { PrismaPreview } from "../src/prisma-control";

/* What a `/migrate` whose apply THREW names as the failing sub-step (#1915).
 *
 * Staging failed on 2026-09-24 with `migration_unavailable` and a driver message, twice,
 * while `/preflight` — the same `checkSelected` behind the same Durable Object gate —
 * answered `compatible` seconds earlier. The two routes' code does not differ before
 * `checkSelected`, so the next failure must name WHICH sub-step threw instead of leaving
 * every part of `applySelected` behind one undifferentiated line. Each test here throws
 * inside exactly one sub-step and demands that sub-step's name in both the response's
 * `cause` and the one log line the apply emits.
 */

/** Recognisable, and worth nothing: the scanner runs on every commit. */
const PLACEHOLDER = "REDACT_ME_PLACEHOLDER";
const DIRECT_DSN = `postgresql://migrator:${PLACEHOLDER}@ep-fixture.neon.tech/neondb`;
const POOLED_DSN = "postgresql://migrator:fixture@ep-fixture-pooler.neon.tech/neondb";
const BOOM = new Error("boom");

const snapshot = vi.hoisted(() => ({ has: vi.fn() }));
vi.mock("../src/prisma-target", async (original) => ({
  ...await original<typeof import("../src/prisma-target")>(),
  hasPrismaSnapshot: snapshot.has,
}));
const ledger = vi.hoisted(() => ({ stranded: vi.fn() }));
vi.mock("../src/atlas-leftovers", async (original) => ({
  ...await original<typeof import("../src/atlas-leftovers")>(),
  carriesAtlasLeftovers: ledger.stranded,
}));
const native = vi.hoisted(() => ({ preview: vi.fn(), migrate: vi.fn() }));
vi.mock("../src/prisma-control", async (original) => ({
  ...await original<typeof import("../src/prisma-control")>(),
  previewPrisma: native.preview,
  migratePrisma: native.migrate,
}));
const roles = vi.hoisted(() => ({ provision: vi.fn() }));
vi.mock("../src/service-roles", async (original) => ({
  ...await original<typeof import("../src/service-roles")>(),
  provisionServiceRoles: roles.provision,
}));

/** The one-line preview the happy chain needs; the mock's shape never drifts with the real fields. */
const preview: PrismaPreview = { targetHash: TARGET, markerHash: TARGET, migrations: [], usedLiveMarker: true };

beforeEach(() => {
  snapshot.has.mockReset().mockResolvedValue(true);
  ledger.stranded.mockReset().mockResolvedValue(false);
  native.preview.mockReset().mockResolvedValue({ ok: true, value: preview });
  native.migrate.mockReset().mockResolvedValue({ ok: true, value: { markerHash: TARGET, migrationsApplied: 0, applied: [] } });
  roles.provision.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); });

/** The real apply through the HTTP seam, its sub-steps' default behaviour stubbed green. */
async function thrownApply(dsn: string) {
  const { app, token } = await makeApp({ migrationsDir: MIGRATIONS, selected: {
    preflight: (connection, metadata) => preflightSelected(connection, metadata, MIGRATIONS),
    migrate: (connection, passwords, metadata) => migrateSelected(connection, passwords, metadata, MIGRATIONS),
  } });
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const response = await app.request(post({}, token), undefined, { ...testEnv(), MIGRATOR_DATABASE_URL: dsn });
  return { body: await response.json(), logged };
}

describe("a throw in a sub-step of the apply", () => {
  it("names assertDirectDsn when the DSN rule rejects the connection", async () => {
    const { body, logged } = await thrownApply(POOLED_DSN);
    expect(body).toEqual({ success: false, exitCode: 1, error: "migration_unavailable", cause: "assertDirectDsn: pooled endpoint rejected" });
    expect(logged.mock.calls).toEqual([["[migrator] apply threw: assertDirectDsn: pooled endpoint rejected"]]);
  });

  it("names hasPrismaSnapshot when the bundle check throws", async () => {
    snapshot.has.mockResolvedValueOnce(true).mockRejectedValue(BOOM);
    const { body, logged } = await thrownApply(DIRECT_DSN);
    expect(body).toEqual({ success: false, exitCode: 1, error: "migration_unavailable", cause: "hasPrismaSnapshot: boom" });
    expect(logged.mock.calls).toEqual([["[migrator] apply threw: hasPrismaSnapshot: boom"]]);
  });

  it("names carriesAtlasLeftovers when the ledger probe throws", async () => {
    ledger.stranded.mockRejectedValue(BOOM);
    const { body, logged } = await thrownApply(DIRECT_DSN);
    expect(body).toEqual({ success: false, exitCode: 1, error: "migration_unavailable", cause: "carriesAtlasLeftovers: boom" });
    expect(logged.mock.calls).toEqual([["[migrator] apply threw: carriesAtlasLeftovers: boom"]]);
  });

  it("names previewPrisma when the native preview throws", async () => {
    native.preview.mockRejectedValue(BOOM);
    const { body, logged } = await thrownApply(DIRECT_DSN);
    expect(body).toEqual({ success: false, exitCode: 1, error: "migration_unavailable", cause: "previewPrisma: boom" });
    expect(logged.mock.calls).toEqual([["[migrator] apply threw: previewPrisma: boom"]]);
  });

  it("names migratePrisma when the native migrate throws", async () => {
    native.migrate.mockRejectedValue(BOOM);
    const { body, logged } = await thrownApply(DIRECT_DSN);
    expect(body).toEqual({ success: false, exitCode: 1, error: "migration_unavailable", cause: "migratePrisma: boom" });
    expect(logged.mock.calls).toEqual([["[migrator] apply threw: migratePrisma: boom"]]);
  });

  it("keeps provisionRoles' own verdict, which already names itself", async () => {
    roles.provision.mockRejectedValue(BOOM);
    const { body, logged } = await thrownApply(DIRECT_DSN);
    expect(body).toEqual({ success: false, exitCode: 1, error: "service_role_provisioning_failed", cause: "boom" });
    expect(logged.mock.calls).toEqual([["[migrator] service role provisioning failed: boom"]]);
  });

  it("redacts a driver message's connection string after the sub-step's name", async () => {
    ledger.stranded.mockRejectedValue(new Error(`connect ${DIRECT_DSN} failed`));
    const { body, logged } = await thrownApply(DIRECT_DSN);
    expect(body).toEqual({ success: false, exitCode: 1, error: "migration_unavailable", cause: "carriesAtlasLeftovers: connect postgresql://[redacted] failed" });
    expect(logged.mock.calls).toEqual([["[migrator] apply threw: carriesAtlasLeftovers: connect postgresql://[redacted] failed"]]);
  });
});

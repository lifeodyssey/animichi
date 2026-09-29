import { afterEach, describe, expect, it, vi } from "vitest";
import { makeApp, post, SERVICE_ROLE_PASSWORDS, testEnv } from "./migrate.worker.helpers";
import { MIGRATIONS, requestMetadata } from "./sealed-migrations";
import { migrateSelected, preflightSelected } from "../src/selected-migration";
import { provisionServiceRoles } from "../src/service-roles";
import { carriesAtlasLeftovers } from "../src/atlas-leftovers";
import { migratePrisma, previewPrisma } from "../src/prisma-control";

/* The #1915 provisioning seam inside `migrateSelected`: when the SQL step fails, the verdict is
 * its own code with a cause that crossed `redactedCause` (the statements it may quote carry the
 * runtime roles' passwords), and the chain after it must not run. Both arms stub the step at
 * its module boundary, so the mutations that keep this file honest are: dropping the
 * `redactedCause` wrap, renaming the code onto a generic failure, and swallowing the
 * error to apply the chain anyway — each of those turns a case here red. */

vi.mock("../src/service-roles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/service-roles")>()),
  provisionServiceRoles: vi.fn(),
}));
vi.mock("../src/prisma-control", () => ({ previewPrisma: vi.fn(), migratePrisma: vi.fn() }));
vi.mock("../src/atlas-leftovers", () => ({ ATLAS_LEFTOVERS_PRESENT: "atlas_leftovers_present", carriesAtlasLeftovers: vi.fn() }));

afterEach(() => { vi.restoreAllMocks(); });

/** The error the real step's statements would echo: the bound password, in SQL's own form. */
const PROVISIONING_ERROR = new Error(
  `ALTER ROLE catalog_svc PASSWORD '${SERVICE_ROLE_PASSWORDS.catalogSvc}' failed: role "catalog_svc" cannot be altered`,
);
const REDACTED_CAUSE =
  `ALTER ROLE catalog_svc PASSWORD [redacted] failed: role "catalog_svc" cannot be altered`;
const DIRECT_DSN = "postgresql://migrator:fixture@ep-fixture.neon.tech/neondb";
const PREVIEW = { ok: true, value: {
  targetHash: requestMetadata.expectedPrismaRef,
  markerHash: requestMetadata.expectedPrismaRef,
  migrations: [],
  usedLiveMarker: false,
} } as const;

/** The real apply path behind `/migrate`: same wiring the live Worker gets. */
async function dispatchRealApply() {
  const { app, token } = await makeApp({ migrationsDir: MIGRATIONS, selected: {
    preflight: (connection, metadata) => preflightSelected(connection, metadata, MIGRATIONS),
    migrate: (connection, passwords, metadata) => migrateSelected(connection, passwords, metadata, MIGRATIONS),
  } });
  return await app.request(post({}, token), undefined, { ...testEnv(), MIGRATOR_DATABASE_URL: DIRECT_DSN });
}

describe("a migrate whose provisioning step fails", () => {
  it("answers with its own code and a cause that carries no bound password", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(carriesAtlasLeftovers).mockResolvedValue(false);
    vi.mocked(previewPrisma).mockResolvedValue({ ...PREVIEW });
    vi.mocked(provisionServiceRoles).mockRejectedValue(PROVISIONING_ERROR);
    const response = await dispatchRealApply();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      exitCode: 1,
      error: "service_role_provisioning_failed",
      cause: REDACTED_CAUSE,
    });
    expect(logged.mock.calls.flat().join(" "))
      .toBe(`[migrator] service role provisioning failed: ${REDACTED_CAUSE}`);
  });

  it("never runs the chain behind the failed step", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(carriesAtlasLeftovers).mockResolvedValue(false);
    vi.mocked(previewPrisma).mockResolvedValue({ ...PREVIEW });
    vi.mocked(provisionServiceRoles).mockRejectedValue(PROVISIONING_ERROR);
    const response = await dispatchRealApply();
    expect(migratePrisma).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      success: false,
      error: "service_role_provisioning_failed",
    });
  });
});

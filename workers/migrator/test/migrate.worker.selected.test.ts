import { afterEach, describe, expect, it, vi } from "vitest";
import { issuedToken, joseEnv, makeApp, post, productionEnv, testEnv } from "./migrate.worker.helpers";
import { requestMetadata } from "./sealed-migrations";
import { recordingExecutor } from "./selected-executor-double";
import type { SelectedMetadata, SelectedMigration } from "../src/selected-migration";

afterEach(() => { vi.restoreAllMocks(); });

describe("selected migration metadata", () => {
  it("refuses an empty object before reading credentials or applying", async () => {
    const { app, token } = await makeApp();
    const get = (): Promise<string> => { throw new Error("credentials must remain closed"); };
    const response = await app.request("https://migrator.test/migrate", {
      method: "POST", headers: { authorization: `Bearer ${token}` }, body: "{}",
    }, { ...testEnv(), MIGRATOR_DATABASE_URL: { get } });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_migration" });
  });
  // The secret never resolved, so no apply ran: `apply_dispatch_failed`, not the narrower
  // `migration_unavailable` an apply that threw would answer (#1868).
  it("sanitizes a Secrets Store resolution failure after accepting metadata", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { app, token } = await makeApp();
    const get = (): Promise<string> => Promise.reject(new Error("password=fixture"));
    const response = await app.request(post({}, token), undefined, { ...testEnv(), MIGRATOR_DATABASE_URL: { get } });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: "apply_dispatch_failed", cause: "password=[redacted]" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("keeps database errors out of the failure response", async () => {
    const { app, token } = await makeApp({ selected: {
      preflight: () => Promise.resolve({ compatible: false, error: "unused" }),
      migrate: () => Promise.resolve({ kind: "failure", exitCode: 1, error: "password=fixture" }),
    } });
    const response = await app.request(post({}, token), undefined, testEnv());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, exitCode: 1, error: "migration_failed" });
  });
});

describe("selected metadata at the public HTTP boundary", () => {
  it("rejects an undeclared field at the correctly authenticated production worker", async () => {
    const { token, jwk } = await issuedToken({ environment: "production", sub: "repo:lifeodyssey/animichi:environment:production" });
    const { app } = await makeApp({ verifier: undefined, jwks: joseEnv(jwk) });
    const get = (): Promise<string> => { throw new Error("credentials must remain closed"); };
    const response = await app.request(post({ stagingOnly: true }, token), undefined,
      { ...productionEnv(), MIGRATOR_DATABASE_URL: { get } });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_migration" });
  });

  it("rejects an oversized metadata body before credentials", async () => {
    const { app, token } = await makeApp();
    const get = (): Promise<string> => { throw new Error("credentials must remain closed"); };
    const response = await app.request(post({ padding: "a".repeat(65_536) }, token), undefined,
      { ...testEnv(), MIGRATOR_DATABASE_URL: { get } });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "invalid_migration" });
  });

  it("forwards the complete parsed selection through the default DO binding", async () => {
    const migrate = vi.fn<(dsn: string, metadata: SelectedMetadata) => Promise<SelectedMigration>>()
      .mockResolvedValue({ kind: "success", exitCode: 0 });
    const namespace = { idFromName: () => "fixed-id", get: () => ({ migrate }) } as unknown as DurableObjectNamespace;
    const { app, token } = await makeApp({ selected: undefined });
    const response = await app.request(post({}, token), undefined, { ...testEnv(), MIGRATOR_APPLY_LOCK: namespace });
    expect(response.status).toBe(200);
    expect(migrate).toHaveBeenCalledWith("postgresql://fake:migrator@db.test/neondb", requestMetadata);
  });

  it("never reaches the executor for a body the parser refuses", async () => {
    const executor = recordingExecutor();
    const { app, token } = await makeApp({ selected: executor.selected });
    await app.request(post({ expectedPrismaRef: "not-a-hash" }, token), undefined, testEnv());
    expect(executor.calls).toEqual([]);
  });
});

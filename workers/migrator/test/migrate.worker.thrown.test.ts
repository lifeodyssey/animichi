import { afterEach, describe, expect, it, vi } from "vitest";
import { makeApp, post, testEnv } from "./migrate.worker.helpers";
import { MIGRATIONS } from "./sealed-migrations";
import { migrateSelected, preflightSelected } from "../src/selected-migration";

/* What a `/migrate` that THREW tells the operator (#1868).
 *
 * Staging failed on 2026-09-22 with `{"success":false,"error":"migration_unavailable"}` and
 * nothing else, while the platform's own message — the Durable Object reset — sat in the
 * thrown value both catch sites dropped. Every other failure of this route already names
 * itself (`refused`, a native failure code, `prisma_marker_mismatch`, `stale_prisma_bundle`);
 * a throw was the one outcome that did not. These two sites are different events, and a
 * collapse of them back into one string is what the first test here refuses.
 *
 * `scripts/delivery/migrate-through-worker.sh` prints this body verbatim into the CD log of a
 * public repository, so the second half of the file is about what may not be in it.
 */

/** Recognisable, and worth nothing: the scanner runs on every commit. */
const PLACEHOLDER = "REDACT_ME_PLACEHOLDER";
const FIXTURE_DSN = `postgresql://migrator:${PLACEHOLDER}@ep-fixture.neon.tech/neondb`;
const POOLED_DSN = "postgresql://migrator:fixture@ep-fixture-pooler.neon.tech/neondb";

afterEach(() => { vi.restoreAllMocks(); });

/** The apply never reached a verdict: the DO RPC itself failed, as it did in the outage. */
async function dispatchThrowing(message: string) {
  const { app, token } = await makeApp({ selected: {
    preflight: () => Promise.reject(new Error(message)),
    migrate: () => Promise.reject(new Error(message)),
  } });
  return await app.request(post({}, token), undefined, testEnv());
}

/** The apply ran and threw: a pooled DSN is rejected inside `migrateSelected`'s own try. */
async function applyThrowing(dsn: string) {
  const { app, token } = await makeApp({ migrationsDir: MIGRATIONS, selected: {
    preflight: (connection, metadata) => preflightSelected(connection, metadata, MIGRATIONS),
    migrate: (connection, passwords, metadata) => migrateSelected(connection, passwords, metadata, MIGRATIONS),
  } });
  return await app.request(post({}, token), undefined, { ...testEnv(), MIGRATOR_DATABASE_URL: dsn });
}

describe("a migrate request that throws", () => {
  it("tells a failed dispatch apart from an apply that threw", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const dispatched = await (await dispatchThrowing("durable object reset")).json();
    const applied = await (await applyThrowing(POOLED_DSN)).json();
    expect(dispatched).toEqual({ success: false, error: "apply_dispatch_failed", cause: "durable object reset" });
    expect(applied).toEqual({ success: false, exitCode: 1, error: "migration_unavailable", cause: "pooled endpoint rejected" });
  });

  it("carries the platform's own reset message out of the dispatch that swallowed it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reset = "A call to blockConcurrencyWhile() in a Durable Object waited for too long.";
    const response = await dispatchThrowing(reset);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: "apply_dispatch_failed", cause: reset });
  });
});

describe("what a thrown failure may not carry", () => {
  it("redacts the connection string and the password out of the response and the log", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await dispatchThrowing(`connect ${FIXTURE_DSN} failed, password=${PLACEHOLDER}`);
    const body = await response.json() as { cause: string };
    expect(body.cause).toBe("connect postgresql://[redacted] failed, password=[redacted]");
    expect(logged.mock.calls.flat().join(" ")).toBe("[migrator] apply dispatch failed: connect postgresql://[redacted] failed, password=[redacted]");
  });
});

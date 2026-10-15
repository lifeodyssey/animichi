import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { makeApp, post, SERVICE_ROLE_PASSWORDS, testEnv } from "./migrate.worker.helpers";
import { MIGRATIONS, TARGET } from "./sealed-migrations";
import { migrateSelected, preflightSelected } from "../src/selected-migration";
import type { PrismaPreview } from "../src/prisma-control";

/* #1958 — entering each apply sub-step logs its name, exactly once, and carries no credential.
 *
 * #1955's `named(step, work)` names the step that THREW, which leaves a call that only stops
 * answering silent: CD's 2026-09-24 preflight timeout arrived with an empty log. The entry line
 * is the other half — which step the migrator was in when it went quiet — and it is the reason
 * the route can answer at all. The credential half is a guard in both directions: an entry line
 * that carried the DSN or a bound password would ship it to Workers Logs at
 * `head_sampling_rate = 1` (wrangler.toml), which is exactly what the refusal paths'
 * `console.error` discipline exists to prevent.
 */

/** Recognisable, and worth nothing: the scanner runs on every commit. */
const PLACEHOLDER = "REDACT_ME_PLACEHOLDER";
const DIRECT_DSN = `postgresql://migrator:${PLACEHOLDER}@ep-fixture.neon.tech/neondb`;

const native = vi.hoisted(() => ({ preview: vi.fn(), migrate: vi.fn() }));
vi.mock("../src/prisma-control", async (original) => ({
  ...await original<typeof import("../src/prisma-control")>(),
  previewPrisma: native.preview,
  migratePrisma: native.migrate,
}));
// The ledger probe's transport is `test/neon-deadline.test.ts`'s subject; this file is about
// what the step is CALLED, so the probe answers instead of reaching for a database.
const ledger = vi.hoisted(() => ({ stranded: vi.fn() }));
vi.mock("../src/atlas-leftovers", async (original) => ({
  ...await original<typeof import("../src/atlas-leftovers")>(),
  carriesAtlasLeftovers: ledger.stranded,
}));

const preview: PrismaPreview = { targetHash: TARGET, markerHash: TARGET, migrations: [], usedLiveMarker: true };

/** Answers the provisioning step's Neon HTTP calls: three login probes and one batch. */
function serveProvisioning(): void {
  vi.stubGlobal("fetch", (_input: unknown, options?: RequestInit) => {
    const body = JSON.parse(options?.body as string) as { queries?: { query: string }[] };
    const results = body.queries?.map(() => ({ fields: [], rows: [] }));
    return Promise.resolve(Response.json(results === undefined ? { fields: [], rows: [] } : { results }));
  });
}

/** The whole apply path, in the order the sub-steps start. */
const ENTRY_LINES = [
  "assertDirectDsn", "hasPrismaSnapshot", "carriesAtlasLeftovers", "previewPrisma",
  "provisionServiceRoles", "authenticates agent_svc", "authenticates catalog_svc",
  "authenticates users_svc", "migratePrisma",
].map((step) => `[migrator] step: ${step}`);

/** Every bound secret and the DSN itself: a log line carrying any of them is the failure. */
const SECRETS = [DIRECT_DSN, PLACEHOLDER, SERVICE_ROLE_PASSWORDS.catalogSvc,
  SERVICE_ROLE_PASSWORDS.usersSvc, SERVICE_ROLE_PASSWORDS.agentSvc];

beforeEach(() => {
  native.preview.mockReset().mockResolvedValue({ ok: true, value: preview });
  native.migrate.mockReset().mockResolvedValue({ ok: true, value: { markerHash: TARGET, migrationsApplied: 0, applied: [] } });
  ledger.stranded.mockReset().mockResolvedValue(false);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("logs each sub-step's name once as it starts, and never a DSN or a bound password", async () => {
  serveProvisioning();
  const lines: string[] = [];
  const record = (line: string): void => { lines.push(line); };
  vi.spyOn(console, "log").mockImplementation(record);
  vi.spyOn(console, "error").mockImplementation(record);
  const { app, token } = await makeApp({ migrationsDir: MIGRATIONS, selected: {
    preflight: (dsn, metadata) => preflightSelected(dsn, metadata, MIGRATIONS),
    migrate: (dsn, passwords, metadata) => migrateSelected(dsn, passwords, metadata, MIGRATIONS),
  } });
  const response = await app.request(post({}, token), undefined, { ...testEnv(), MIGRATOR_DATABASE_URL: DIRECT_DSN });
  expect(await response.json()).toMatchObject({ success: true });
  expect(lines).toEqual(ENTRY_LINES);
  expect(lines.filter((line) => SECRETS.some((secret) => line.includes(secret)))).toEqual([]);
});

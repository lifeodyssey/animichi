import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NEON_CALL_DEADLINE_MS } from "../src/neon-deadline";
import { carriesAtlasLeftovers } from "../src/atlas-leftovers";
import { readMissingCatalogTables } from "../src/catalog-tables";
import { provisionServiceRoles } from "../src/service-roles";
import { migrateSelected, preflightSelected } from "../src/selected-migration";
import { makeApp, post, SERVICE_ROLE_PASSWORDS, testEnv } from "./migrate.worker.helpers";
import { MIGRATIONS } from "./sealed-migrations";

/* #1958 — every Neon HTTP call in the apply path has a deadline, and it belongs to THAT call.
 *
 * On 2026-09-24 the migrator's staging apply hung in the Atlas-leftovers probe until CD's
 * preflight curl gave up after 60 s: a call that is only slow never throws, so #1955's
 * `named(step, work)` had nothing to prefix and the log said nothing at all. The driver
 * carries `fetchOptions` into `fetch` (installed `@neondatabase/serverless@1.1.0`,
 * `index.d.ts:453`, spread at `index.mjs:1292`), so the deadline is an abort signal the driver
 * itself honours. Two ways this can go wrong are pinned here: a deadline LONGER than the CD
 * curl (the answer never arrives) and ONE deadline over the whole apply (which would abort a
 * normal ~3-minute chain apply). A third — a deadline below a legitimately slow round trip —
 * is what the constant's own bound and the workerd integration arm hold from the other side.
 */

/** Recognisable, and worth nothing: the scanner runs on every commit. */
const PLACEHOLDER = "REDACT_ME_PLACEHOLDER";
const DIRECT_DSN = `postgresql://migrator:${PLACEHOLDER}@ep-fixture.neon.tech/neondb`;
/** Short enough for the unit arm's 5 s budget. The value the call sites pass is asserted
 * separately, so shrinking the wait never shrinks the deadline under test. */
const STALL_MS = 25;

/** The real `AbortSignal.timeout`, recording every delay and shrinking only the wait. */
function recordDeadlines(): number[] {
  const real = AbortSignal.timeout.bind(AbortSignal);
  const delays: number[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation((delay: number) => {
    delays.push(delay);
    return real(Math.min(delay, STALL_MS));
  });
  return delays;
}

interface NeonCall {
  readonly signal: AbortSignal | null | undefined;
}

/** Answers every Neon HTTP call the driver makes, recording the signal it carried. The
 * ledger probe's single row is the one shape these modules read (`strandedOf`); the probes and
 * the batches only need to be answers rather than failures. */
function serveNeonHttp(calls: NeonCall[]): void {
  vi.stubGlobal("fetch", (_input: unknown, options?: RequestInit) => {
    calls.push({ signal: options?.signal });
    const body = JSON.parse(options?.body as string) as { query?: string; queries?: { query: string }[] };
    if (body.queries !== undefined) return Promise.resolve(Response.json({ results: body.queries.map(({ query }) => queryResult(query)) }));
    return Promise.resolve(Response.json(queryResult(body.query ?? "")));
  });
}

function queryResult(query: string): { fields: { name: string }[]; rows: unknown[][] } {
  return query.includes("to_regclass") ? { fields: [{ name: "ledger" }], rows: [[null]] } : { fields: [], rows: [] };
}

/** The reason the driver's own abort hands back: `AbortSignal.timeout`'s DOMException, which
 * the driver embeds in the error the route reports. */
function abortReason(signal: AbortSignal): Error {
  const reason = signal.reason as unknown;
  return reason instanceof Error ? reason : new Error("the call was aborted at its deadline");
}

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-03-01T00:00:00.000Z") }); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("bounds a call inside the CD preflight's own 60 s curl, and above the platform's own cap", () => {
  // `.github/scripts/release/schema-preflight.sh` gives the request `--max-time 60`, so a
  // deadline at or above it means curl gives up first and the named failure is never sent.
  // Below it, a round trip #1868 proves must succeed is a 31 s one
  // (`test/integration/prisma.workerd.integration.ts`), so a deadline at the platform's own
  // 30 s cap would abort a call the platform itself allows to be slow.
  expect(NEON_CALL_DEADLINE_MS).toBe(45_000);
});

it("gives every Neon HTTP call in the apply path its own fresh deadline", async () => {
  const delays = recordDeadlines();
  const calls: NeonCall[] = [];
  serveNeonHttp(calls);
  await carriesAtlasLeftovers(DIRECT_DSN);
  await readMissingCatalogTables(DIRECT_DSN);
  await provisionServiceRoles(DIRECT_DSN, SERVICE_ROLE_PASSWORDS);
  // Six calls: the ledger probe, the catalog probe, three login probes and the batch.
  expect(delays).toEqual(Array.from({ length: 6 }, () => NEON_CALL_DEADLINE_MS));
  const signals = calls.map(({ signal }) => signal);
  expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
  // Distinct signals: one shared deadline would expire on the apply's first calls and abort
  // every call after it, which is the whole-apply deadline this card refuses.
  expect(new Set(signals).size).toBe(signals.length);
  expect(signals.some((signal) => signal?.aborted === true)).toBe(false);
});

it("answers migration_unavailable naming the sub-step whose call hit its deadline", async () => {
  const delays = recordDeadlines();
  const stalled: { signal?: AbortSignal | null } = {};
  vi.stubGlobal("fetch", (_input: unknown, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = options?.signal;
    stalled.signal = signal;
    signal?.addEventListener("abort", () => { reject(abortReason(signal)); });
  }));
  const { app, token } = await makeApp({ migrationsDir: MIGRATIONS, selected: {
    preflight: (dsn, metadata) => preflightSelected(dsn, metadata, MIGRATIONS),
    migrate: (dsn, passwords, metadata) => migrateSelected(dsn, passwords, metadata, MIGRATIONS),
  } });
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const response = await app.request(post({}, token), undefined, { ...testEnv(), MIGRATOR_DATABASE_URL: DIRECT_DSN });
  const body = await response.json() as { error?: string; cause?: string };
  expect({ status: response.status, error: body.error }).toEqual({ status: 500, error: "migration_unavailable" });
  expect(body.cause).toMatch(/^carriesAtlasLeftovers: /);
  expect(delays).toEqual([NEON_CALL_DEADLINE_MS]);
  expect(stalled.signal?.aborted).toBe(true);
  expect(logged.mock.calls).toEqual([[expect.stringMatching(/^\[migrator\] apply threw: carriesAtlasLeftovers: /)]]);
});

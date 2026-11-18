import { afterEach, beforeAll, expect, vi } from "vitest";
import pg from "pg";
import { hookTimeoutMs, SPIKE_SETUP_BUDGET } from "@animichi/test-postgres";
import { FIXED_NOW } from "../migrate.worker.helpers";
import { NEON_CALL_DEADLINE_MS } from "../../src/neon-deadline";
import { APP_MIGRATION_COUNT, nativeApp, TARGET } from "./prisma-fixture";
import { openPrismaMigrationTarget, postgresHttp, type PrismaMigrationTarget } from "./prisma-postgres";
import { roleBootCluster, roleBootTest } from "./role-boot";

/* #1958's integration half: the deadlines are on every call, and the chain still applies.
 *
 * The unit arm (`test/neon-deadline.test.ts`) owns the mechanism — the abort, the route's
 * named failure, the per-call signal. What only a real database can answer is the third way
 * this card can go wrong: a deadline that is right for a hung call and wrong for a working
 * one aborts a normal chain apply, and the receipt would be the first place it showed. So the
 * transport records the signal each Neon HTTP call carried while PostgreSQL answers every one
 * of them, and the apply has to finish with the marker.
 */

let caseTarget: PrismaMigrationTarget | undefined;
let client: pg.Client | undefined;
let caseNumber = 0;
const signals: (AbortSignal | null | undefined)[] = [];
const deadlines: number[] = [];

/** Only the transport is replaced: `postgresHttp` executes the driver's payload unchanged, and
 * the recorded signal is the deadline the call carried. */
function serveRecordingPostgres(dsn: string): void {
  const real = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, "timeout").mockImplementation((delay: number) => {
    deadlines.push(delay);
    return real(delay);
  });
  vi.stubGlobal("fetch", (_input: unknown, options?: RequestInit) => {
    const headers = new Headers(options?.headers);
    signals.push(options?.signal);
    return postgresHttp(headers.get("Neon-Connection-String") ?? dsn, headers, options?.body as string);
  });
}

function targetDsn(): string {
  const dsn = caseTarget?.dsn;
  if (dsn === undefined) throw new Error("the case's target database is not open");
  return dsn;
}

/** The case's own session: the hooks own its lifetime, the case owns its use. */
function targetClient(): pg.Client {
  const session = client;
  if (session === undefined) throw new Error("the case's session is not open");
  return session;
}

beforeAll(() => roleBootCluster(), hookTimeoutMs(SPIKE_SETUP_BUDGET));
roleBootTest.beforeEach(async ({ roleBoot }) => {
  vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW });
  caseTarget = await openPrismaMigrationTarget(roleBoot.adminDsn, `neon_deadline_case_${String(caseNumber++)}`);
  signals.length = 0;
  deadlines.length = 0;
  serveRecordingPostgres(targetDsn());
  client = new pg.Client(targetDsn());
  await client.connect();
}, hookTimeoutMs(SPIKE_SETUP_BUDGET));
afterEach(async () => {
  await client?.end();
  await caseTarget?.stop();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

roleBootTest("applies the full chain while every Neon HTTP call carries its own deadline", async ({ roleBoot }) => {
  const logged: string[] = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => { logged.push(line); });
  const app = await nativeApp(targetDsn());
  const response = await roleBoot.hold(async () => app.migrate());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    success: true, prisma: { markerHash: TARGET, migrationsApplied: APP_MIGRATION_COUNT },
  });
  // The ledger probe, three login probes and the provisioning batch — each its own signal,
  // each created from the one deadline, none of them expired by the time it answered.
  expect(signals).toHaveLength(5);
  expect(deadlines).toEqual(Array.from({ length: 5 }, () => NEON_CALL_DEADLINE_MS));
  expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
  expect(new Set(signals).size).toBe(signals.length);
  expect(signals.some((signal) => signal?.aborted === true)).toBe(false);
  // The chain really ran: the receipt is a claim, this is the object it claims to have made.
  expect((await targetClient().query("SELECT to_regclass('public.pi_sessions') AS sessions")).rows).toEqual([{ sessions: "pi_sessions" }]);
  expect(logged.filter((line) => line.startsWith("[migrator] step: "))).toEqual([
    "assertDirectDsn", "hasPrismaSnapshot", "carriesAtlasLeftovers", "previewPrisma",
    "provisionServiceRoles", "authenticates agent_svc", "authenticates catalog_svc",
    "authenticates users_svc", "migratePrisma",
  ].map((step) => `[migrator] step: ${step}`));
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { Miniflare } from "miniflare";
import { bundledEntries } from "../bundle-smoke/bundled-entries.ts";
import { deployedRuntime } from "../bundle-smoke/wrangler-bundle.ts";
import { dsn, SESSION, IDENTITY } from "./postgres.ts";

export async function businessWorker(context: TestContext, bindings: Record<string, string> = {}, entry = new URL("./business-host.worker.ts", import.meta.url), catalog?: (request: Request) => Promise<Response>) {
  const directory = await mkdtemp(join(tmpdir(), "business-host-"));
  const options = { ...await bundledEntries.modules(entry.pathname), ...deployedRuntime(),
    bindings: { AGENT_SVC_DATABASE_URL: dsn, ...bindings }, durableObjectsPersist: join(directory, "state"),
    durableObjects: { SESSION: { className: "BusinessHost", useSQLite: true } },
    ...(catalog === undefined ? {} : { serviceBindings: { CATALOG: catalog } }) };
  let worker = new Miniflare(options);
  context.after(async () => { await worker.dispose(); await rm(directory, { recursive: true, force: true }); });
  await worker.ready;
  return { worker, restart: async () => { await worker.dispose(); worker = new Miniflare(options); await worker.ready; return worker; } };
}

export const submission = { sessionId: SESSION, identityId: IDENTITY, payer: "anon", locale: "ja", clientMessageId: "first", text: "Finish this request" };

/** One wake row as the retry report exposes it: the SDK's own row, minus its id and retry policy. */
export interface WakeRow { callback: string; type: string; time: number; payload: object | null }

function isRecord(payload: object | null): payload is Record<string, unknown> {
  return payload !== null;
}

/** The retry deadline a wake carries, when it is the deadline wake; the recurrent scan and the recovery nudges carry none. */
function retryDeadline(schedule: WakeRow): number | null {
  const payload = schedule.payload;
  if (!isRecord(payload) || typeof payload.notBefore !== "number") return null;
  return payload.notBefore;
}

/** The armed second of each wake that carries a retry deadline; the recurrent scan and the recovery nudges carry none. */
export function deadlineWakeTimes(schedules: WakeRow[]) {
  return schedules.filter((schedule) => retryDeadline(schedule) !== null).map((schedule) => schedule.time);
}

/** The operation's own crash-safety nudge: the accept/pre-drive arm writes exactly `{ operationId }`, with no deadline. */
function isRecoveryNudge(schedule: WakeRow) {
  const payload = schedule.payload;
  if (schedule.callback !== "wakeSession" || !isRecord(payload)) return false;
  const keys = Object.keys(payload);
  return keys.length === 1 && keys[0] === "operationId" && typeof payload.operationId === "string";
}

/** The four wakes this lane's table may hold: the recurrent scan, the deadline wake, the operation's own nudge, or a foreign re-arm. */
function wakeKind(schedule: WakeRow): "scan" | "deadline" | "nudge" | "other" {
  if (schedule.type === "interval") return "scan";
  if (retryDeadline(schedule) !== null) return "deadline";
  return isRecoveryNudge(schedule) ? "nudge" : "other";
}

/** Every armed wake that is neither the recurrent scan, the deadline wake, nor the operation's own recovery nudge. */
export function unexplainedWakes(schedules: WakeRow[]) {
  return schedules.filter((schedule) => wakeKind(schedule) === "other");
}

/**
 * Route (b) or (b′), recorded. Runs `q2/route.worker.ts` in workerd at the edge's settings: the same scenario with the
 * storage `PiHarness` passes in, a thin wrapper around it, and `MemoryStorage`. Writes `../evidence/q2-route.json`, then
 * exits non-zero if any check failed.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundle } from "./bundle.ts";
import { OutboundGuard, WorkerdLog, startWorkerd, writeEvidence } from "./workerd.ts";

interface Receipt { readonly accepted: boolean }
interface Result { readonly status: string; readonly reason?: string; readonly text?: string }
interface Observation {
  readonly variant: string;
  readonly sameObjectPiHarnessReads: boolean;
  readonly first: { readonly receipt: Receipt; readonly wait: Result; readonly settledByPi: Result | null };
  readonly duplicate: { readonly receipt: Receipt; readonly wait: Result };
  readonly userTextsInTranscript: string[];
  readonly recordsOfFirst: { readonly inPisStorage: string | null; readonly inPiHarnessStore: string | null };
  readonly slow: { readonly pendingWhileStreaming: { operationId: string; status: string }[]; readonly sessionsWhileStreaming: { id: string }[];
    readonly abortOfUnknownOperation: boolean; readonly abortOfStreamingOperation: boolean; readonly settledByPi: Result | null; readonly wait: Result };
  readonly wrapperCalls?: Record<string, number>;
}

const work = mkdtempSync(join(tmpdir(), "pi-durable-spike-route-"));
const built = await bundle("q2/route.worker.ts", work);
const log = new WorkerdLog();
const guard = new OutboundGuard();
const mf = startWorkerd(built, { run: "route", persist: join(work, "persist"), log, guard, durableObjects: {
  GIVEN: { className: "GivenStore", useSQLite: true }, WRAPPED: { className: "WrappedStore", useSQLite: true }, MEMORY: { className: "MemoryStore", useSQLite: true } } });
const observations: Observation[] = [];
try {
  for (const variant of ["given", "wrapped", "memory"]) {
    const response = await mf.dispatchFetch(`https://probe.test/${variant}`, { method: "POST" });
    const text = await response.text();
    if (response.status !== 200) throw new Error(`${variant} answered ${String(response.status)}: ${text}`);
    observations.push(JSON.parse(text) as Observation);
  }
} finally {
  await mf.dispose();
}

const checks: { readonly name: string; readonly pass: boolean; readonly observed: unknown }[] = [];
const check = (name: string, pass: boolean, observed: unknown) => { checks.push({ name, pass, observed }); };
const by = (variant: string) => observations.find((observation) => observation.variant === variant) as Observation;

for (const variant of ["given", "wrapped"]) {
  const o = by(variant);
  check(`${variant}: the first receipt is accepted and wait() answers done with Pi's text`, o.first.receipt.accepted && o.first.wait.status === "done"
    && o.first.wait.text === "Answer to: first", o.first);
  check(`${variant}: the same operationId with different content gets accepted: false, and Pi ran only the first`, !o.duplicate.receipt.accepted
    && JSON.stringify(o.userTextsInTranscript) === JSON.stringify(["first"]), { duplicate: o.duplicate, userTexts: o.userTextsInTranscript });
  check(`${variant}: PiHarness's own store holds the operation`, o.recordsOfFirst.inPiHarnessStore === "done", o.recordsOfFirst);
  check(`${variant}: abort(operationId) of the streaming operation returns true and Pi settles it unanswered (aborted)`,
    o.slow.abortOfStreamingOperation && o.slow.settledByPi?.status === "unanswered" && o.slow.settledByPi.reason === "aborted"
      && o.slow.wait.status === "unanswered", o.slow);
  check(`${variant}: sessions.list() sees the root session`, o.slow.sessionsWhileStreaming.some((session) => session.id === "1"), o.slow.sessionsWhileStreaming);
}
check("given: Pi was opened on the very object PiHarness reads", by("given").sameObjectPiHarnessReads, by("given").sameObjectPiHarnessReads);
check("wrapped: Pi committed through the wrapper (its commit count is above zero)", (by("wrapped").wrapperCalls?.commit ?? 0) > 0, by("wrapped").wrapperCalls);

const memory = by("memory");
check("memory: Pi ran the first operation to done (read from MemoryStorage)", memory.first.settledByPi?.status === "done"
  && memory.recordsOfFirst.inPisStorage === "done", { settledByPi: memory.first.settledByPi, records: memory.recordsOfFirst });
check("memory: PiHarness's own store has no record of it", memory.recordsOfFirst.inPiHarnessStore === null, memory.recordsOfFirst);
check("memory: wait() answers unanswered / not_found for an operation Pi answered", memory.first.wait.status === "unanswered"
  && memory.first.wait.reason === "not_found" && memory.duplicate.wait.reason === "not_found", { first: memory.first.wait, again: memory.duplicate.wait });
check("memory: the duplicate submit is reported accepted: true, although Pi kept one submission", memory.duplicate.receipt.accepted
  && JSON.stringify(memory.userTextsInTranscript) === JSON.stringify(["first"]), { duplicate: memory.duplicate.receipt, userTexts: memory.userTextsInTranscript });
check("memory: abort(operationId) of the streaming operation returns false, and Pi answers it anyway (done)",
  !memory.slow.abortOfStreamingOperation && memory.slow.settledByPi?.status === "done", { abort: memory.slow.abortOfStreamingOperation, settledByPi: memory.slow.settledByPi });
check("memory: sessions.list() is empty while Pi streams in the root session", memory.slow.sessionsWhileStreaming.length === 0, memory.slow.sessionsWhileStreaming);
check("memory: pending() still sees the streaming operation (it reads Pi, not the store)",
  memory.slow.pendingWhileStreaming.some((item) => item.operationId === "op-2"), memory.slow.pendingWhileStreaming);
for (const o of observations) check(`${o.variant}: abort(operationId) of an id never submitted returns false`, !o.slow.abortOfUnknownOperation, o.slow.abortOfUnknownOperation);
check("guard: no outbound request left workerd", guard.violations.length === 0, guard.violations);

writeEvidence("q2-route.json", { runtime: built.runtime, observations, checks });
for (const item of checks) console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}`);
process.exitCode = checks.every((item) => item.pass) ? 0 : 1;

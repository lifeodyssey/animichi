/**
 * Step 0 of question 1: arm an alarm, SIGKILL workerd before it fires, start a new workerd over the same persisted
 * directory and send nothing. The alarm alone must construct a new instance and run `alarm()` there.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundle } from "./bundle.ts";
import { OutboundGuard, WorkerdLog, startWorkerd, writeEvidence } from "./workerd.ts";

interface Event { readonly seq: number; readonly instance: string; readonly kind: string; readonly at: number }
interface Read { readonly instance: string; readonly alarm: number | null; readonly events: Event[] }

const work = mkdtempSync(join(tmpdir(), "pi-durable-spike-alarm-"));
const persist = join(work, "persist");
const built = await bundle("src/alarm-probe.worker.ts", work);
const log = new WorkerdLog();
const guard = new OutboundGuard();
const durableObjects = { PROBE: { className: "AlarmProbe", useSQLite: true as const } };

const first = startWorkerd(built, { run: "A", persist, log, guard, durableObjects });
const armed = await (await first.dispatchFetch("https://probe.test/arm")).json() as { instance: string; alarmAt: number };
const killedAt = Date.now();
await first.dispose();
assert.ok(killedAt < armed.alarmAt, "workerd A is killed before the alarm is due");

const second = startWorkerd(built, { run: "B", persist, log, guard, durableObjects });
await second.ready;
const restartedAt = Date.now();
const alarm = await log.waitFor("B", /alarm-probe alarm /, 90_000, "the stored alarm to restart the object in workerd B");
const read = await (await second.dispatchFetch("https://probe.test/read")).json() as Read;
await second.dispose();

const restarted = read.events.filter((event) => event.instance !== armed.instance);
const kinds = restarted.map((event) => event.kind);
const report = {
  runtime: built.runtime, armedBy: armed.instance, alarmAt: armed.alarmAt, killedAt, restartedAt, alarmLoggedAt: alarm.at,
  restartedInstances: [...new Set(restarted.map((event) => event.instance))], restartedKinds: kinds, events: read.events,
  outboundViolations: guard.violations, log: log.lines,
};
writeEvidence("q1-step0-alarm-survives-sigkill.json", report);
assert.deepEqual(guard.violations, [], "no request left through the outbound guard");
assert.deepEqual(kinds.slice(0, 2), ["constructed", "alarm"], "the new process constructs a new instance and runs the alarm before any request");
assert.equal(report.restartedInstances.length, 1, "exactly one new instance served workerd B");
console.log(JSON.stringify({ verdict: "alarm survives SIGKILL and restarts the object with no request", killedAt, restartedAt,
  alarmLoggedAt: alarm.at, restartedKinds: kinds }));

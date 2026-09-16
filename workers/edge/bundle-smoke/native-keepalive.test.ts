import assert from "node:assert/strict";
import test from "node:test";
import type { Miniflare } from "miniflare";
import { nativeWorker, request, inspect, fireDeadlineAlarm, deliverDeadlineAlarm, releaseAndRestore, type Observation, type Delivery } from "./native-keepalive-fixture.ts";

/** The runner's backstop for this file. The probe's diagnostic only has to beat it, so it is never tight. */
const TEST_TIMEOUT_MS = 120_000;
const STALL_DIAGNOSTIC_MS = TEST_TIMEOUT_MS / 4;

async function activeKeepalive(worker: Miniflare, drive: Promise<string>) {
  await Promise.race([request(worker, "/entered"), drive.then(() => assert.fail("Drive must remain pending behind the provider barrier"))]);
  const active = await inspect(worker);
  assert.ok(active.deadlineId);
  assert.equal(active.driveActive, true);
  assert.ok(active.alarm !== null && active.alarm < active.deadlineTime);
  assert.equal(active.callbackCount, 0);
  return active;
}

async function disposedKeepalive(worker: Miniflare, drive: Promise<string>, active: Observation) {
  await request(worker, "/release");
  await drive;
  await request(worker, "/drain");
  const disposed = await inspect(worker);
  assert.equal(disposed.deadlineId, active.deadlineId);
  assert.equal(disposed.deadlineTime, active.deadlineTime);
  assert.equal(disposed.driveActive, false);
  assert.equal(disposed.alarm, active.deadlineTime, "SDK cleanup must retain the original physical deadline alarm");
}

/**
 * The fired deadline's boundary, read while its callback is held and still undelivered.
 *
 * `callbackCount === 0` and a consumed alarm rule out the vacuous reading: the alarm sampled below is the
 * one an SDK re-arm wrote inside the fired window, not a post-delivery re-arm. A null alarm means the SDK
 * never re-armed, so the run never reached the clamp; an alarm in the physical future means the clamp is
 * absent and the SDK's write displaced the due deadline. Due-ness is the alarm's own instant against the
 * physical clock, not an elapsed budget.
 */
async function assertAlarmHeldDue(worker: Miniflare) {
  const held = await fireDeadlineAlarm(worker, STALL_DIAGNOSTIC_MS);
  assert.equal(held.callbackCount, 0, `The deadline callback was delivered before the observer arrived: ${JSON.stringify(held)}`);
  assert.equal(held.alarmAtCallbackEntry, null, `The fire must be consumed before its callback starts: ${JSON.stringify(held)}`);
  assert.ok(held.alarm !== null, `No SDK re-arm reached the physical alarm while the deadline was undelivered: ${JSON.stringify(held)}`);
  assert.ok(held.alarm <= held.physicalNow, `An SDK re-arm displaced the fired deadline's alarm ${String(held.alarm - held.physicalNow)} ms into the physical future: ${JSON.stringify(held)}`);
}

/** The counts bracket the wait: 0 as the observer arrived, 1 only after the delivered event. */
async function assertDeliveredByWait(worker: Miniflare) {
  const delivered: Delivery = await deliverDeadlineAlarm(worker, STALL_DIAGNOSTIC_MS);
  assert.equal(delivered.deliveredAtWait, 1, `The delivered event alone must settle the alarm-callback wait: ${JSON.stringify(delivered)}`);
  assert.equal(delivered.undeliveredAtArrival, 0, `The observer must arrive while the deadline is still undelivered: ${JSON.stringify(delivered)}`);
  assert.equal(delivered.observation.callbackCount, 1, `The deadline alarm must reach its callback exactly once: ${JSON.stringify(delivered)}`);
  assert.equal(delivered.observation.callbackDuringDrive, false);
  assert.equal(delivered.observation.completedStatus, "completed");
}

// The build, the drive and the alarm delivery each bound themselves; this timeout is only the backstop.
void test("active native keepalive preserves a deadline through cleanup and its actual alarm callback", { timeout: TEST_TIMEOUT_MS }, async (context) => {
  const worker = await nativeWorker(context);
  const drive = request(worker, "/drive");
  try {
    const active = await activeKeepalive(worker, drive);
    await disposedKeepalive(worker, drive, active);
    await assertAlarmHeldDue(worker);
    await assertDeliveredByWait(worker);
  } finally { await releaseAndRestore(worker, drive); }
});

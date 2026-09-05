/**
 * Docker-free unit tests for the bounded startup wait (#1324, moved here by #1326).
 *
 * The probe is a scripted stand-in and the pause is a recording fake, so the
 * retry decision — which failures mean "still starting", how many attempts the
 * wait may take, how long it sleeps between them — is asserted with no
 * container, no socket and no real timer.
 *
 * test-type: unit.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  isStartingUp,
  PostgresStartupWait,
  type Pause,
} from "../src/postgres-startup-wait.ts";

/** A Postgres/socket failure carrying the SQLSTATE or errno the driver reports. */
function failureWithCode(code: string): Error {
  return Object.assign(new Error(`connect failed: ${code}`), { code });
}

/** A pause that records what it was asked to wait and never actually waits. */
function recordedPauses(): { pause: Pause; waits: number[] } {
  const waits: number[] = [];
  return {
    pause: (milliseconds) => {
      waits.push(milliseconds);
      return Promise.resolve();
    },
    waits,
  };
}

/** A probe that rejects with `failure` on its first `rejections` calls. */
function probeRejecting(
  rejections: number,
  failure: Error,
): { run: () => Promise<void>; calls: () => number } {
  let taken = 0;
  return {
    run: () => {
      taken += 1;
      return taken <= rejections ? Promise.reject(failure) : Promise.resolve();
    },
    calls: () => taken,
  };
}

void test("isStartingUp recognises the startup SQLSTATE and the pre-listen socket errors", () => {
  assert.equal(isStartingUp(failureWithCode("57P03")), true);
  assert.equal(isStartingUp(failureWithCode("ECONNREFUSED")), true);
  assert.equal(isStartingUp(failureWithCode("ECONNRESET")), true);
});

void test("isStartingUp does not treat other failures as startup", () => {
  assert.equal(isStartingUp(failureWithCode("28P01")), false);
  assert.equal(isStartingUp(failureWithCode("3D000")), false);
  assert.equal(isStartingUp(new Error("no code at all")), false);
  assert.equal(isStartingUp("57P03"), false);
});

void test("the wait retries 57P03 until the server accepts a session", async () => {
  const clock = recordedPauses();
  const probe = probeRejecting(3, failureWithCode("57P03"));

  await new PostgresStartupWait({ attemptCeiling: 10, pauseMs: 250 }, clock.pause).until(probe.run);

  assert.equal(probe.calls(), 4);
  assert.deepEqual(clock.waits, [250, 250, 250]);
});

void test("the wait retries a connection refused before the server binds TCP", async () => {
  const clock = recordedPauses();
  const probe = probeRejecting(1, failureWithCode("ECONNREFUSED"));

  await new PostgresStartupWait({ attemptCeiling: 10, pauseMs: 250 }, clock.pause).until(probe.run);

  assert.equal(probe.calls(), 2);
  assert.deepEqual(clock.waits, [250]);
});

void test("the wait rethrows a failure that is not a startup symptom, without pausing", async () => {
  const clock = recordedPauses();
  const probe = probeRejecting(1, failureWithCode("28P01"));
  const wait = new PostgresStartupWait({ attemptCeiling: 10, pauseMs: 250 }, clock.pause);

  await assert.rejects(wait.until(probe.run), /connect failed: 28P01/);

  assert.equal(probe.calls(), 1);
  assert.deepEqual(clock.waits, []);
});

void test("the wait gives up at the attempt ceiling and never pauses after the last attempt", async () => {
  const clock = recordedPauses();
  const probe = probeRejecting(99, failureWithCode("57P03"));
  const wait = new PostgresStartupWait({ attemptCeiling: 5, pauseMs: 10 }, clock.pause);

  await assert.rejects(wait.until(probe.run), /still starting up after 5 connection attempts/);

  assert.equal(probe.calls(), 5);
  assert.deepEqual(clock.waits, [10, 10, 10, 10]);
});

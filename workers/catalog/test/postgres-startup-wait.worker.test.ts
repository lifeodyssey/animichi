import { describe, expect, it } from "vitest";
import {
  isStartingUp,
  PostgresStartupWait,
  SPIKE_STARTUP_WAIT,
  type Pause,
} from "./spike-db-global/postgres-startup-wait";

/**
 * Docker-free unit tests for the spike arm's startup wait
 * (test/spike-db-global/postgres-startup-wait.ts).
 *
 * The probe is a scripted stand-in and the pause is a recording fake, so the
 * retry decision — which failures mean "still starting", how many attempts the
 * wait may take, how long it sleeps between them — is asserted with no
 * container, no socket and no real timer.
 */

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
function probeRejecting(rejections: number, failure: Error): { run: () => Promise<void>; calls: () => number } {
  let taken = 0;
  return {
    run: () => {
      taken += 1;
      return taken <= rejections ? Promise.reject(failure) : Promise.resolve();
    },
    calls: () => taken,
  };
}

describe("isStartingUp", () => {
  it("recognises the startup SQLSTATE and the pre-listen socket errors", () => {
    expect(isStartingUp(failureWithCode("57P03"))).toBe(true);
    expect(isStartingUp(failureWithCode("ECONNREFUSED"))).toBe(true);
    expect(isStartingUp(failureWithCode("ECONNRESET"))).toBe(true);
  });

  it("does not treat other failures as startup", () => {
    expect(isStartingUp(failureWithCode("28P01"))).toBe(false);
    expect(isStartingUp(failureWithCode("3D000"))).toBe(false);
    expect(isStartingUp(new Error("no code at all"))).toBe(false);
    expect(isStartingUp("57P03")).toBe(false);
  });
});

describe("PostgresStartupWait", () => {
  it("retries 57P03 until the server accepts a session", async () => {
    const clock = recordedPauses();
    const probe = probeRejecting(3, failureWithCode("57P03"));

    await new PostgresStartupWait({ attemptCeiling: 10, pauseMs: 250 }, clock.pause).until(probe.run);

    expect(probe.calls()).toBe(4);
    expect(clock.waits).toEqual([250, 250, 250]);
  });

  it("retries a connection refused before the server binds TCP", async () => {
    const clock = recordedPauses();
    const probe = probeRejecting(1, failureWithCode("ECONNREFUSED"));

    await new PostgresStartupWait({ attemptCeiling: 10, pauseMs: 250 }, clock.pause).until(probe.run);

    expect(probe.calls()).toBe(2);
    expect(clock.waits).toEqual([250]);
  });

  it("rethrows a failure that is not a startup symptom, without pausing", async () => {
    const clock = recordedPauses();
    const probe = probeRejecting(1, failureWithCode("28P01"));
    const wait = new PostgresStartupWait({ attemptCeiling: 10, pauseMs: 250 }, clock.pause);

    await expect(wait.until(probe.run)).rejects.toThrow("connect failed: 28P01");

    expect(probe.calls()).toBe(1);
    expect(clock.waits).toEqual([]);
  });

  it("gives up at the attempt ceiling and never pauses after the last attempt", async () => {
    const clock = recordedPauses();
    const probe = probeRejecting(99, failureWithCode("57P03"));
    const wait = new PostgresStartupWait({ attemptCeiling: 5, pauseMs: 10 }, clock.pause);

    await expect(wait.until(probe.run)).rejects.toThrow("still starting up after 5 connection attempts");

    expect(probe.calls()).toBe(5);
    expect(clock.waits).toEqual([10, 10, 10, 10]);
  });
});

describe("SPIKE_STARTUP_WAIT", () => {
  it("bounds the spike arm at 30 attempts one second apart", () => {
    expect(SPIKE_STARTUP_WAIT).toEqual({ attemptCeiling: 30, pauseMs: 1_000 });
  });
});

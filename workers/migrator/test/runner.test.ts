import { beforeEach, describe, expect, it } from "vitest";
import {
  CloudflareContainerRunner,
  MIGRATOR_DSN_ENV,
  type MigrationContainerHandle,
} from "../src/runner";

// #1051 — the batch-container runner's exit/timeout mapping, exercised against
// a fake Durable Object namespace (no timing asserts; the runner's poll loop
// is the unit under test, driven by scripted state transitions).
function fakeNamespace(state: { status: string; exitCode?: number }) {
  const handle: MigrationContainerHandle = {
    start: (options: { envVars?: Record<string, string> }): Promise<void> => {
      seenEnv = options.envVars ?? {};
      started = true;
      return Promise.resolve();
    },
    getState: (): Promise<{ status: string; exitCode?: number }> => Promise.resolve(state),
  };
  const stub = handle as unknown;
  return {
    idFromName: () => "id",
    get: () => stub,
  } as unknown as DurableObjectNamespace;
}

let started = false;
let seenEnv: Record<string, string> = {};

describe("CloudflareContainerRunner", () => {
  beforeEach(() => {
    started = false;
    seenEnv = {};
  });

  it("injects the DSN as MIGRATOR_DATABASE_URL when starting", async () => {
    const runner = new CloudflareContainerRunner(
      fakeNamespace({ status: "stopped_with_code", exitCode: 0 }),
    );
    await runner.start("postgresql://migrator:x@db/neondb", 10_000);
    expect(started).toBe(true);
    expect(seenEnv[MIGRATOR_DSN_ENV]).toBe("postgresql://migrator:x@db/neondb");
  });

  it("maps a clean exit to success", async () => {
    const runner = new CloudflareContainerRunner(
      fakeNamespace({ status: "stopped_with_code", exitCode: 0 }),
    );
    await expect(runner.start("postgresql://x", 10_000)).resolves.toEqual({ kind: "success", exitCode: 0 });
  });

  it("maps a non-zero exit to failure with the exit code", async () => {
    const runner = new CloudflareContainerRunner(
      fakeNamespace({ status: "stopped_with_code", exitCode: 7 }),
    );
    await expect(runner.start("postgresql://x", 10_000)).resolves.toEqual({ kind: "failure", exitCode: 7 });
  });

  it("maps a missing exit code on a stopped container to a failure with a default code", async () => {
    const runner = new CloudflareContainerRunner(
      fakeNamespace({ status: "stopped_with_code" }),
    );
    await expect(runner.start("postgresql://x", 10_000)).resolves.toEqual({ kind: "failure", exitCode: 1 });
  });

  it("reports timeout when the container never reaches a terminal state", async () => {
    const runner = new CloudflareContainerRunner(
      fakeNamespace({ status: "running" }),
    );
    // timeoutMs effectively zero: the runner's poll deadline expires immediately.
    await expect(runner.start("postgresql://x", 0)).resolves.toEqual({ kind: "timeout" });
  });
});
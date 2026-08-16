import { afterEach, describe, expect, it, vi } from "vitest";
import { CLEANUP_STOP_BOUND_MS, START_RPC_TIMEOUT_MS } from "../src/runner";
import { driveStart, fakeSlot, neverResolve } from "./runner.helpers";

// #1101 — bounded best-effort stop()/destroy() cleanup: a wedged stop RPC must
// never hang the timeout/error flow. Fired via fake timers (no wall-clock).
describe("#1101: bounded best-effort stop/destroy", () => {
  it("returns the timeout outcome when stub.stop() never resolves", async () => {
    const f = fakeSlot({ status: "running" });
    f.handle.stop = () => { f.calls.stop += 1; return neverResolve(); };
    const r = await driveStart(f.runner, "postgresql://x", 0, CLEANUP_STOP_BOUND_MS);
    expect(r.ok && r.value).toMatchObject({ kind: "timeout", lastStatus: "running" });
    expect(f.calls.stop).toBe(1);
  });
  it("rethrows the start error when stop() never resolves after the bound", async () => {
    const f = fakeSlot({ status: "running" });
    f.handle.start = () => neverResolve();
    f.handle.stop = () => { f.calls.stop += 1; return neverResolve(); };
    const r = await driveStart(f.runner, "postgresql://x", 0, START_RPC_TIMEOUT_MS + CLEANUP_STOP_BOUND_MS);
    if (r.ok) throw new Error("expected start RPC to reject");
    expect(r.message).toContain("container start RPC did not return");
    expect(f.calls.stop).toBe(1);
  });
  it("returns the timeout outcome when stop() rejects and destroy() never resolves", async () => {
    const f = fakeSlot({ status: "running" });
    f.handle.stop = () => { f.calls.stop += 1; return Promise.reject(new Error("stop failed")); };
    f.handle.destroy = () => { f.calls.destroy += 1; return neverResolve(); };
    const r = await driveStart(f.runner, "postgresql://x", 0, CLEANUP_STOP_BOUND_MS);
    expect(r.ok && r.value).toMatchObject({ kind: "timeout", lastStatus: "running" });
    expect(f.calls.destroy).toBe(1);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

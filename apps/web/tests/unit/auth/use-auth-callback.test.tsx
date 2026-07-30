/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthCallback } from "../../../src/components/auth/useAuthCallback";
import type { DeferredReplayOutcome } from "../../../src/features/chat/save/createOnLogin";
import type { SessionMigrationOutcome } from "../../../src/lib/auth/sessionMigration";

// Every collaborator is a module-level constant: the effect's dependency array
// includes them, so an inline arrow would be a fresh identity on each render and
// re-fire the whole redeem — turning "called once" into an artefact of the test.
const migrated = (): Promise<SessionMigrationOutcome> => Promise.resolve("migrated");
const nothingMigrated = (): Promise<SessionMigrationOutcome> => Promise.resolve("nothing");
const failedMigration = (): Promise<SessionMigrationOutcome> => Promise.resolve("failed");
const stalledMigration = (): Promise<SessionMigrationOutcome> => new Promise(() => undefined);
const throwingMigration = (): Promise<SessionMigrationOutcome> => { throw new Error("boom"); };
const noReplay = (): Promise<DeferredReplayOutcome> => Promise.resolve("none");
const failedReplay = (): Promise<DeferredReplayOutcome> => Promise.resolve("failed");
const token = (): Promise<string | undefined> => Promise.resolve("jwt-1");
const noToken = (): Promise<string | undefined> => Promise.resolve(undefined);

beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); });

describe("useAuthCallback session migration (#507)", () => {
  it("claims the anonymous sessions with the token establish returned", async () => {
    const migrate = vi.fn(migrated);
    const view = renderHook(() => useAuthCallback(token, noReplay, migrate));
    await waitFor(() => { expect(view.result.current.state).toBe("done"); });
    expect(migrate).toHaveBeenCalledExactlyOnceWith("jwt-1");
  });

  it("never migrates when no token was established — the call needs auth", async () => {
    const migrate = vi.fn(migrated);
    const view = renderHook(() => useAuthCallback(noToken, noReplay, migrate));
    await waitFor(() => { expect(view.result.current.state).toBe("error"); });
    expect(migrate).not.toHaveBeenCalled();
  });

  it("surfaces a failed claim to the visitor instead of reporting a clean login", async () => {
    const view = renderHook(() => useAuthCallback(token, noReplay, failedMigration));
    await waitFor(() => { expect(view.result.current.state).toBe("migration-failed"); });
    expect(view.result.current.migration).toBe("failed");
  });

  it("flags a no-op claim as an anomaly when the target named a session", async () => {
    const view = renderHook(() => useAuthCallback(token, noReplay, nothingMigrated, true));
    await waitFor(() => { expect(view.result.current.migration).toBe("nothing-migrated"); });
  });

  it("leaves a no-op alone when the browser was never anonymous here", async () => {
    const view = renderHook(() => useAuthCallback(token, noReplay, nothingMigrated, false));
    await waitFor(() => { expect(view.result.current.state).toBe("done"); });
    expect(view.result.current.migration).toBeUndefined();
  });

  it("reports the anomaly as a structured record beside the surface", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const view = renderHook(() => useAuthCallback(token, noReplay, failedMigration));
    await waitFor(() => { expect(view.result.current.state).toBe("migration-failed"); });
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({ event: "auth_session_migration", anomaly: "failed" }),
    );
  });

  it("stays quiet and lands on done when the claim succeeds", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const view = renderHook(() => useAuthCallback(token, noReplay, migrated, true));
    await waitFor(() => { expect(view.result.current.state).toBe("done"); });
    expect(warn).not.toHaveBeenCalled();
  });

  it("times a stalled claim out instead of pinning the visitor on the screen", async () => {
    vi.useFakeTimers();
    const view = renderHook(() => useAuthCallback(token, noReplay, stalledMigration));
    await vi.advanceTimersByTimeAsync(4_000);
    vi.useRealTimers();
    await waitFor(() => { expect(view.result.current.state).toBe("migration-failed"); });
  });

});

describe("useAuthCallback migration recovery (#507 review)", () => {
  it("survives a migrate that THROWS: the login is not reported as an error", async () => {
    // runMigration rides a Promise.all beside the replay, so a throw here would
    // reject the whole redeem and turn a successful login into "error".
    const view = renderHook(() => useAuthCallback(token, noReplay, throwingMigration));
    await waitFor(() => { expect(view.result.current.state).toBe("migration-failed"); });
    expect(view.result.current.migration).toBe("failed");
  });

  it("shows the actionable save failure first, then the migration notice", async () => {
    const view = renderHook(() => useAuthCallback(token, failedReplay, failedMigration));
    await waitFor(() => { expect(view.result.current.state).toBe("save-failed"); });
    act(() => { view.result.current.dismissSave(); });
    expect(view.result.current.state).toBe("migration-failed");
  });

  it("retries the claim on demand and clears the notice when it lands", async () => {
    const migrate = vi.fn(failedMigration).mockImplementationOnce(failedMigration);
    const view = renderHook(() => useAuthCallback(token, noReplay, migrate));
    await waitFor(() => { expect(view.result.current.state).toBe("migration-failed"); });
    migrate.mockImplementation(migrated);
    act(() => { view.result.current.retryMigration(); });
    await waitFor(() => { expect(view.result.current.state).toBe("done"); });
  });

  it("lets the visitor move on, which navigates rather than stranding them", async () => {
    const view = renderHook(() => useAuthCallback(token, noReplay, failedMigration));
    await waitFor(() => { expect(view.result.current.state).toBe("migration-failed"); });
    act(() => { view.result.current.dismissMigration(); });
    expect(view.result.current.state).toBe("done");
    expect(view.result.current.migration).toBeUndefined();
  });
});

describe("useAuthCallback", () => {
  it("starts pending, then resolves to done once a token is established", async () => {
    const establish = vi.fn().mockResolvedValue("jwt-1");
    const view = renderHook(() => useAuthCallback(establish));
    expect(view.result.current.state).toBe("pending");
    await waitFor(() => { expect(view.result.current.state).toBe("done"); });
  });

  it("resolves to error when no token could be established", async () => {
    const establish = vi.fn().mockResolvedValue(undefined);
    const view = renderHook(() => useAuthCallback(establish));
    await waitFor(() => { expect(view.result.current.state).toBe("error"); });
  });

  it("ignores a late resolution after unmount", async () => {
    let resolve!: (token: string | undefined) => void;
    const establish = vi.fn(() => new Promise<string | undefined>((r) => { resolve = r; }));
    const view = renderHook(() => useAuthCallback(establish));
    view.unmount();
    resolve("jwt-late");
    await new Promise((r) => setTimeout(r, 10));
    expect(view.result.current.state).toBe("pending");
  });
});

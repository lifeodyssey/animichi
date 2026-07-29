/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAuthCallback } from "../../../src/components/auth/useAuthCallback";
import type { DeferredReplayOutcome } from "../../../src/features/chat/save/createOnLogin";
import type { SessionMigrationOutcome } from "../../../src/lib/auth/sessionMigration";

// Every collaborator is a module-level constant: the effect's dependency array
// includes them, so an inline arrow would be a fresh identity on each render and
// re-fire the whole redeem — turning "called once" into an artefact of the test.
const ok = (): Promise<SessionMigrationOutcome> => Promise.resolve("ok");
const failedMigration = (): Promise<SessionMigrationOutcome> => Promise.resolve("failed");
const stalledMigration = (): Promise<SessionMigrationOutcome> => new Promise(() => undefined);
const noReplay = (): Promise<DeferredReplayOutcome> => Promise.resolve("none");
const failedReplay = (): Promise<DeferredReplayOutcome> => Promise.resolve("failed");
const token = (): Promise<string | undefined> => Promise.resolve("jwt-1");
const noToken = (): Promise<string | undefined> => Promise.resolve(undefined);

afterEach(() => { vi.restoreAllMocks(); });

describe("useAuthCallback session migration (#507)", () => {
  it("claims the anonymous sessions with the token establish returned", async () => {
    const migrate = vi.fn(ok);
    const view = renderHook(() => useAuthCallback(token, noReplay, migrate));
    await waitFor(() => { expect(view.result.current.state).toBe("done"); });
    expect(migrate).toHaveBeenCalledExactlyOnceWith("jwt-1");
  });

  it("never migrates when no token was established — the call needs auth", async () => {
    const migrate = vi.fn(ok);
    const view = renderHook(() => useAuthCallback(noToken, noReplay, migrate));
    await waitFor(() => { expect(view.result.current.state).toBe("error"); });
    expect(migrate).not.toHaveBeenCalled();
  });

  it("reports a failed migration but still completes the login", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const view = renderHook(() => useAuthCallback(token, noReplay, failedMigration));
    await waitFor(() => { expect(view.result.current.state).toBe("done"); });
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({ event: "auth_session_migration_failed" }),
    );
  });

  it("stays quiet on a migration that landed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const view = renderHook(() => useAuthCallback(token, noReplay, ok));
    await waitFor(() => { expect(view.result.current.state).toBe("done"); });
    expect(warn).not.toHaveBeenCalled();
  });

  it("times a stalled migration out instead of pinning the visitor on the screen", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const view = renderHook(() => useAuthCallback(token, noReplay, stalledMigration));
    await vi.advanceTimersByTimeAsync(8_000);
    vi.useRealTimers();
    await waitFor(() => { expect(view.result.current.state).toBe("done"); });
    expect(warn).toHaveBeenCalledOnce();
  });

  it("shows only the actionable save failure when the migration failed too", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const view = renderHook(() => useAuthCallback(token, failedReplay, failedMigration));
    await waitFor(() => { expect(view.result.current.state).toBe("save-failed"); });
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

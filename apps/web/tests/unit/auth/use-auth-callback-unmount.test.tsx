/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthCallback } from "../../../src/components/auth/use-auth-callback";
import type { DeferredReplayOutcome } from "../../../src/features/chat/save/complete-deferred-save";
import type { SessionAdoptionOutcome } from "../../../src/lib/auth/session-adoption";

const adopted = (): Promise<SessionAdoptionOutcome> => Promise.resolve("adopted");
const failedAdoption = (): Promise<SessionAdoptionOutcome> => Promise.resolve("failed");
const nothingAdopted = (): Promise<SessionAdoptionOutcome> => Promise.resolve("nothing");
const stalledAdoption = (): Promise<SessionAdoptionOutcome> => new Promise(() => undefined);
const noReplay = (): Promise<DeferredReplayOutcome> => Promise.resolve("none");
const token = (): Promise<string | undefined> => Promise.resolve("jwt-1");

beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); });

describe("useAuthCallback one visit = one redeem (#1760)", () => {
  it("joins the in-flight redeem on remount instead of posting a second adopt", async () => {
    // StrictMode hydration (facebook/react#35961) re-runs the effect while the
    // first redeem is still in flight; the observable must stay one live POST.
    let release!: (token: string | undefined) => void;
    const establish = vi.fn(() => new Promise<string | undefined>((r) => { release = r; }));
    const adopt = vi.fn(adopted);
    const first = renderHook(() => useAuthCallback(establish, noReplay, adopt));
    first.unmount();
    const second = renderHook(() => useAuthCallback(establish, noReplay, adopt));
    expect(establish).toHaveBeenCalledOnce();
    expect(adopt).not.toHaveBeenCalled();
    act(() => { release("jwt-1"); });
    await waitFor(() => { expect(second.result.current.state).toBe("done"); });
    expect(adopt).toHaveBeenCalledExactlyOnceWith("jwt-1");
  });

  it("reports no adoption anomaly once the visitor has navigated away", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const view = renderHook(() => useAuthCallback(token, noReplay, failedAdoption));
    view.unmount();
    // The unmounted redeem settles in pure microtasks; one timer-loop pass
    // drains them without firing the 4s adopt timeout. No real clock involved.
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
    expect(warn).not.toHaveBeenCalledWith(
      JSON.stringify({ event: "auth_session_adoption", anomaly: "failed" }),
    );
  });

  it("gives the remounted instance's retry the redeem's timeout memory (#960)", async () => {
    // The redeem joins across the StrictMode remount and records its timeout
    // on the visit it belongs to: the server may still have landed a timed-out
    // attempt, so the live instance's retry seeing "nothing" is that landing —
    // the notice must clear, not persist as nothing-adopted.
    vi.useFakeTimers();
    const adopt = vi.fn(stalledAdoption);
    const first = renderHook(() => useAuthCallback(token, noReplay, adopt, true));
    first.unmount();
    const second = renderHook(() => useAuthCallback(token, noReplay, adopt, true));
    await vi.advanceTimersByTimeAsync(4_000);
    vi.useRealTimers();
    await waitFor(() => { expect(second.result.current.state).toBe("adoption-failed"); });
    adopt.mockImplementation(nothingAdopted);
    act(() => { second.result.current.retryAdoption(); });
    await waitFor(() => { expect(second.result.current.state).toBe("done"); });
    expect(second.result.current.adoption).toBeUndefined();
  });
});

describe("useAuthCallback retry settling after unmount (#1765)", () => {
  it("silences a retry that settles after the visitor has moved on", async () => {
    // The retry is user-initiated on a live screen but can land on a dead one:
    // the visitor gives up on a slow claim and navigates away, then the held
    // attempt settles. Like the initial redeem (#1760), it must stay silent —
    // no anomaly report with nobody home, no write into the gone mount.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let releaseRetry!: (outcome: SessionAdoptionOutcome) => void;
    const heldRetry = (): Promise<SessionAdoptionOutcome> =>
      new Promise((resolve) => { releaseRetry = resolve; });
    const adopt = vi.fn(failedAdoption);
    const view = renderHook(() => useAuthCallback(token, noReplay, adopt, true));
    await waitFor(() => { expect(view.result.current.state).toBe("adoption-failed"); });
    adopt.mockImplementation(heldRetry);
    act(() => { view.result.current.retryAdoption(); });
    await waitFor(() => { expect(adopt).toHaveBeenCalledTimes(2); });
    view.unmount();
    act(() => { releaseRetry("nothing"); });
    // The settled retry is pure microtasks; one timer-loop pass drains them
    // without firing the 4s adopt timeout. No real clock involved.
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
    expect(warn).not.toHaveBeenCalledWith(
      JSON.stringify({ event: "auth_session_adoption", anomaly: "nothing-adopted" }),
    );
  });
});

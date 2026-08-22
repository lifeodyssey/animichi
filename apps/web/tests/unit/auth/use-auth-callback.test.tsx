/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthCallback } from "../../../src/components/auth/use-auth-callback";
import type { DeferredReplayOutcome } from "../../../src/features/chat/save/complete-deferred-save";
import type { SessionAdoptionOutcome } from "../../../src/lib/auth/session-adoption";

// Every collaborator is a module-level constant: the effect's dependency array
// includes them, so an inline arrow would be a fresh identity on each render and
// re-fire the whole redeem — turning "called once" into an artefact of the test.
const adopted = (): Promise<SessionAdoptionOutcome> => Promise.resolve("adopted");
const nothingAdopted = (): Promise<SessionAdoptionOutcome> => Promise.resolve("nothing");
const failedAdoption = (): Promise<SessionAdoptionOutcome> => Promise.resolve("failed");
const stalledAdoption = (): Promise<SessionAdoptionOutcome> => new Promise(() => undefined);
const throwingAdoption = (): Promise<SessionAdoptionOutcome> => { throw new Error("boom"); };
const noReplay = (): Promise<DeferredReplayOutcome> => Promise.resolve("none");
const failedReplay = (): Promise<DeferredReplayOutcome> => Promise.resolve("failed");
const token = (): Promise<string | undefined> => Promise.resolve("jwt-1");
const noToken = (): Promise<string | undefined> => Promise.resolve(undefined);

beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); });

describe("useAuthCallback session adoption (#507)", () => {
  it("claims the anonymous sessions with the token establish returned", async () => {
    const adopt = vi.fn(adopted);
    const view = renderHook(() => useAuthCallback(token, noReplay, adopt));
    await waitFor(() => { expect(view.result.current.state).toBe("done"); });
    expect(adopt).toHaveBeenCalledExactlyOnceWith("jwt-1");
  });

  it("never adopts when no token was established — the call needs auth", async () => {
    const adopt = vi.fn(adopted);
    const view = renderHook(() => useAuthCallback(noToken, noReplay, adopt));
    await waitFor(() => { expect(view.result.current.state).toBe("error"); });
    expect(adopt).not.toHaveBeenCalled();
  });

  it("surfaces a failed claim to the visitor instead of reporting a clean login", async () => {
    const view = renderHook(() => useAuthCallback(token, noReplay, failedAdoption));
    await waitFor(() => { expect(view.result.current.state).toBe("adoption-failed"); });
    expect(view.result.current.adoption).toBe("failed");
  });

  it("flags a no-op claim as an anomaly when the target named a session", async () => {
    const view = renderHook(() => useAuthCallback(token, noReplay, nothingAdopted, true));
    await waitFor(() => { expect(view.result.current.adoption).toBe("nothing-adopted"); });
  });

  it("leaves a no-op alone when the browser was never anonymous here", async () => {
    const view = renderHook(() => useAuthCallback(token, noReplay, nothingAdopted, false));
    await waitFor(() => { expect(view.result.current.state).toBe("done"); });
    expect(view.result.current.adoption).toBeUndefined();
  });

  it("reports the anomaly as a structured record beside the surface", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const view = renderHook(() => useAuthCallback(token, noReplay, failedAdoption));
    await waitFor(() => { expect(view.result.current.state).toBe("adoption-failed"); });
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({ event: "auth_session_adoption", anomaly: "failed" }),
    );
  });

  it("stays quiet and lands on done when the claim succeeds", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const view = renderHook(() => useAuthCallback(token, noReplay, adopted, true));
    await waitFor(() => { expect(view.result.current.state).toBe("done"); });
    expect(warn).not.toHaveBeenCalled();
  });

  it("times a stalled claim out instead of pinning the visitor on the screen", async () => {
    vi.useFakeTimers();
    const view = renderHook(() => useAuthCallback(token, noReplay, stalledAdoption));
    await vi.advanceTimersByTimeAsync(4_000);
    vi.useRealTimers();
    await waitFor(() => { expect(view.result.current.state).toBe("adoption-failed"); });
  });

});

describe("useAuthCallback adoption recovery (#507 review)", () => {
  it("survives an adopt that THROWS: the login is not reported as an error", async () => {
    // runAdoption rides a Promise.all beside the replay, so a throw here would
    // reject the whole redeem and turn a successful login into "error".
    const view = renderHook(() => useAuthCallback(token, noReplay, throwingAdoption));
    await waitFor(() => { expect(view.result.current.state).toBe("adoption-failed"); });
    expect(view.result.current.adoption).toBe("failed");
  });

  it("shows the actionable save failure first, then the adoption notice", async () => {
    const view = renderHook(() => useAuthCallback(token, failedReplay, failedAdoption));
    await waitFor(() => { expect(view.result.current.state).toBe("save-failed"); });
    act(() => { view.result.current.dismissSave(); });
    expect(view.result.current.state).toBe("adoption-failed");
  });

  it("retries the claim on demand and clears the notice when it lands", async () => {
    const adopt = vi.fn(failedAdoption).mockImplementationOnce(failedAdoption);
    const view = renderHook(() => useAuthCallback(token, noReplay, adopt));
    await waitFor(() => { expect(view.result.current.state).toBe("adoption-failed"); });
    adopt.mockImplementation(adopted);
    act(() => { view.result.current.retryAdoption(); });
    await waitFor(() => { expect(view.result.current.state).toBe("done"); });
  });

  it("converges: a timed-out first claim whose retry lands the late success clears the notice", async () => {
    // SESSION-2 #960: the first request times out (outcome unknown), the retry
    // observes the server already adopted the sessions (0 rows) — that is the
    // first request having landed, so the notice must clear, not persist.
    const adopt = vi.fn(stalledAdoption);
    const view = renderHook(() => useAuthCallback(token, noReplay, adopt, true));
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(4_000);
    vi.useRealTimers();
    await waitFor(() => { expect(view.result.current.state).toBe("adoption-failed"); });
    adopt.mockImplementation(nothingAdopted);
    act(() => { view.result.current.retryAdoption(); });
    await waitFor(() => { expect(view.result.current.state).toBe("done"); });
    expect(view.result.current.adoption).toBeUndefined();
  });

  it("still flags a no-op retry when no prior attempt timed out", async () => {
    // The genuine no-op: the first claim failed outright (a 5xx, not a
    // timeout), and the retry still moves nothing — that stays an anomaly.
    const adopt = vi.fn(failedAdoption).mockImplementationOnce(failedAdoption);
    const view = renderHook(() => useAuthCallback(token, noReplay, adopt, true));
    await waitFor(() => { expect(view.result.current.state).toBe("adoption-failed"); });
    adopt.mockImplementation(nothingAdopted);
    act(() => { view.result.current.retryAdoption(); });
    await waitFor(() => { expect(view.result.current.adoption).toBe("nothing-adopted"); });
  });

  it("lets the visitor move on, which navigates rather than stranding them", async () => {
    const view = renderHook(() => useAuthCallback(token, noReplay, failedAdoption));
    await waitFor(() => { expect(view.result.current.state).toBe("adoption-failed"); });
    act(() => { view.result.current.dismissAdoption(); });
    expect(view.result.current.state).toBe("done");
    expect(view.result.current.adoption).toBeUndefined();
  });
});

describe("use-auth-callback", () => {
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

  it("surfaces the SDK error.message when establish rejects", async () => {
    const establish = vi.fn().mockRejectedValue(new Error("INVALID_TOKEN"));
    const view = renderHook(() => useAuthCallback(establish));
    await waitFor(() => { expect(view.result.current.state).toBe("error"); });
    expect(view.result.current.errorMessage).toBe("INVALID_TOKEN");
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

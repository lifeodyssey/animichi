/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatActions } from "../../../src/features/chat/chat-actions";
import {
  UNLOCKED,
  lockHolds,
  lockedRecompute,
  releaseDelay,
  resetInstant,
  useLockedActions,
  useQuotaRelease,
} from "../../../src/features/chat/quota-lock";
import type { RecomputeTurn } from "../../../src/features/chat/selection/useRecomputeTurn";

const NOW = Date.parse("2026-07-28T12:00:00Z");
const LATER = Date.parse("2026-07-29T00:00:00Z");

describe("resetInstant", () => {
  it("parses the contract's offset-bearing ISO instant", () => {
    expect(resetInstant("2026-07-29T00:00:00Z")).toBe(LATER);
  });

  it("treats an unparseable instant as absent rather than locking forever", () => {
    expect(resetInstant("not-a-time")).toBeUndefined();
    expect(resetInstant(undefined)).toBeUndefined();
  });
});

describe("lockHolds", () => {
  it("holds while the reset instant is still ahead", () => {
    expect(lockHolds({ locked: true, resetsAtMs: LATER }, NOW)).toBe(true);
  });

  it("releases once the reset instant has passed — a new day starts at full quota", () => {
    expect(lockHolds({ locked: true, resetsAtMs: NOW - 1 }, NOW)).toBe(false);
  });

  it("holds an unknown reset instant, since nothing else would ever release it", () => {
    expect(lockHolds({ locked: true, resetsAtMs: undefined }, NOW)).toBe(true);
  });

  it("never holds when the lock was not taken", () => {
    expect(lockHolds(UNLOCKED, NOW)).toBe(false);
  });
});

describe("releaseDelay", () => {
  it("waits exactly until the reset instant", () => {
    expect(releaseDelay(NOW + 60_000, NOW)).toBe(60_000);
  });

  it("fires at once for a reset instant already behind us", () => {
    expect(releaseDelay(NOW - 1, NOW)).toBe(0);
  });

  it("refuses a delay past setTimeout's 32-bit ceiling, which would fire instantly", () => {
    // ~24.8 days is the overflow boundary: one ms past it and the browser
    // releases the lock the moment it is taken.
    expect(releaseDelay(NOW + 2_147_483_648, NOW)).toBeUndefined();
    expect(releaseDelay(NOW + 2_147_483_647, NOW)).toBe(2_147_483_647);
  });

  it("has nothing to schedule without a reset instant", () => {
    expect(releaseDelay(undefined, NOW)).toBeUndefined();
  });
});

describe("lockedRecompute", () => {
  function recompute(fire: () => void): RecomputeTurn {
    return { status: "idle", lastSentIds: undefined, fire };
  }

  it("swallows the E2 tray's bypass send while the quota lock holds", () => {
    const fire = vi.fn();
    lockedRecompute(recompute(fire), true).fire(["p-1"]);
    expect(fire).not.toHaveBeenCalled();
  });

  it("leaves the tray alone when unlocked", () => {
    const fire = vi.fn();
    lockedRecompute(recompute(fire), false).fire(["p-1"]);
    expect(fire).toHaveBeenCalledWith(["p-1"]);
  });

  it("keeps the tray's other state visible so the bar still renders", () => {
    const locked = lockedRecompute({ status: "busy", lastSentIds: ["p-1"], fire: vi.fn() }, true);
    expect(locked.status).toBe("busy");
    expect(locked.lastSentIds).toEqual(["p-1"]);
  });
});

describe("useLockedActions", () => {
  function live(): ChatActions {
    return { send: vi.fn(), regenerate: vi.fn(), sendWithOrigin: vi.fn() };
  }

  it("no-ops every action the card tree can reach, not just the composer's send", () => {
    const actions = live();
    const { result } = renderHook(() => useLockedActions(actions, true));
    result.current.send("ユーフォ");
    result.current.regenerate();
    result.current.sendWithOrigin?.("ユーフォ", 34.8, 135.8);
    expect(actions.send).not.toHaveBeenCalled();
    expect(actions.regenerate).not.toHaveBeenCalled();
    expect(actions.sendWithOrigin).not.toHaveBeenCalled();
  });

  it("hands the live actions straight back when unlocked", () => {
    const actions = live();
    const { result } = renderHook(() => useLockedActions(actions, false));
    result.current.send("ユーフォ");
    expect(actions.send).toHaveBeenCalledWith("ユーフォ");
  });
});

describe("useQuotaRelease", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("releases the lock by itself once the reset instant arrives", () => {
    vi.setSystemTime(NOW);
    const release = vi.fn();
    renderHook(() => { useQuotaRelease({ locked: true, resetsAtMs: NOW + 60_000 }, release); });
    expect(release).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("never schedules a release the visitor cannot wait out", () => {
    vi.setSystemTime(NOW);
    const release = vi.fn();
    renderHook(() => { useQuotaRelease({ locked: true, resetsAtMs: undefined }, release); });
    act(() => { vi.advanceTimersByTime(86_400_000); });
    expect(release).not.toHaveBeenCalled();
  });

  it("holds the lock rather than releasing it instantly on a 32-bit overflow", () => {
    vi.setSystemTime(NOW);
    const release = vi.fn();
    const far = { locked: true, resetsAtMs: NOW + 2_147_483_648 };
    renderHook(() => { useQuotaRelease(far, release); });
    act(() => { vi.advanceTimersByTime(1); });
    expect(release).not.toHaveBeenCalled();
  });

  it("cancels a pending release when the banner unmounts", () => {
    vi.setSystemTime(NOW);
    const release = vi.fn();
    const view = renderHook(() => { useQuotaRelease({ locked: true, resetsAtMs: NOW + 60_000 }, release); });
    view.unmount();
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(release).not.toHaveBeenCalled();
  });

  it("schedules nothing while unlocked", () => {
    const release = vi.fn();
    renderHook(() => { useQuotaRelease(UNLOCKED, release); });
    act(() => { vi.advanceTimersByTime(86_400_000); });
    expect(release).not.toHaveBeenCalled();
  });
});

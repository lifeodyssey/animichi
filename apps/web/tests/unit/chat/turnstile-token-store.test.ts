import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TURNSTILE_HEADER,
  TURNSTILE_TOKEN_TTL_MS,
  awaitTurnstileToken,
  clearTurnstileToken,
  currentTurnstileToken,
  onTurnstileToken,
  rememberTurnstileToken,
  turnstileHeaders,
} from "../../../src/lib/turnstile/tokenStore";

const T0 = 1_000_000;

afterEach(() => {
  clearTurnstileToken();
  vi.useRealTimers();
});

describe("AC2 short-lived token window (mocked clock, never wall time)", () => {
  it("keeps offering the same token for every turn inside the window", () => {
    rememberTurnstileToken("solved-token", T0);
    expect(currentTurnstileToken(T0)).toBe("solved-token");
    expect(currentTurnstileToken(T0 + 1)).toBe("solved-token");
    expect(currentTurnstileToken(T0 + TURNSTILE_TOKEN_TTL_MS - 1)).toBe("solved-token");
  });

  it("stops offering the token once the window closes", () => {
    rememberTurnstileToken("solved-token", T0);
    expect(currentTurnstileToken(T0 + TURNSTILE_TOKEN_TTL_MS)).toBeUndefined();
  });

  it("replaces the held token when a fresh challenge is solved", () => {
    rememberTurnstileToken("first", T0);
    rememberTurnstileToken("second", T0 + 10);
    expect(currentTurnstileToken(T0 + 10)).toBe("second");
  });

  it("treats an empty token as a clear", () => {
    rememberTurnstileToken("first", T0);
    rememberTurnstileToken("", T0);
    expect(currentTurnstileToken(T0)).toBeUndefined();
  });
});

describe("turnstileHeaders", () => {
  it("emits the cf-turnstile-response header while a token is held", () => {
    rememberTurnstileToken("solved-token", T0);
    expect(turnstileHeaders(T0)).toEqual({ [TURNSTILE_HEADER]: "solved-token" });
  });

  it("emits nothing when no token is held", () => {
    expect(turnstileHeaders(T0)).toEqual({});
  });

  it("emits nothing after the window closed", () => {
    rememberTurnstileToken("solved-token", T0);
    expect(turnstileHeaders(T0 + TURNSTILE_TOKEN_TTL_MS)).toEqual({});
  });
});

describe("default clock argument", () => {
  it("reads the system clock, which the fake timer controls", () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    rememberTurnstileToken("solved-token");
    expect(turnstileHeaders()).toEqual({ [TURNSTILE_HEADER]: "solved-token" });
    vi.setSystemTime(T0 + TURNSTILE_TOKEN_TTL_MS);
    expect(turnstileHeaders()).toEqual({});
  });
});

// The worker defines its own TURNSTILE_HEADER constant, and every other test on
// both sides imports the constant it is testing — so renaming one side alone
// leaves both suites green while anonymous turns silently arrive tokenless and
// 403 forever. Pin the wire name as a literal on each side independently.
describe("the cf-turnstile-response wire name", () => {
  it("is literally cf-turnstile-response, matching the worker's constant", () => {
    expect(TURNSTILE_HEADER).toBe("cf-turnstile-response");
  });

  it("emits that literal name as the header key", () => {
    rememberTurnstileToken("solved", 0);
    expect(turnstileHeaders(0)).toEqual({ "cf-turnstile-response": "solved" });
    clearTurnstileToken();
  });
});

describe("waiting for a token (issue #447 review)", () => {
  it("resolves a parked caller the moment the widget solves", async () => {
    const pending = awaitTurnstileToken();
    rememberTurnstileToken("late-token");
    expect(await pending).toBe("late-token");
  });

  it("resolves immediately when a token is already held", async () => {
    rememberTurnstileToken("held-token");
    expect(await awaitTurnstileToken()).toBe("held-token");
  });

  it("abandons parked callers when the token is cleared, leaving no live timer", async () => {
    const pending = awaitTurnstileToken();
    clearTurnstileToken();
    expect(await pending).toBeUndefined();
  });

  it("gives up once the wait elapses rather than parking forever", async () => {
    vi.useFakeTimers();
    const pending = awaitTurnstileToken(1_000);
    vi.advanceTimersByTime(1_001);
    await expect(pending).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  it("notifies every subscriber and stops after unsubscribe", () => {
    const seen: string[] = [];
    const stop = onTurnstileToken((token) => seen.push(token));
    rememberTurnstileToken("first");
    stop();
    rememberTurnstileToken("second");
    expect(seen).toEqual(["first"]);
  });
});

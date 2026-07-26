import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TURNSTILE_HEADER,
  TURNSTILE_TOKEN_TTL_MS,
  clearTurnstileToken,
  currentTurnstileToken,
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

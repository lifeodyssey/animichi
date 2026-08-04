import { describe, expect, it, vi } from "vitest";
import { TURNSTILE_REQUIRED_CODE } from "../../../src/lib/chat/errorClassifier";
import { maskRecomputeFailure, turnFailureState } from "../../../src/features/chat/use-turn-failure";
import type { FailingTurn } from "../../../src/features/chat/use-turn-failure";
import type { TurnFailureView } from "../../../src/features/chat/components/ErrorStates/TurnFailure";
import type { RecomputeTurn } from "../../../src/features/chat/selection/useRecomputeTurn";
import type { ChatErrorState } from "../../../src/lib/chat/errorClassifier";

/**
 * Classification-level guards for the two suppressions that decide whether an
 * inline failure strip appears at all.
 *
 * The challenged branch (#463 / issue #447 P1-3) had no test: deleting it left
 * the whole suite green, so nothing proved a challenged turn stays silent.
 * Found while hand-merging #282 onto #463 — exactly the branch a rebase could
 * have dropped unnoticed.
 */
function settledTurn(code: string | undefined, status = 403): FailingTurn {
  return {
    status: "ready",
    error: new Error("rejected"),
    lastErrorCode: () => code,
    lastHttpStatus: () => status,
  };
}

const failedRecompute: RecomputeTurn = { status: "failed", lastSentIds: undefined, fire: vi.fn() };

function failureView(state: ChatErrorState): TurnFailureView {
  return { state, onRetry: vi.fn(), onExpiredResume: vi.fn(), recovering: false };
}

describe("Turnstile suppression (#447 P1-3)", () => {
  it("stays silent when a widget is on the page to offer the recovery", () => {
    expect(turnFailureState(settledTurn(TURNSTILE_REQUIRED_CODE), false, true)).toBeUndefined();
  });

  it("still renders the generic retry when no widget can be rendered", () => {
    // A misconfigured build rejects every turn with nothing to click; silence
    // there would look like the chat dying rather than a recoverable failure.
    expect(turnFailureState(settledTurn(TURNSTILE_REQUIRED_CODE), false, false)).toBe("D4");
  });

  it("suppresses only the challenge code, never an unrelated rejection", () => {
    expect(turnFailureState(settledTurn("anon_quota_exhausted"), false, true)).toBe("D12");
    expect(turnFailureState(settledTurn(undefined, 401), false, true)).toBe("D8");
  });
});

describe("turnFailureState's other gates", () => {
  it("reports nothing while the turn is still in flight", () => {
    const active = { ...settledTurn(undefined), status: "streaming" } as const;
    expect(turnFailureState(active, false, false)).toBeUndefined();
  });

  it("lets the watchdog win over classification", () => {
    expect(turnFailureState(settledTurn(undefined), true, false)).toBe("D5");
  });

  it("reports nothing for a turn that never failed", () => {
    const clean = { ...settledTurn(undefined), error: undefined };
    expect(turnFailureState(clean, false, false)).toBeUndefined();
  });
});

describe("maskRecomputeFailure", () => {
  it("surfaces D12 after a failed recompute", () => {
    const failure = failureView("D12");
    expect(maskRecomputeFailure(failedRecompute, failure)).toBe(failure);
  });

  it("surfaces D13 after a failed recompute", () => {
    const failure = failureView("D13");
    expect(maskRecomputeFailure(failedRecompute, failure)).toBe(failure);
  });

  it("surfaces D14 after a failed recompute", () => {
    const failure = failureView("D14");
    expect(maskRecomputeFailure(failedRecompute, failure)).toBe(failure);
  });

  it("masks a retryable failure after a failed recompute", () => {
    expect(maskRecomputeFailure(failedRecompute, failureView("D4"))).toBeUndefined();
  });
});

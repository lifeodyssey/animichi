/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TurnFailure } from "../../../src/features/chat/components/ErrorStates/TurnFailure";
import type { TurnFailureView } from "../../../src/features/chat/components/ErrorStates/TurnFailure";
import { chatDictFor } from "../../../src/features/chat/i18n";
import type { ChatErrorState } from "../../../src/lib/chat/errorClassifier";
import { classifyFailure } from "../../../src/lib/chat/errorClassifier";
import { renderWithLocale, setLanguages } from "../_i18n";

const dict = chatDictFor("ja");

function viewOf(state: ChatErrorState): TurnFailureView {
  return { state, onRetry: vi.fn(), onExpiredResume: vi.fn(), recovering: false };
}

function renderState(state: ChatErrorState, onOpenSettings?: () => void): void {
  renderWithLocale(<TurnFailure view={viewOf(state)} dict={dict} locale="ja" onOpenSettings={onOpenSettings} />);
}

beforeEach(() => { setLanguages(["ja-JP"]); });
afterEach(() => { cleanup(); });

describe("classifier — BYOK 403 codes (T8-AC7, touchpoint C)", () => {
  it("classifies byok_requires_login into the BYOK journey entry, not D8", () => {
    expect(classifyFailure({ kind: "http", status: 403, code: "byok_requires_login" })).toBe("D13");
  });

  it("classifies byok_credential_rejected into the key-not-accepted state, not D8", () => {
    expect(classifyFailure({ kind: "http", status: 403, code: "byok_credential_rejected" })).toBe("D14");
  });

  it("keeps a bare 403 on the D8 session-expired story", () => {
    expect(classifyFailure({ kind: "http", status: 403 })).toBe("D8");
  });
});

describe("TurnFailure — D13 renders the BYOK journey entry", () => {
  it("shows the value explainer instead of the generic failure banner", () => {
    renderState("D13");
    expect(screen.getByText(dict.byok.errorRequiresLogin)).toBeTruthy();
    expect(screen.getByText(dict.byok.upsellBenefit)).toBeTruthy();
    expect(screen.getByRole("button", { name: dict.byok.signInToSetUp })).toBeTruthy();
  });

  it("does not tell the session-expired story", () => {
    renderState("D13");
    expect(screen.queryByRole("button", { name: dict.errorStates.d8Resume })).toBeNull();
  });
});

describe("TurnFailure — D14 key-not-accepted (T6-AC7)", () => {
  it("says the key was not accepted and that chat will not silently continue", () => {
    renderState("D14");
    expect(screen.getByRole("alert").textContent).toContain(dict.byok.notAccepted);
  });

  it("offers no generic retry that would just replay the failure", () => {
    renderState("D14");
    expect(screen.queryByRole("button", { name: dict.errorStates.d4Retry })).toBeNull();
  });

  it("offers the way to the fix: an open-key-settings action (#480 P2-1)", () => {
    const openSettings = vi.fn();
    renderState("D14", openSettings);
    fireEvent.click(screen.getByRole("button", { name: dict.byok.openSettings }));
    expect(openSettings).toHaveBeenCalledTimes(1);
  });
});

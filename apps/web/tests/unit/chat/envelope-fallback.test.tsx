/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatActionsProvider } from "../../../src/features/chat/ChatActions";
import type { ChatActions } from "../../../src/features/chat/ChatActions";
import { EnvelopeFallback } from "../../../src/features/chat/components/ErrorStates/EnvelopeFallback";
import { ShortRouteNotice } from "../../../src/features/chat/components/ErrorStates/ShortRouteNotice";
import { chatDictFor } from "../../../src/features/chat/i18n";

afterEach(cleanup);

const ja = chatDictFor("ja");

function actions(overrides: Partial<ChatActions> = {}): ChatActions {
  return { send: vi.fn(), regenerate: vi.fn(), ...overrides };
}

function renderWithActions(ui: ReactElement, acted: ChatActions) {
  return render(<ChatActionsProvider actions={acted}>{ui}</ChatActionsProvider>);
}

describe("EnvelopeFallback D1 (recognition failure)", () => {
  it("offers a focused clue entry without duplicate headings or unrelated suggestions", () => {
    renderWithActions(<EnvelopeFallback state="D1" dict={ja} />, actions());
    expect(screen.getByText(ja.errorStates.d1Title)).toBeTruthy();
    expect(screen.getByText(ja.errorStates.d1Hint)).toBeTruthy();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByRole("textbox", { name: ja.errorStates.d1Label })).toBeTruthy();
    for (const chip of ja.chips) expect(screen.queryByRole("button", { name: chip.text })).toBeNull();
  });

  it("sends the user's trimmed clue as the next message and keeps it visible", () => {
    const send = vi.fn();
    renderWithActions(<EnvelopeFallback state="D1" dict={ja} />, actions({ send }));
    const field = screen.getByRole("textbox", { name: ja.errorStates.d1Label });
    fireEvent.change(field, { target: { value: "  響け！ユーフォニアム  " } });
    fireEvent.click(screen.getByRole("button", { name: ja.errorStates.d1Submit }));
    expect(send).toHaveBeenCalledWith("響け！ユーフォニアム");
    expect((field as HTMLInputElement).value).toBe("  響け！ユーフォニアム  ");
    expect(screen.getByRole("status").textContent).toBe(ja.errorStates.d1Sent);
  });
});

describe("EnvelopeFallback D2 (zero pilgrimage spots)", () => {
  it("accepts a different title or region without claiming the catalog lacks the work", () => {
    const send = vi.fn();
    renderWithActions(<EnvelopeFallback state="D2" dict={ja} />, actions({ send }));
    expect(screen.getByText(ja.errorStates.d2Title)).toBeTruthy();
    expect(screen.getByText(ja.errorStates.d2Hint)).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: ja.errorStates.d2Label }), { target: { value: "京都" } });
    fireEvent.click(screen.getByRole("button", { name: ja.errorStates.d2Submit }));
    expect(send).toHaveBeenCalledWith("京都");
    expect(document.body.textContent).not.toContain("Anitabi");
  });
});

describe("EnvelopeFallback D6 (validation rejection)", () => {
  it("shows only the in-character apology and retries via regenerate", () => {
    const regenerate = vi.fn();
    renderWithActions(<EnvelopeFallback state="D6" dict={ja} />, actions({ regenerate }));
    expect(screen.getByRole("alert").textContent).toContain(ja.errorStates.d6Message);
    fireEvent.click(screen.getByRole("button", { name: ja.errorStates.d6Retry }));
    expect(regenerate).toHaveBeenCalledTimes(1);
  });

  it("never surfaces ModelRetry or output_validator vocabulary", () => {
    renderWithActions(<EnvelopeFallback state="D6" dict={ja} />, actions());
    expect(document.body.textContent).not.toContain("ModelRetry");
    expect(document.body.textContent).not.toContain("output_validator");
  });
});

describe("EnvelopeFallback D5 (settled timeout envelope)", () => {
  it("keeps the same retry shape with the timeout copy", () => {
    const regenerate = vi.fn();
    renderWithActions(<EnvelopeFallback state="D5" dict={ja} />, actions({ regenerate }));
    expect(screen.getByRole("alert").textContent).toContain(ja.errorStates.d5Message);
    fireEvent.click(screen.getByRole("button", { name: ja.errorStates.d5Retry }));
    expect(regenerate).toHaveBeenCalledTimes(1);
  });
});

describe("ShortRouteNotice (D3)", () => {
  it("keeps the spot cards and proposes adding a nearby work", () => {
    const send = vi.fn();
    renderWithActions(<ShortRouteNotice dict={ja} />, actions({ send }));
    expect(screen.getByText(ja.errorStates.d3Notice)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: ja.errorStates.d3Chip }));
    expect(send).toHaveBeenCalledWith(ja.errorStates.d3Chip);
  });
});

/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatActionsProvider } from "../../../src/features/chat/ChatActions";
import { DataPartCard } from "../../../src/features/chat/components/DataPartCard";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { ClarifyPickProvider } from "../../../src/features/chat/selection/use-clarify-pick";

const dict = chatDictFor("zh");
afterEach(cleanup);

function card(reason?: string, candidates: readonly object[] = [], send = vi.fn(), sendable = true, message?: string) {
  const turn = { enabled: true, sendable, status: "idle" as const, lastPick: undefined, pick: vi.fn(), resend: vi.fn() };
  return <ChatActionsProvider actions={{ send, regenerate: vi.fn() }}><ClarifyPickProvider turn={turn}><DataPartCard data={{ intent: "clarify", message, data: { reason, candidates } }} dict={dict} /></ClarifyPickProvider></ChatActionsProvider>;
}

describe("clarification detail entry", () => {
  it.each([
    ["anime_not_found", dict.clarify.animeNotFoundPrompt, dict.clarify.titleLabel],
    ["unknown_place", dict.clarify.unknownPlacePrompt, dict.clarify.placeLabel],
    ["place_too_broad", dict.clarify.placeTooBroadPrompt, dict.clarify.placeLabel],
    ["photo_unrecognized", dict.clarify.question, dict.clarify.titleLabel],
    ["future_reason", dict.clarify.detailPrompt, dict.clarify.rephraseAction],
  ])("provides the appropriate prompt and input for %s", (reason, prompt, label) => {
    render(card(reason));
    expect(screen.getByText(prompt)).toBeTruthy();
    expect(screen.getByRole("textbox", { name: label })).toBeTruthy();
    expect(document.activeElement).toBe(document.body);
  });

  it("sends trimmed details, prevents empty resubmission, and allows another answer", () => {
    const send = vi.fn();
    render(card("unknown_place", [], send));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "  京都的宇治站  " } });
    fireEvent.submit(input);
    expect(send).toHaveBeenCalledExactlyOnceWith("京都的宇治站");
    expect(screen.getByRole("status").textContent).toBe(dict.clarify.sentDetail);
    fireEvent.submit(input);
    expect(send).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { value: "京阪线" } });
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: dict.clarify.submitDetail }));
    expect(send).toHaveBeenLastCalledWith("京阪线");
  });

});

describe("clarification input navigation", () => {
  it("can return from rephrasing to keyboard-selectable candidates", () => {
    const send = vi.fn();
    render(card("anime_ambiguity", [{ title: "作品A" }], send));
    fireEvent.click(screen.getByRole("button", { name: dict.clarify.escapeHatch }));
    expect(screen.getByRole("textbox", { name: dict.clarify.titleLabel })).toBe(document.activeElement);
    fireEvent.click(screen.getByRole("button", { name: dict.clarify.backToChoices }));
    const choice = screen.getByRole("button", { name: "作品A" });
    expect(choice).toBe(document.activeElement);
    fireEvent.click(choice);
    expect(send).toHaveBeenCalledExactlyOnceWith("作品A");
  });

  it("uses a place field when rephrasing ambiguous places", () => {
    render(card("place_ambiguity", [{ title: "宇治站" }]));
    fireEvent.click(screen.getByRole("button", { name: dict.clarify.escapeHatch }));
    expect(screen.getByRole("textbox", { name: dict.clarify.placeLabel })).toBe(document.activeElement);
  });

  it("preserves a draft while another turn prevents sending", () => {
    const send = vi.fn();
    const view = render(card(undefined, [], send));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "宇治" } });
    view.rerender(card(undefined, [], send, false));
    fireEvent.submit(screen.getByRole("textbox"));
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox").hasAttribute("disabled")).toBe(true);
    view.rerender(card(undefined, [], send, true));
    fireEvent.submit(screen.getByRole("textbox"));
    expect(send).toHaveBeenCalledExactlyOnceWith("宇治");
  });

  it("does not duplicate photo prompts supplied by the response", () => {
    render(card("photo_unrecognized", [], vi.fn(), true, "能告诉我这张照片的作品名吗？"));
    expect(screen.queryByText(dict.clarify.question)).toBeNull();
    expect(screen.getByText("能告诉我这张照片的作品名吗？")).toBeTruthy();
  });
});

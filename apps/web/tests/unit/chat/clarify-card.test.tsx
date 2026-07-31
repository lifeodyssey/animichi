/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatActionsProvider } from "../../../src/features/chat/chat-actions";
import { DataPartCard } from "../../../src/features/chat/components/DataPartCard";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { resetGeoPlatform, setGeoPlatform } from "../../../src/platform/geo";

const dict = chatDictFor("ja");

afterEach(() => {
  cleanup();
  resetGeoPlatform();
});

const FIVE_CANDIDATES = [
  { id: "1", title: "響け!ユーフォニアム" },
  { id: "2", title: "響け!ユーフォニアム2" },
  { id: "3", title: "響け!ユーフォニアム3" },
  { id: "4", title: "リズと青い鳥" },
  { id: "5", title: "劇場版 響け!" },
];

function clarifyElement(data: Record<string, unknown>, send = vi.fn(), cardKey = "clarify") {
  return (
    <ChatActionsProvider key={cardKey} actions={{ send, regenerate: vi.fn() }}>
      <DataPartCard data={{ intent: "clarify", data }} dict={dict} />
    </ChatActionsProvider>
  );
}

function renderClarify(data: Record<string, unknown>, send = vi.fn()) {
  render(clarifyElement(data, send));
  return send;
}

function optionState(name: string): string | null {
  return screen.getByRole("button", { name }).getAttribute("data-state");
}

describe("ClarifyCard (C2, AC1)", () => {
  it("caps the options at four buttons plus the escape hatch", () => {
    renderClarify({ candidates: FIVE_CANDIDATES });
    const list = screen.getByRole("list", { name: "candidates" });
    expect(list.querySelectorAll("button")).toHaveLength(4);
    expect(screen.getByRole("button", { name: dict.clarify.escapeHatch })).toBeTruthy();
  });

  it("marks each initial candidate as available", () => {
    renderClarify({ candidates: FIVE_CANDIDATES.slice(0, 2) });
    expect(optionState("響け!ユーフォニアム")).toBe("available");
    expect(optionState("響け!ユーフォニアム2")).toBe("available");
  });

  it("marks the chosen candidate selected and the rest unselected", () => {
    const send = renderClarify({ candidates: FIVE_CANDIDATES.slice(0, 4) });
    fireEvent.click(screen.getByRole("button", { name: "リズと青い鳥" }));
    expect(send).toHaveBeenCalledWith("リズと青い鳥");
    expect(optionState("リズと青い鳥")).toBe("selected");
    const other = screen.getByRole("button", { name: "響け!ユーフォニアム" });
    expect(optionState("響け!ユーフォニアム")).toBe("unselected");
    expect(other.hasAttribute("disabled")).toBe(true);
  });

  it("dismisses candidates for rephrase and resets a newly keyed card", () => {
    const data = { candidates: FIVE_CANDIDATES.slice(0, 2) };
    const send = vi.fn();
    const view = render(clarifyElement(data, send, "message-1:data-response:0"));
    fireEvent.click(screen.getByRole("button", { name: dict.clarify.escapeHatch }));
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByText(dict.clarify.rephraseHint)).toBeTruthy();
    expect(optionState("響け!ユーフォニアム")).toBe("dismissed");
    view.rerender(clarifyElement(data, send, "message-2:data-response:0"));
    expect(optionState("響け!ユーフォニアム")).toBe("available");
  });
});

describe("ClarifyCard photo degradation (AC5)", () => {
  it("asks which title and offers the manual-entry chip", () => {
    renderClarify({ reason: "photo_unrecognized", candidates: [] });
    expect(screen.getByText(dict.clarify.question)).toBeTruthy();
    expect(screen.getByRole("button", { name: dict.clarify.manualChip })).toBeTruthy();
  });

  it("keeps the plain clarify branch free of photo copy", () => {
    renderClarify({ candidates: FIVE_CANDIDATES.slice(0, 2) });
    expect(screen.queryByText(dict.clarify.question)).toBeNull();
    expect(screen.queryByRole("button", { name: dict.clarify.manualChip })).toBeNull();
  });
});

describe("ClarifyCard missing_location (C4 embed)", () => {
  it("embeds the location prompt and sends granted coordinates upstream", async () => {
    setGeoPlatform({ requestPermission: vi.fn().mockResolvedValue({ status: "granted", lat: 34.9, lng: 135.8 }) });
    const send = vi.fn();
    const sendWithOrigin = vi.fn();
    render(
      <ChatActionsProvider actions={{ send, regenerate: vi.fn(), sendWithOrigin }}>
        <DataPartCard data={{ intent: "clarify", data: { reason: "missing_location", candidates: [] } }} dict={dict} />
      </ChatActionsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: dict.location.allow }));
    await vi.waitFor(() => { expect(sendWithOrigin).toHaveBeenCalledWith(dict.location.granted, 34.9, 135.8); });
    expect(send).not.toHaveBeenCalled();
  });
});

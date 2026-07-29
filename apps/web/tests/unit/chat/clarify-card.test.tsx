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

function renderClarify(data: Record<string, unknown>, send = vi.fn()) {
  render(
    <ChatActionsProvider actions={{ send, regenerate: vi.fn() }}>
      <DataPartCard data={{ intent: "clarify", data }} dict={dict} />
    </ChatActionsProvider>,
  );
  return send;
}

describe("ClarifyCard (C2, AC1)", () => {
  it("caps the options at four buttons plus the escape hatch", () => {
    renderClarify({ candidates: FIVE_CANDIDATES });
    const list = screen.getByRole("list", { name: "candidates" });
    expect(list.querySelectorAll("button")).toHaveLength(4);
    expect(screen.getByRole("button", { name: dict.clarify.escapeHatch })).toBeTruthy();
  });

  it("sends the chosen candidate and fades the rest", () => {
    const send = renderClarify({ candidates: FIVE_CANDIDATES.slice(0, 4) });
    fireEvent.click(screen.getByRole("button", { name: "リズと青い鳥" }));
    expect(send).toHaveBeenCalledWith("リズと青い鳥");
    const chosen = screen.getByRole("button", { name: "リズと青い鳥" });
    expect(chosen.className).not.toContain("--faded");
    const other = screen.getByRole("button", { name: "響け!ユーフォニアム" });
    expect(other.className).toContain("chat-clarify__option--faded");
    expect(other.hasAttribute("disabled")).toBe(true);
  });

  it("escape hatch fades everything and invites a rephrase without sending", () => {
    const send = renderClarify({ candidates: FIVE_CANDIDATES.slice(0, 2) });
    fireEvent.click(screen.getByRole("button", { name: dict.clarify.escapeHatch }));
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByText(dict.clarify.rephraseHint)).toBeTruthy();
    const option = screen.getByRole("button", { name: "響け!ユーフォニアム" });
    expect(option.className).toContain("chat-clarify__option--faded");
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

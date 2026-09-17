/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatHeader } from "../../../src/features/chat/components/ChatHeader";
import { ComposerDock } from "../../../src/features/chat/components/ComposerDock";
import { chatDictFor } from "../../../src/features/chat/i18n";

const ja = chatDictFor("ja");
const GATE = { locked: false, busy: false, failed: false } as const;

beforeEach(() => { sessionStorage.clear(); });
afterEach(cleanup);

describe("ChatHeader", () => {
  it("renders the crumb, the journey title, and the autosaved pill", () => {
    render(<ChatHeader dict={ja} />);
    expect(screen.getByText(ja.crumbJourneys)).toBeTruthy();
    expect(screen.getByText(ja.titleNewJourney)).toBeTruthy();
    expect(screen.getByText(ja.autosaved)).toBeTruthy();
  });

  it("follows the topic once a title is given", () => {
    render(<ChatHeader dict={ja} title="宇治に行きたい" />);
    expect(screen.getByText("宇治に行きたい")).toBeTruthy();
    expect(screen.queryByText(ja.titleNewJourney)).toBeNull();
  });
});

function renderComposer(onSend = vi.fn()) {
  return render(<ComposerDock dict={ja} gate={GATE} quotaLocked={false} onSend={onSend} />);
}

describe("ComposerDock", () => {
  it("renders a text-only composer: no photo affordance, no file picker (#1604)", () => {
    renderComposer();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: ja.send })).toBeTruthy();
  });

  it("keeps the gold send disc labelled with the send key", () => {
    renderComposer();
    const send = screen.getByRole("button", { name: ja.send });
    expect(send.className).toContain("bg-gold");
    expect(send.hasAttribute("disabled")).toBe(true);
  });

  it("writes the hint line under the pill", () => {
    renderComposer();
    expect(screen.getByText(ja.hintSend)).toBeTruthy();
  });

  it("sends typed text through the dock's onSend", () => {
    const onSend = vi.fn();
    renderComposer(onSend);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "宇治にいきたい" } });
    fireEvent.click(screen.getByRole("button", { name: ja.send }));
    expect(onSend).toHaveBeenCalledWith("宇治にいきたい");
  });
});

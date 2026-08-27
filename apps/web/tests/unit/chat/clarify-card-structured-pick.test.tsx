/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatActionsProvider } from "../../../src/features/chat/ChatActions";
import { candidateDisplayTitle } from "../../../src/features/chat/components/ClarifyCard";
import { DataPartCard } from "../../../src/features/chat/components/DataPartCard";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { ClarifyPickProvider } from "../../../src/features/chat/selection/use-clarify-pick";
import type { ClarifyPickTurn } from "../../../src/features/chat/selection/use-clarify-pick";

const dict = chatDictFor("ja");

afterEach(cleanup);

const HARUHI = { id: "115908", title: "涼宮ハルヒの憂鬱", title_cn: "凉宫春日的忧郁" };
const HARUHI_LABEL = "凉宫春日的忧郁(涼宮ハルヒの憂鬱)";
const YUKI = { id: "117696", title: "長門有希ちゃんの消失" };

function makeClarifyPickTurn(overrides: Partial<ClarifyPickTurn> = {}): ClarifyPickTurn {
  return { enabled: true, sendable: true, status: "idle", lastPick: undefined, pick: vi.fn(), resend: vi.fn(), ...overrides };
}

type ClarifyData = Record<string, unknown>;

function clarifyElement(data: ClarifyData, turn: ClarifyPickTurn, send = vi.fn()) {
  return (
    <ClarifyPickProvider turn={turn}>
      <ChatActionsProvider actions={{ send, regenerate: vi.fn() }}>
        <DataPartCard data={{ intent: "clarify", data }} dict={dict} />
      </ChatActionsProvider>
    </ClarifyPickProvider>
  );
}

const PENDING = { clarification_id: 4, candidates: [HARUHI, YUKI] };

function optionState(name: string): string | null {
  return screen.getByRole("button", { name }).getAttribute("data-state");
}

describe("ClarifyCard bilingual titles (W1 #1220)", () => {
  it("renders 中文(原文) when the candidate carries a Chinese title", () => {
    render(clarifyElement(PENDING, makeClarifyPickTurn()));
    expect(screen.getByRole("button", { name: HARUHI_LABEL })).toBeTruthy();
  });

  it("renders the original title alone when no Chinese title exists", () => {
    render(clarifyElement(PENDING, makeClarifyPickTurn()));
    expect(screen.getByRole("button", { name: "長門有希ちゃんの消失" })).toBeTruthy();
  });
});

describe("candidateDisplayTitle composition rules", () => {
  it.each([
    [{ title: "涼宮ハルヒの憂鬱", title_cn: "凉宫春日的忧郁" }, HARUHI_LABEL],
    [{ title: "長門有希ちゃんの消失" }, "長門有希ちゃんの消失"],
    [{ title: "同名", title_cn: "同名" }, "同名"],
    [{ title_cn: "只有中文" }, "只有中文"],
    [{ id: "115908" }, "115908"],
    [{ title: "原題", title_cn: "" }, "原題"],
  ])("composes %o as %s", (candidate, expected) => {
    expect(candidateDisplayTitle(candidate)).toBe(expected);
  });
});

describe("ClarifyCard structured pick (W1 #1220)", () => {
  it("sends the candidate id and the pending clarification revision, never free text", () => {
    const turn = makeClarifyPickTurn();
    const send = vi.fn();
    render(clarifyElement(PENDING, turn, send));
    fireEvent.click(screen.getByRole("button", { name: HARUHI_LABEL }));
    expect(turn.pick).toHaveBeenCalledExactlyOnceWith({
      candidateId: "115908",
      label: HARUHI_LABEL,
      clarificationId: 4,
    });
    expect(send).not.toHaveBeenCalled();
    expect(optionState(HARUHI_LABEL)).toBe("selected");
  });

  it("falls back to a free-text send when the candidate carries no id", () => {
    const turn = makeClarifyPickTurn();
    const send = vi.fn();
    render(clarifyElement({ clarification_id: 4, candidates: [{ title: "リズと青い鳥" }] }, turn, send));
    fireEvent.click(screen.getByRole("button", { name: "リズと青い鳥" }));
    expect(send).toHaveBeenCalledExactlyOnceWith("リズと青い鳥");
    expect(turn.pick).not.toHaveBeenCalled();
  });

  it("keeps the escape hatch on the free-text path", () => {
    const turn = makeClarifyPickTurn();
    const send = vi.fn();
    render(clarifyElement(PENDING, turn, send));
    fireEvent.click(screen.getByRole("button", { name: dict.clarify.escapeHatch }));
    expect(turn.pick).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByText(dict.clarify.rephraseHint)).toBeTruthy();
  });

  it("refuses to pick while a turn is in flight (shared status gate)", () => {
    const turn = makeClarifyPickTurn({ sendable: false });
    const send = vi.fn();
    render(clarifyElement(PENDING, turn, send));
    fireEvent.click(screen.getByRole("button", { name: HARUHI_LABEL }));
    expect(turn.pick).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(optionState(HARUHI_LABEL)).toBe("available");
  });
});

describe("ClarifyCard re-arm on pick failure (W1 #1220)", () => {
  it("returns the options to available when the sent pick fails", () => {
    const send = vi.fn();
    const view = render(clarifyElement(PENDING, makeClarifyPickTurn(), send));
    fireEvent.click(screen.getByRole("button", { name: HARUHI_LABEL }));
    expect(optionState(HARUHI_LABEL)).toBe("selected");
    const failed = makeClarifyPickTurn({
      status: "failed",
      lastPick: { candidateId: "115908", label: HARUHI_LABEL, clarificationId: 4 },
    });
    view.rerender(clarifyElement(PENDING, failed, send));
    expect(optionState(HARUHI_LABEL)).toBe("available");
    expect(optionState("長門有希ちゃんの消失")).toBe("available");
  });

  it("leaves a chosen card alone when an unrelated pick fails", () => {
    const send = vi.fn();
    const view = render(clarifyElement(PENDING, makeClarifyPickTurn(), send));
    fireEvent.click(screen.getByRole("button", { name: HARUHI_LABEL }));
    const unrelated = makeClarifyPickTurn({
      status: "failed",
      lastPick: { candidateId: "999999", label: "別の作品", clarificationId: 9 },
    });
    view.rerender(clarifyElement(PENDING, unrelated, send));
    expect(optionState(HARUHI_LABEL)).toBe("selected");
  });
});

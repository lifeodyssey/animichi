/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatActionsProvider } from "../../../src/features/chat/ChatActions";
import { DataPartCard } from "../../../src/features/chat/components/DataPartCard";
import { chatDictFor } from "../../../src/features/chat/i18n";

const dict = chatDictFor("ja");
const WORK = { id: "115908", title: "響け！ユーフォニアム", title_cn: "吹响吧！上低音号", cover_url: "/cover.jpg" };
const LABEL = "響け！ユーフォニアム(吹响吧！上低音号)";

afterEach(cleanup);

function card(data: Record<string, unknown>, send = vi.fn(), message?: string) {
  return <ChatActionsProvider actions={{ send, regenerate: vi.fn() }}><DataPartCard data={{ intent: "clarify", data, message }} dict={dict} /></ChatActionsProvider>;
}

describe("clarification presentation", () => {
  it("separates bilingual titles while preserving the sent label", () => {
    const send = vi.fn();
    render(card({ candidates: [WORK] }, send));
    const option = screen.getByRole("button", { name: LABEL });
    expect(screen.getByText(WORK.title).tagName).toBe("SPAN");
    expect(screen.getByText(WORK.title_cn).tagName).toBe("SPAN");
    expect(option.querySelector("img")?.getAttribute("alt")).toBe("");
    fireEvent.click(option);
    expect(send).toHaveBeenCalledExactlyOnceWith(LABEL);
    expect(option.getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps a failed cover selectable and retries when its URL changes", () => {
    const send = vi.fn();
    const view = render(card({ candidates: [WORK] }, send));
    fireEvent.error(screen.getByRole("presentation"));
    expect(document.querySelector("img")).toBeNull();
    view.rerender(card({ candidates: [{ ...WORK, cover_url: "/new-cover.jpg" }] }, send));
    expect(document.querySelector("img")?.getAttribute("src")).toBe("/new-cover.jpg");
    fireEvent.click(screen.getByRole("button", { name: LABEL }));
    expect(send).toHaveBeenCalledExactlyOnceWith(LABEL);
  });

  it("renders place candidates without artwork or anime-specific prompts", () => {
    const send = vi.fn();
    render(card({ reason: "place_ambiguity", candidates: [{ id: "jr", title: "宇治駅（JR）", lat: 34.89, lng: 135.8 }] }, send));
    expect(screen.getByText(dict.clarify.choosePrompt)).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "宇治駅（JR）" }));
    expect(send).toHaveBeenCalledExactlyOnceWith("宇治駅（JR）");
  });

  it("keeps generic title-only choices usable", () => {
    const send = vi.fn();
    render(card({ candidates: [{ title: "ゆっくり歩きたい", cover_url: null }] }, send));
    fireEvent.click(screen.getByRole("button", { name: "ゆっくり歩きたい" }));
    expect(send).toHaveBeenCalledExactlyOnceWith("ゆっくり歩きたい");
  });
});

describe("clarification without matching candidates", () => {
  it("asks for detail when no candidates exist and offers an honest action", () => {
    render(card({ candidates: [] }));
    expect(screen.getByText(dict.clarify.detailPrompt)).toBeTruthy();
    expect(screen.queryByRole("button", { name: dict.clarify.escapeHatch })).toBeNull();
    expect(screen.getByRole("textbox", { name: dict.clarify.rephraseAction })).toBeTruthy();
    expect(screen.getByText(dict.clarify.rephraseHint)).toBeTruthy();
  });

  it.each(["anime_not_found", "unknown_place", "place_too_broad"])("preserves the %s explanation without adding a duplicate prompt", (reason) => {
    render(card({ reason, candidates: [] }, vi.fn(), "もう少し詳しく聞かせてね"));
    expect(screen.getByText("もう少し詳しく聞かせてね")).toBeTruthy();
    expect(screen.queryByText(dict.clarify.detailPrompt)).toBeNull();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("asks for location when it is missing", () => {
    render(card({ reason: "missing_location", candidates: [] }));
    expect(screen.getByText(dict.clarify.locationPrompt)).toBeTruthy();
    expect(screen.getByRole("button", { name: dict.location.allow })).toBeTruthy();
  });

  it("offers one manual entry action after an unrecognized photo", () => {
    render(card({ reason: "photo_unrecognized", candidates: [WORK] }));
    expect(screen.getByText(dict.clarify.question)).toBeTruthy();
    expect(screen.queryByRole("button", { name: dict.clarify.escapeHatch })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: dict.clarify.manualChip }));
    expect(screen.queryByRole("button", { name: LABEL })).toBeNull();
    expect(screen.getByRole("textbox", { name: dict.clarify.titleLabel })).toBe(document.activeElement);
  });
});

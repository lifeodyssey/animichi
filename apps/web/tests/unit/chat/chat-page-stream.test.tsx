/**
 * @vitest-environment jsdom
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { setLanguages } from "../_i18n";
import { server } from "../../msw/node";
import { chatStreamHandler } from "../../msw/chat-handlers";
import { chatSearch, renderChatPage } from "./_chat-page";

const ja = chatDictFor("ja");

beforeEach(() => {
  setLanguages(["ja"]);
});

function sendText(text: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: ja.send }));
}

describe("send flow over the recorded search stream", () => {
  it("renders the user bubble, tool step badges and the final route card", async () => {
    server.use(chatStreamHandler("search"));
    renderChatPage();
    sendText("ユーフォ");
    expect(await screen.findByText("ユーフォ")).toBeTruthy();
    await screen.findByText("宇治の聖地を2件、徒歩ルートにまとめました。");
    for (const tool of ["resolve_anime", "search_bangumi", "plan_route"]) {
      expect(screen.getByText(tool).getAttribute("data-status")).toBe("done");
    }
    expect(screen.getByText("宇治橋")).toBeTruthy();
    const card = document.querySelector('[data-intent="plan_route"]');
    expect(card?.classList.contains("chat-card--skeleton")).toBe(false);
  });

  it("reconciles the intent-first frame into a single card (same-ID overwrite)", async () => {
    server.use(chatStreamHandler("search"));
    renderChatPage();
    sendText("ユーフォ");
    await screen.findByText("宇治の聖地を2件、徒歩ルートにまとめました。");
    expect(document.querySelectorAll('[data-intent="plan_route"]')).toHaveLength(1);
  });
});

describe("B4 settled footprint", () => {
  it("collapses the completed pipeline into an expandable footprint row", async () => {
    server.use(chatStreamHandler("search"));
    renderChatPage();
    sendText("ユーフォ");
    await screen.findByText("宇治の聖地を2件、徒歩ルートにまとめました。");
    await waitFor(() => {
      expect(document.querySelector(".chat-settled")).toBeTruthy();
    });
    expect(screen.getAllByText(ja.footprintDetails, { exact: false }).length).toBeGreaterThan(0);
  });
});

describe("A1 example chips", () => {
  it("sends the chip text as a user message on click", async () => {
    server.use(chatStreamHandler("clarify"));
    renderChatPage();
    const chip = await screen.findByRole("button", { name: ja.chips[0] });
    fireEvent.click(chip);
    await screen.findByText("どの作品でしょうか？");
    expect(screen.getAllByText(ja.chips[0]).length).toBeGreaterThan(0);
  });
});

describe("A2 query entry", () => {
  it("auto-sends ?q= as an optimistic user bubble without retyping", async () => {
    server.use(chatStreamHandler("clarify"));
    renderChatPage(chatSearch({ q: "ハルヒ" }));
    expect(await screen.findByText("ハルヒ")).toBeTruthy();
    await screen.findByText("どの作品でしょうか？");
    expect(screen.getByText("115908")).toBeTruthy();
  });
});

describe("malformed data-part frames", () => {
  it("rejects a malformed same-ID final frame instead of overwriting the valid intent frame", async () => {
    server.use(chatStreamHandler("search", { malformedFinal: true }));
    renderChatPage();
    sendText("ユーフォ");
    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeTruthy();
    });
    const card = document.querySelector('[data-intent="plan_route"]');
    expect(card?.classList.contains("chat-card--skeleton")).toBe(true);
    expect(document.querySelector(".chat-card--fallback")).toBeNull();
  });
});

describe("stream error", () => {
  it("surfaces the recorded error stream as the banner state", async () => {
    server.use(chatStreamHandler("error"));
    renderChatPage();
    sendText("こんにちは");
    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeTruthy();
    });
  });

  it("retries the failed turn via regenerate instead of leaving a partial message", async () => {
    server.use(chatStreamHandler("error"));
    renderChatPage();
    sendText("ユーフォ");
    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeTruthy();
    });
    server.use(chatStreamHandler("search"));
    fireEvent.click(screen.getByRole("button", { name: ja.retry }));
    await screen.findByText("宇治の聖地を2件、徒歩ルートにまとめました。");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByText("ユーフォ")).toHaveLength(1);
  });
});

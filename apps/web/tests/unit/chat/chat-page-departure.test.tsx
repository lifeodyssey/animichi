/**
 * @vitest-environment jsdom
 */
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { setLanguages } from "../_i18n";
import { server } from "../../msw/node";
import { chatStreamHandler } from "../../msw/chat-handlers";
import { renderChatPage } from "./_chat-page";

const ja = chatDictFor("ja");

beforeEach(() => {
  setLanguages(["ja"]);
});

function sendText(text: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: ja.send }));
}

describe("C2t departure gate through ChatShell (AC2)", () => {
  it("holds a departure-less route request and renders the chips", () => {
    renderChatPage();
    sendText("君の名は。のルートを組んで");
    expect(screen.getByRole("button", { name: ja.departure.stationChip })).toBeTruthy();
    expect(screen.getByRole("button", { name: ja.departure.hereChip })).toBeTruthy();
    expect(screen.getByRole("button", { name: ja.departure.manualChip })).toBeTruthy();
    expect(screen.getByRole("button", { name: ja.departure.autoChip })).toBeTruthy();
  });

  it("おまかせ resolves the held turn and sends the original request", async () => {
    server.use(chatStreamHandler("search"));
    renderChatPage();
    sendText("君の名は。のルートを組んで");
    fireEvent.click(screen.getByRole("button", { name: ja.departure.autoChip }));
    expect(await screen.findByText("君の名は。のルートを組んで")).toBeTruthy();
    expect(screen.queryByRole("button", { name: ja.departure.autoChip })).toBeNull();
  });
});

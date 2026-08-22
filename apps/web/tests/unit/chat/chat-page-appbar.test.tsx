/**
 * @vitest-environment jsdom
 */
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { healthzDownHandler } from "../../msw/chat-handlers";
import { server } from "../../msw/node";
import { setLanguages } from "../_i18n";
import { chatSearch, renderChatPage } from "./_chat-page";

const ja = chatDictFor("ja");

beforeEach(() => {
  setLanguages(["ja"]);
});

/** The header element the brand lockup lives in, as the page renders it. */
function renderedAppBar(): HTMLElement | null {
  return screen.getByText(ja.appbar.brand).closest("header");
}

describe("the chat page's own chrome", () => {
  it("mounts the appbar on the page, not only in isolation", () => {
    renderChatPage();
    expect(renderedAppBar()).not.toBeNull();
    expect(screen.getByRole("link", { name: ja.appbar.newConversation }).getAttribute("href")).toBe("/chat");
  });

  it("keeps the appbar above the A5 banner and outside it, so an outage never moves the brand nor reads as chrome", async () => {
    server.use(healthzDownHandler);
    renderChatPage(chatSearch(), false);
    const banner = await screen.findByRole("alert");
    expect(renderedAppBar()?.compareDocumentPosition(banner)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

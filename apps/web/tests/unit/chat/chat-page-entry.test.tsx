/**
 * @vitest-environment jsdom
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { setLanguages } from "../_i18n";
import { server } from "../../msw/node";
import { healthzDownHandler, healthzOkHandler } from "../../msw/chat-handlers";
import { chatSearch, renderChatPage } from "./_chat-page";

const ja = chatDictFor("ja");

describe("A1 cold start", () => {
  it("renders the fox greeting, 3 example chips and an auto-focused input", async () => {
    setLanguages(["ja"]);
    renderChatPage();
    expect(await screen.findByText(ja.greeting)).toBeTruthy();
    for (const chip of ja.chips) expect(screen.getByRole("button", { name: chip })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("textbox"));
  });

  it.each(["zh", "en"] as const)("greets in %s per locale", async (locale) => {
    setLanguages([locale]);
    renderChatPage();
    expect(await screen.findByText(chatDictFor(locale).greeting)).toBeTruthy();
  });
});

describe("A2b route reference degrade", () => {
  it("falls back to the A1 cold start when the referenced route is gone", async () => {
    setLanguages(["ja"]);
    renderChatPage(chatSearch({ route: "r-deleted" }));
    expect(await screen.findByText(ja.greeting)).toBeTruthy();
    expect(screen.queryByText(/引用中/)).toBeNull();
  });
});

describe("A5 backend unreachable", () => {
  it("shows the error banner, disables input, and retry restores A1", async () => {
    setLanguages(["ja"]);
    server.use(healthzDownHandler);
    renderChatPage(chatSearch(), false);
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain(ja.errorBanner);
    expect(screen.getByRole("textbox").hasAttribute("disabled")).toBe(true);
    server.use(healthzOkHandler);
    fireEvent.click(screen.getByRole("button", { name: ja.retry }));
    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });
    expect(screen.getByRole("textbox").hasAttribute("disabled")).toBe(false);
  });
});

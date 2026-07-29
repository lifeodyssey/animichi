/**
 * @vitest-environment jsdom
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { setLanguages } from "../_i18n";
import { chatSearch, renderChatPage } from "./_chat-page";

const ja = chatDictFor("ja");

function settingsToggle(): HTMLElement {
  return screen.getByRole("button", { name: ja.byok.settingsToggle });
}

describe("BYOK settings entry point (T6, chat input area)", () => {
  it("renders a settings toggle in the composer, panel closed by default", () => {
    setLanguages(["ja"]);
    renderChatPage();
    expect(settingsToggle().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("heading", { name: ja.byok.title })).toBeNull();
  });

  it("opens and closes the panel from the toggle", async () => {
    setLanguages(["ja"]);
    renderChatPage();
    fireEvent.click(settingsToggle());
    expect(await screen.findByRole("heading", { name: ja.byok.title })).toBeTruthy();
    expect(settingsToggle().getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(settingsToggle());
    expect(screen.queryByRole("heading", { name: ja.byok.title })).toBeNull();
  });

  it("shows the anonymous teaser inside the panel for a signed-out visitor", async () => {
    setLanguages(["ja"]);
    renderChatPage();
    fireEvent.click(settingsToggle());
    expect(await screen.findByText(ja.byok.anonymousTeaser)).toBeTruthy();
  });
});

describe("BYOK deep-link return (T8-AC4: /chat?settings=byok)", () => {
  it("arrives with the panel already open — the intent survived the URL", async () => {
    setLanguages(["ja"]);
    renderChatPage(chatSearch({ settings: "byok" }));
    expect(await screen.findByRole("heading", { name: ja.byok.title })).toBeTruthy();
    expect(settingsToggle().getAttribute("aria-expanded")).toBe("true");
    expect(settingsToggle().getAttribute("aria-controls")).toBe("byok-settings-panel");
    expect(document.activeElement?.id).toBe("byok-settings-panel");
  });

  it("keeps the panel closed for a plain /chat arrival", async () => {
    setLanguages(["ja"]);
    renderChatPage();
    await waitFor(() => { expect(settingsToggle()).toBeTruthy(); });
    expect(screen.queryByRole("heading", { name: ja.byok.title })).toBeNull();
  });
});

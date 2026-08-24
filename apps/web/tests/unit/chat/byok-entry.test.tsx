/**
 * @vitest-environment jsdom
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { setLanguages } from "../_i18n";
import { chatSearch, renderChatPage, urlSettings } from "./_chat-page";

const ja = chatDictFor("ja");

function settingsToggle(): HTMLElement {
  return screen.getByRole("button", { name: ja.byok.settingsToggle });
}

describe("BYOK settings entry point (T6, chat app bar)", () => {
  it("renders the settings trigger in the header, never in the composer form", async () => {
    setLanguages(["ja"]);
    renderChatPage();
    const toggle = settingsToggle();
    expect(toggle.closest("header")).not.toBeNull();
    expect(toggle.closest("form")).toBeNull();
    expect(toggle.getAttribute("type")).toBe("button");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector("[data-animal-drawer-portal]")).toBeNull();
    const login = await screen.findByRole("button", { name: ja.appbar.login });
    expect(toggle.compareDocumentPosition(login) & Node.DOCUMENT_POSITION_FOLLOWING).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: ja.byok.title })).toBeNull();
  });

  it("opens from the header, then Escape clears the URL and restores trigger focus", async () => {
    setLanguages(["ja"]);
    const user = userEvent.setup();
    const router = renderChatPage();
    const toggle = settingsToggle();
    await user.click(toggle);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(urlSettings(router)).toBe("byok");
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(urlSettings(router)).toBeUndefined();
    expect(document.activeElement).toBe(toggle);
  });

  it("shows the anonymous teaser inside the panel for a signed-out visitor", async () => {
    setLanguages(["ja"]);
    renderChatPage(chatSearch({ settings: "byok" }));
    expect(await screen.findByText(ja.byok.anonymousTeaser)).toBeTruthy();
  });
});

describe("BYOK deep-link return (T8-AC4: /chat?settings=byok)", () => {
  it("arrives with the panel already open — the intent survived the URL", async () => {
    setLanguages(["ja"]);
    renderChatPage(chatSearch({ settings: "byok" }));
    const dialog = await screen.findByRole("dialog");
    expect(settingsToggle().getAttribute("aria-expanded")).toBe("true");
    expect(settingsToggle().getAttribute("aria-controls")).toBe("byok-settings-panel");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("keeps the panel closed for a plain /chat arrival", async () => {
    setLanguages(["ja"]);
    renderChatPage();
    await waitFor(() => { expect(settingsToggle()).toBeTruthy(); });
    expect(screen.queryByRole("heading", { name: ja.byok.title })).toBeNull();
  });
});

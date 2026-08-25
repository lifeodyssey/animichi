/**
 * @vitest-environment jsdom
 */
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { parseChatSearch } from "../../../src/features/chat/search";
import { setLanguages } from "../_i18n";
import { renderChatPage } from "./_chat-page";

const ja = chatDictFor("ja");

function renderSettingsLink(): HTMLAnchorElement {
  setLanguages(["ja"]);
  renderChatPage();
  return screen.getByRole<HTMLAnchorElement>("link", { name: ja.appbar.settings });
}

describe("settings entry point", () => {
  it("is ordinary navigation to the dedicated page", () => {
    const link = renderSettingsLink();
    expect(link.getAttribute("href")).toBe("/settings");
    expect(link.getAttribute("aria-expanded")).toBeNull();
    expect(link.closest("form")).toBeNull();
  });

  it("occupies the true rightmost app-bar slot", async () => {
    const link = renderSettingsLink();
    await waitFor(() => { expect(screen.getByRole("button", { name: ja.appbar.login })).toBeTruthy(); });
    expect(link.parentElement?.lastElementChild).toBe(link);
  });

  it("does not mount legacy drawer or BYOK content inside chat", () => {
    renderSettingsLink();
    expect(document.querySelector("[data-animal-drawer-portal]")).toBeNull();
    expect(screen.queryByText(ja.byok.anonymousTeaser)).toBeNull();
  });
});

describe("legacy chat settings search is gone", () => {
  it("drops the old settings parameter instead of keeping compatibility state", () => {
    expect(parseChatSearch({ settings: "byok", session: "s1" })).toEqual({ q: undefined, route: undefined, session: "s1" });
  });
});

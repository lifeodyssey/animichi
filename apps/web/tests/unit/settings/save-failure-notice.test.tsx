/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsPage } from "../../../src/components/settings/SettingsPage";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { dictFor } from "../../../src/i18n/dictionaries";
import { LocaleProvider } from "../../../src/i18n/LocaleProvider";
import { armSaveFailureNotice } from "../../../src/lib/auth/save-failure-notice";
import { setLanguages } from "../_i18n";
import { AppRouterContext } from "../_router";

beforeEach(() => { setLanguages(["ja-JP"]); });
afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

function renderPage() {
  render(
    <AppRouterContext>
      <LocaleProvider>
        <SettingsPage auth="anonymous" baseUrl="http://agent.test" chat={chatDictFor("ja")} />
      </LocaleProvider>
    </AppRouterContext>,
  );
}

describe("the failed-save notice on the settings destination (#482)", () => {
  it.each([["ja-JP", "ja"], ["en-US", "en"], ["zh-CN", "zh"]] as const)(
    "shows the existing route-didn't-save copy in %s",
    async (navigatorLocale, dictLocale) => {
      setLanguages([navigatorLocale]);
      armSaveFailureNotice();
      renderPage();
      const notice = await screen.findByRole("status");
      expect(notice.textContent).toContain(dictFor(dictLocale).auth.callback_save_failed);
    },
  );

  it("stays away when nothing armed it", () => {
    renderPage();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not return on a second mount — a reload finds the key consumed", async () => {
    armSaveFailureNotice();
    renderPage();
    await screen.findByRole("status");
    cleanup();
    renderPage();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

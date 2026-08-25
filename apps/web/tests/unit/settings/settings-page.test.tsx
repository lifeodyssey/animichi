/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsPage } from "../../../src/components/settings/SettingsPage";
import { Route as SettingsRoute } from "../../../src/routes/settings";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { dictFor } from "../../../src/i18n/dictionaries";
import { LocaleProvider } from "../../../src/i18n/LocaleProvider";
import { BYOK_SETUP_TARGET } from "../../../src/lib/byok/byok-target";
import settingsCss from "../../../src/styles/settings.css?raw";
import { setLanguages } from "../_i18n";

const ja = dictFor("ja");

beforeEach(() => { setLanguages(["ja-JP"]); });
afterEach(cleanup);

function renderPage(auth: "anonymous" | "authenticated" | "pending" = "anonymous") {
  render(
    <LocaleProvider>
      <SettingsPage auth={auth} baseUrl="http://agent.test" chat={chatDictFor("ja")} />
    </LocaleProvider>,
  );
}

describe("dedicated settings page", () => {
  it("has one page heading and stable section links", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: ja.settings.title })).toBeTruthy();
    expect(screen.getByRole("link", { name: ja.settings.preferencesTitle }).getAttribute("href")).toBe("#preferences");
    expect(screen.getByRole("link", { name: ja.settings.apiKeyTitle }).getAttribute("href")).toBe("#api-key");
    expect(BYOK_SETUP_TARGET).toBe("/settings#api-key");
  });

  it("puts preferences before API-key setup without a dialog or drawer", () => {
    renderPage();
    const preferences = document.querySelector("#preferences");
    const apiKey = document.querySelector("#api-key");
    const order = preferences?.compareDocumentPosition(apiKey ?? document.body) ?? 0;
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("[data-animal-drawer-portal]")).toBeNull();
  });

  it("uses package controls for preferences and anonymous BYOK", () => {
    renderPage();
    expect(screen.getByRole("switch", { name: ja.settings.nightMode }).className).toContain("animal-switch");
    expect(screen.getByRole("combobox", { name: ja.settings.language }).className).toContain("animal-select-trigger");
    expect(screen.getByRole("button", { name: chatDictFor("ja").byok.signInToSetUp }).className).toContain("animal-btn");
  });

  it("uses a desktop section rail and collapses to one column on mobile", () => {
    expect(settingsCss).toContain("grid-template-columns: 12rem minmax(0, 1fr)");
    const mobile = settingsCss.slice(settingsCss.indexOf("@media (max-width: 720px)"));
    expect(mobile).toContain("grid-template-columns: 1fr");
    expect(mobile).toContain("flex-direction: row");
  });
});

describe("/settings route", () => {
  it("negotiates locale and renders the page directly", () => {
    setLanguages(["en-US"]);
    const renderRoute = SettingsRoute.options.component as () => ReactNode;
    render(<>{renderRoute()}</>);
    expect(screen.getByRole("heading", { name: dictFor("en").settings.title })).toBeTruthy();
  });
});

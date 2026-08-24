/**
 * @vitest-environment jsdom
 *
 * The settings drawer is the one place the app-level preferences live (owner
 * 2026-08-23). What must hold: the panel hosts them ABOVE the API-key section,
 * the panel's accessible name grows to cover both, and — the reason the panel
 * keeps the app bar feature-independent — chat never imports the preference UI,
 * so the route injects those controls as a node.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppPreferences } from "../../../src/components/settings/AppPreferences";
import { ByokSettings } from "../../../src/features/chat/components/ByokSettings";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { dictFor } from "../../../src/i18n/dictionaries";
import { LocaleProvider } from "../../../src/i18n/LocaleProvider";
import { setLanguages } from "../_i18n";

const ja = dictFor("ja");

beforeEach(() => {
  window.localStorage.clear();
  setLanguages(["ja-JP"]);
});
afterEach(cleanup);

function renderPanel() {
  render(
    <LocaleProvider>
      <ByokSettings
        dict={chatDictFor("ja")} auth="anonymous" baseUrl="http://agent.test"
        preferences={{ label: ja.settings.title, content: <AppPreferences /> }}
      />
    </LocaleProvider>,
  );
}

describe("the settings drawer hosts the app preferences", () => {
  it("keeps the deep-link id for the drawer trigger", () => {
    renderPanel();
    expect(screen.getByRole("region").id).toBe("byok-settings-panel");
  });

  it("names itself for everything it now holds, not for the API key alone", () => {
    renderPanel();
    expect(screen.getByRole("region", { name: ja.settings.title })).toBeTruthy();
  });

  it("carries the day/night switch", () => {
    renderPanel();
    expect(screen.getByRole("switch", { name: ja.settings.nightMode })).toBeTruthy();
  });

  it("carries the language switcher", () => {
    renderPanel();
    expect(screen.getByRole("combobox")).toBeTruthy();
  });

  it("puts the preferences ahead of the API-key section", () => {
    renderPanel();
    const heading = screen.getByRole("heading", { name: chatDictFor("ja").byok.title });
    const order = heading.compareDocumentPosition(screen.getByRole("switch"));
    expect(order & Node.DOCUMENT_POSITION_PRECEDING).toBeGreaterThan(0);
  });

  it("still names itself for the API key when no preferences are injected", () => {
    render(
      <LocaleProvider>
        <ByokSettings dict={chatDictFor("ja")} auth="anonymous" baseUrl="http://agent.test" />
      </LocaleProvider>,
    );
    expect(screen.getByRole("region", { name: chatDictFor("ja").byok.title })).toBeTruthy();
  });
});

describe("the chat feature does not own the preference UI", () => {
  const CHAT_SOURCES = [
    "src/features/chat/components/ByokSettings.tsx",
    "src/features/chat/components/ChatShell.tsx",
    "src/features/chat/ChatPage.tsx",
  ] as const;

  it.each(CHAT_SOURCES)("%s imports no components/ module", (file) => {
    const source = readFileSync(resolve(process.cwd(), file), "utf8");
    expect(source).not.toMatch(/from "[^"]*components\/(?:ds|settings)\//u);
  });
});

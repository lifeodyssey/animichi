/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatAppBar } from "../../../src/features/chat/components/ChatAppBar";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { LOCALES } from "../../../src/i18n/locales";
import { LocaleProvider } from "../../../src/i18n/LocaleProvider";
import type { AuthStatus } from "../../../src/lib/auth/session";

const ja = chatDictFor("ja");

afterEach(cleanup);

function renderAppBar(status: AuthStatus) {
  render(
    <LocaleProvider>
      <ChatAppBar dict={ja} status={status} />
    </LocaleProvider>,
  );
}

describe("chat appbar brand mark", () => {
  it("renders the torii and the fox as decorative marks", () => {
    renderAppBar("authenticated");
    const marks = screen.getAllByAltText("");
    expect(marks).toHaveLength(2);
    const torii = marks.find((image) => image.getAttribute("src") === "/images/landing/torii.svg");
    const fox = marks.find((image) => image.getAttribute("src") === "/images/landing/fox/fox-curious.svg");
    expect(torii?.getAttribute("width")).toBe("40");
    expect(torii?.getAttribute("height")).toBe("40");
    expect(fox?.getAttribute("width")).toBe("24");
    expect(fox?.getAttribute("height")).toBe("24");
  });

  it.each(LOCALES)("shows the %s wordmark over the latin lockup", (locale) => {
    const dict = chatDictFor(locale);
    render(
      <LocaleProvider>
        <ChatAppBar dict={dict} status="anonymous" />
      </LocaleProvider>,
    );
    expect(screen.getByText(dict.appbar.brand)).toBeTruthy();
    expect(screen.getByText(dict.appbar.tagline)).toBeTruthy();
  });

  it("keeps the English mark the latin Animichi, never a romanized 圣地巡礼", () => {
    expect(chatDictFor("en").appbar.brand).toBe("Animichi");
  });
});

describe("chat appbar new conversation", () => {
  it("makes the new-conversation control a link to /chat with the localized name", () => {
    renderAppBar("anonymous");
    const link = screen.getByRole("link", { name: ja.appbar.newConversation });
    expect(link.getAttribute("href")).toBe("/chat");
  });
});

describe("chat appbar identity slot", () => {
  it("shows the labelled identity disc for a signed-in visitor and no login entry", () => {
    renderAppBar("authenticated");
    expect(screen.getByRole("img", { name: ja.appbar.signedIn })).toBeTruthy();
    expect(screen.queryByRole("button", { name: ja.appbar.login })).toBeNull();
  });

  it("shows the login entry and never a stand-in avatar for an anonymous visitor", () => {
    renderAppBar("anonymous");
    expect(screen.getByRole("button", { name: ja.appbar.login })).toBeTruthy();
    expect(screen.queryByRole("img", { name: ja.appbar.signedIn })).toBeNull();
  });

  it("renders neither identity affordance while auth is pending", () => {
    renderAppBar("pending");
    expect(screen.queryByRole("button", { name: ja.appbar.login })).toBeNull();
    expect(screen.queryByRole("img", { name: ja.appbar.signedIn })).toBeNull();
  });

  it("opens and closes the login dialog from the login entry", () => {
    renderAppBar("anonymous");
    fireEvent.click(screen.getByRole("button", { name: ja.appbar.login }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

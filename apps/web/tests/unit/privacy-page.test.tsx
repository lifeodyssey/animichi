/**
 * @vitest-environment jsdom
 */
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrivacyPolicy } from "../../src/components/legal/PrivacyPolicy";
import { dictFor } from "../../src/i18n/dictionaries";
import { renderWithLocale, setLanguages } from "./_i18n";

beforeEach(() => { setLanguages(["ja-JP"]); });
afterEach(cleanup);

describe("PrivacyPolicy", () => {
  it("renders the Japanese notice with a same-origin home link and GitHub contact", () => {
    renderWithLocale(<PrivacyPolicy />);
    expect(screen.getByRole("heading", { name: dictFor("ja").privacy.title })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Animichiに戻る/ }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: dictFor("ja").privacy.contact_link }).getAttribute("href")).toContain("github.com");
  });

  it("switches every visible policy heading and intro without Japanese fallback copy", () => {
    renderWithLocale(<PrivacyPolicy />);
    act(() => { screen.getByRole("button", { name: "中文" }).click(); });
    expect(screen.getByRole("heading", { name: dictFor("zh").privacy.title })).toBeTruthy();
    expect(screen.getByText(dictFor("zh").privacy.intro)).toBeTruthy();
    expect(screen.queryByText(dictFor("ja").privacy.intro)).toBeNull();
  });
});

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
    expect(screen.getByText(dictFor("ja").privacy.version)).toBeTruthy();
    expect(screen.getByText(dictFor("ja").privacy.security_body)).toBeTruthy();
    expect(screen.getByText(dictFor("ja").privacy.evaluation_body)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Animichiに戻る/ }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: dictFor("ja").privacy.contact_link }).getAttribute("href")).toContain("github.com");
  });

  it("switches every visible policy heading and intro without Japanese fallback copy", () => {
    renderWithLocale(<PrivacyPolicy />);
    act(() => { screen.getByRole("button", { name: "中文" }).click(); });
    expect(screen.getByRole("heading", { name: dictFor("zh").privacy.title })).toBeTruthy();
    expect(screen.getByText(dictFor("zh").privacy.intro)).toBeTruthy();
    expect(screen.getByText(dictFor("zh").privacy.improvement_body)).toBeTruthy();
    expect(screen.queryByText(dictFor("ja").privacy.intro)).toBeNull();
  });

  it.each(["ja", "zh", "en"] as const)("states the evaluation safeguards in %s", (locale) => {
    const copy = dictFor(locale).privacy;
    expect(copy.version).toContain("2026-08-02");
    expect(copy.improvement_body).toMatch(/365|365日|365 天/);
    expect(copy.security_body).toContain("AES-256-GCM");
    expect(copy.security_body).toMatch(/API|Authorization|Cookie/);
    expect(copy.evaluation_body).toMatch(/feedback|フィードバック|反馈/);
    expect(copy.evaluation_body).toMatch(/consent|同意/);
  });
});

/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SkipLink, skipLabel } from "../../../src/routes/__root";

afterEach(cleanup);

/**
 * WCAG 2.4.1 Bypass Blocks: a keyboard-reachable "skip to content" link is
 * the page's first tab stop and must expose a localized label plus the
 * #main-content target so a keyboard/screen-reader user can jump the chrome.
 */
describe("skip link", () => {
  it("returns the ja skip label", () => {
    expect(skipLabel("ja")).toBe("コンテンツへ移動");
  });

  it("returns the zh skip label", () => {
    expect(skipLabel("zh")).toBe("跳转到主要内容");
  });

  it("returns the en skip label", () => {
    expect(skipLabel("en")).toBe("Skip to content");
  });

  it("renders an anchor to #main-content with the skip-link class", () => {
    render(<SkipLink lang="en" />);
    const link = screen.getByRole("link", { name: "Skip to content" });
    expect(link.className).toBe("skip-link");
    expect(link.getAttribute("href")).toBe("#main-content");
  });

  it("uses the localized label for the given lang", () => {
    render(<SkipLink lang="ja" />);
    const link = screen.getByRole("link", { name: "コンテンツへ移動" });
    expect(link.className).toBe("skip-link");
    expect(link.getAttribute("href")).toBe("#main-content");
  });
});

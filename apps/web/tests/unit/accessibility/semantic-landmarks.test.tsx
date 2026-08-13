/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LandingPage } from "../../../src/components/landing/LandingPage";
import { LocaleProvider } from "../../../src/i18n/LocaleProvider";

afterEach(cleanup);

function renderLanding() {
  return render(
    <LocaleProvider>
      <LandingPage />
    </LocaleProvider>,
  );
}

/**
 * WCAG 1.3.1 Info & Relationships: landmark roles let assistive tech offer
 * page navigation. Each journey shell must expose the core landmarks.
 */
describe("semantic landmarks: landing", () => {
  it("exposes header, main and footer landmarks", () => {
    renderLanding();
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(document.querySelector("main")).not.toBeNull();
    expect(screen.getByRole("contentinfo")).toBeTruthy();
  });

  it("labels the footer navigation region", () => {
    renderLanding();
    const navs = screen.getAllByRole("navigation");
    expect(navs.length).toBeGreaterThan(0);
    const labelled = navs.find((nav) => (nav.getAttribute("aria-label") ?? "").length > 0);
    expect(labelled).toBeTruthy();
  });
});

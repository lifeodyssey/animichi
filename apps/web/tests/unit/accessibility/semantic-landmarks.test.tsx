/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DoorwaySummary } from "../../../src/features/seo/DoorwaySummary";
import { dictFor } from "../../../src/i18n/dictionaries";
import { LocaleProvider } from "../../../src/i18n/LocaleProvider";
import { AppRouterContext } from "../_router";

afterEach(cleanup);

function renderDoorway() {
  return render(
    <AppRouterContext>
      <LocaleProvider>
        <DoorwaySummary />
      </LocaleProvider>
    </AppRouterContext>,
  );
}

/**
 * WCAG 1.3.1 Info & Relationships: landmark roles let assistive tech offer
 * page navigation. `/` is a desktop entry surface plus the served body for
 * crawlers and share previews, so it needs a main region and named navigation.
 */
describe("semantic landmarks: the `/` doorway", () => {
  it("exposes a main landmark", () => {
    renderDoorway();
    expect(document.querySelector("main")).not.toBeNull();
  });

  it("labels its navigation region", () => {
    renderDoorway();
    const nav = screen.getByRole("navigation");
    expect((nav.getAttribute("aria-label") ?? "").length).toBeGreaterThan(0);
  });

  it("leads with a level-one heading crawlers can read", () => {
    renderDoorway();
    const landing = dictFor("en").landing;
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(landing.headline_pre + landing.headline_em);
  });
});

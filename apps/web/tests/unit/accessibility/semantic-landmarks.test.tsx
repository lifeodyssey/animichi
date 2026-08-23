/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DoorwaySummary } from "../../../src/features/seo/DoorwaySummary";
import { dictFor } from "../../../src/i18n/dictionaries";
import { LocaleProvider } from "../../../src/i18n/LocaleProvider";

afterEach(cleanup);

function renderDoorway() {
  return render(
    <LocaleProvider>
      <DoorwaySummary />
    </LocaleProvider>,
  );
}

/**
 * WCAG 1.3.1 Info & Relationships: landmark roles let assistive tech offer
 * page navigation. `/` is a doorway now (owner 2026-08-23) — a minimal served
 * body for crawlers and share previews — so the landmark bar it must clear is
 * the minimal one: a main region and a named navigation region.
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
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(dictFor("en").doorway.hero);
  });
});

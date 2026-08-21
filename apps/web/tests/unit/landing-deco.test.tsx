/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LandingDeco } from "../../src/components/landing/LandingDeco";

afterEach(cleanup);

describe("LandingDeco", () => {
  it("renders the hidden decoration layer with the cherry-branch foliage", () => {
    const { container } = render(<LandingDeco />);
    const deco = container.querySelector(".landing-deco");
    expect(deco?.getAttribute("aria-hidden")).toBe("true");
    const foliage = container.querySelector("img.landing-deco__foliage");
    expect(foliage?.getAttribute("src")).toBe("/images/landing/foliage-tr.svg");
    expect(foliage?.getAttribute("alt")).toBe("");
  });

  it("scatters 14 petals with inline position, size, and animation timing", () => {
    const { container } = render(<LandingDeco />);
    const petals = container.querySelectorAll<HTMLElement>(".landing-deco__petal");
    expect(petals).toHaveLength(14);
    const first = petals[0];
    expect(first?.style.left).toBe("55.3%");
    expect(first?.style.width).toBe("14px");
    expect(first?.style.animationDuration).toBe("11.9s");
    expect(first?.style.animationDelay).toBe("-4.4s");
    expect(first?.style.background).toContain("linear-gradient");
  });
});

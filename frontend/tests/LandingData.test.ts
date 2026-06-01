/**
 * LandingData — handleImageError fallback behavior.
 *
 * Covers:
 * - target.style.display is set to "none"
 * - parent receives the "img-error-bg" CSS class (warm muted fallback)
 */

import { describe, it, expect } from "vitest";
import { handleImageError } from "@/components/auth/LandingData";

function makeMockEvent(hasParent = true) {
  const classList = { add: (cls: string) => { classList._added.push(cls); }, _added: [] as string[] };
  const target = {
    style: { display: "" } as CSSStyleDeclaration,
    parentElement: hasParent
      ? ({ classList } as unknown as HTMLElement)
      : null,
  };
  return {
    currentTarget: target,
    _classList: classList,
  } as unknown as React.SyntheticEvent<HTMLImageElement> & { _classList: typeof classList };
}

describe("handleImageError", () => {
  it("hides the image by setting display to none", () => {
    const event = makeMockEvent();
    handleImageError(event);
    expect(event.currentTarget.style.display).toBe("none");
  });

  it("adds img-error-bg class to parent element", () => {
    const event = makeMockEvent() as ReturnType<typeof makeMockEvent>;
    handleImageError(event);
    expect(event._classList._added).toContain("img-error-bg");
  });

  it("does not throw when parent element is null", () => {
    const event = makeMockEvent(false);
    expect(() => handleImageError(event)).not.toThrow();
    expect(event.currentTarget.style.display).toBe("none");
  });
});

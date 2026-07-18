import { describe, expect, it } from "vitest";
import { pinFill, pinLabel, pinRadius, pinStroke, pinTextFill } from "../../src/features/map-spike/pins";
import type { Spot } from "../../src/features/map-spike/spots";

const spot = (kind: Spot["kind"]): Spot => ({ id: kind, label: kind, coord: [0, 0], kind });

describe("pinFill", () => {
  it.each([
    ["start", "var(--color-map-pin-teal)"],
    ["highlight", "var(--color-map-pin-orange)"],
    ["normal", "var(--color-bg)"],
  ] as const)("uses a semantic token for the %s pin", (kind, token) => {
    expect(pinFill(kind)).toBe(token);
  });
});

describe("pinStroke and pinTextFill", () => {
  it("outlines a normal pin in teal with teal text", () => {
    expect(pinStroke("normal")).toBe("var(--color-map-pin-teal)");
    expect(pinTextFill("normal")).toBe("var(--color-map-pin-teal)");
  });

  it("outlines a filled pin in ink with foreground text", () => {
    expect(pinStroke("highlight")).toBe("var(--color-fg)");
    expect(pinTextFill("start")).toBe("var(--color-primary-fg)");
  });
});

describe("pinRadius", () => {
  it("enlarges the highlight pin", () => {
    expect(pinRadius("highlight")).toBe(21);
    expect(pinRadius("normal")).toBe(18);
  });
});

describe("pinLabel", () => {
  it("marks the start spot with 出", () => {
    expect(pinLabel(spot("start"), 0)).toBe("出");
  });

  it("marks the highlight spot with a star", () => {
    expect(pinLabel(spot("highlight"), 3)).toBe("★");
  });

  it("numbers a normal spot from one", () => {
    expect(pinLabel(spot("normal"), 1)).toBe("2");
  });
});

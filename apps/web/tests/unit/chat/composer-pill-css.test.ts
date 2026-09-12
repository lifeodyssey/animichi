import { describe, expect, it } from "vitest";
import globalsCss from "../../../src/styles/globals.css?raw";
import {
  contrastRatio,
  parseTokens,
  tokenValue,
} from "../stylesheet-probe";

const day = parseTokens(globalsCss);
describe("D9 scene fallback: readable metadata on its muted surface", () => {
  it("keeps the episode text above AA", () => {
    expect(contrastRatio(tokenValue(day, "--color-fg"), tokenValue(day, "--color-muted"))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("B2c waiting aside: readable quote and attribution", () => {
  it.each(["--color-fg", "--color-muted-fg"])("keeps %s above AA on the cream surface", (ink) => {
    expect(contrastRatio(tokenValue(day, ink), tokenValue(day, "--color-card"))).toBeGreaterThanOrEqual(4.5);
  });
});

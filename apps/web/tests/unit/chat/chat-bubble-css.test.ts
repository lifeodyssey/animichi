import { describe, expect, it } from "vitest";
import { contrastRatio, parseTokens, tokenValue } from "../stylesheet-probe";
import globalsCss from "../../../src/styles/globals.css?raw";

const tokens = parseTokens(globalsCss);

describe("message text remains readable on both chat surfaces", () => {
  it.each(["--color-paper", "--color-ground"])("keeps assistant text above AA on %s", (background) => {
    const ratio = contrastRatio(tokenValue(tokens, "--color-ground-ink"), tokenValue(tokens, background));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps user text above AA on the soft teal bubble", () => {
    const ratio = contrastRatio(tokenValue(tokens, "--color-primary-ink"), tokenValue(tokens, "--color-primary-soft"));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

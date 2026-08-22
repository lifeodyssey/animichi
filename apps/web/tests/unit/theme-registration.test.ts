import { describe, expect, it } from "vitest";
import globalsCss from "../../src/styles/globals.css?raw";
import { parseBlockTokens, parseTokens } from "./stylesheet-probe";

const rootTokens = parseTokens(globalsCss);
const themeTokens = parseBlockTokens(globalsCss, "@theme inline");

/** Semantic Tailwind utilities only exist once the tokens are registered. */
describe("Tailwind theme registration", () => {
  it("registers every :root colour token under the --color-* namespace", () => {
    const colours = Object.keys(rootTokens).filter((name) => name.startsWith("--color-"));
    expect(colours.length).toBeGreaterThan(30);
    for (const name of colours) expect(themeTokens[name]).toBe(`var(${name})`);
  });

  it("aliases the app font stacks onto the --font-* namespace", () => {
    expect(themeTokens["--font-display"]).toBe("var(--app-font-display)");
    expect(themeTokens["--font-body"]).toBe("var(--app-font-body)");
  });

  it("keeps the shadow tokens out of the theme, they are not shadow values", () => {
    expect(themeTokens["--shadow-3d"]).toBeUndefined();
    expect(themeTokens["--shadow-press"]).toBeUndefined();
    expect(themeTokens["--font-mono"]).toBeUndefined();
  });

  it("layers the element defaults so page utilities can win over them", () => {
    const base = /@layer base \{([\s\S]*?)\n\}/u.exec(globalsCss)?.[1] ?? "";
    expect(base).toContain("a {");
  });
});
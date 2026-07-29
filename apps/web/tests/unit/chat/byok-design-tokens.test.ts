import { describe, expect, it } from "vitest";
import byokSettingsSource from "../../../src/features/chat/components/ByokSettings.tsx?raw";
import byokUpsellSource from "../../../src/features/chat/components/ByokUpsell.tsx?raw";
import budgetExhaustedSource from "../../../src/features/chat/components/ErrorStates/BudgetExhausted.tsx?raw";
import chatCss from "../../../src/styles/chat.css?raw";

/**
 * T6-AC9 / T8-AC9 (issue #284): design-token enforcement as a SOURCE grep
 * over the new/changed surfaces — not a rendered-DOM check, which would miss
 * an unused-but-committed class. Animal Island tokens only.
 */
const SOURCES: readonly (readonly [string, string])[] = [
  ["ByokSettings.tsx", byokSettingsSource],
  ["ByokUpsell.tsx", byokUpsellSource],
  ["BudgetExhausted.tsx", budgetExhaustedSource],
];

/** Hardcoded Tailwind palette classes the spec names, plus the palette shape. */
const TAILWIND_PALETTE = /\b(?:bg|text|border)-(?:white|black|gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?\b/;

function byokCssRules(): readonly string[] {
  return [...chatCss.matchAll(/\.chat-byok[^{]*\{([^}]*)\}/g)].map((match) => match[1] ?? "");
}

describe("BYOK surfaces — design tokens only (T6-AC9)", () => {
  it.each(SOURCES)("%s carries no hardcoded Tailwind palette class", (_name, source) => {
    expect(source).not.toMatch(TAILWIND_PALETTE);
  });

  it.each(SOURCES)("%s carries no inline hex color", (_name, source) => {
    const withoutComments = source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/\/\/[^\n]*/g, "");
    expect(withoutComments).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("styles every .chat-byok color through var(--…) tokens, never a literal", () => {
    const rules = byokCssRules();
    expect(rules.length).toBeGreaterThan(0);
    for (const body of rules) {
      const colorLines = body.split(";").filter((line) => /(?:background|color|border|outline|box-shadow):/.test(line));
      for (const line of colorLines) {
        expect(line).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      }
    }
  });

  it("keeps the BYOK CTAs cream — no gold token spent (一屏唯一金, #462 precedent)", () => {
    for (const body of byokCssRules()) {
      expect(body).not.toContain("--color-gold");
    }
  });
});

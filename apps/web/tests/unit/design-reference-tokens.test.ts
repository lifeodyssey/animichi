/**
 * SUT: `docs/design/animal-island-ref/color-and-depth.md`.
 *
 * The reference is the first read for design work, so its claims about our live
 * tokens have to stay true. This suite re-derives every claim and every AA cell
 * from `apps/web/src/styles/globals.css`; a restored phantom token or a stale
 * value turns it red. Contrast math comes from the existing probe.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import globalsCss from "../../src/styles/globals.css?raw";
import { parseTokens } from "./stylesheet-probe";
import {
  authorityViolations,
  claimViolations,
  contrastRow,
  contrastViolations,
  mentionViolations,
  parseContrastRows,
  upstreamMutedDecision,
  type DesignDoc,
} from "./design-reference-probe";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const REFERENCE = "docs/design/animal-island-ref/color-and-depth.md";
const reference = readFileSync(resolve(ROOT, REFERENCE), "utf8");
const tokens = parseTokens(globalsCss);

/** Design and product docs a reader follows for the design system. */
const DESIGN_DOCS = [
  "apps/web/PRODUCT.md",
  "apps/web/AGENTS.md",
  "docs/DOCS_POLICY.md",
  "docs/agents/frontend.md",
  ".claude/rules/css.md",
  "docs/design/animal-island-ref/color-and-depth.md",
  "docs/design/animal-island-ref/component-specs.md",
  "docs/design/animal-island-ref/interaction-and-motion.md",
  "docs/design/animal-island-ref/typography-and-spacing.md",
];

const designDocs: readonly DesignDoc[] = DESIGN_DOCS.map((path) => ({
  path,
  text: readFileSync(resolve(ROOT, path), "utf8"),
}));

const RESTORED_HEADING_LINE =
  "**Ours:** `--color-fg: #725d42` / `--color-fg-heading: #794f27` / `--color-muted-fg: #9f927d` -- Aligned.";

describe("animal-island reference token claims", () => {
  it("names no token the live sheet does not define", () => {
    expect(mentionViolations(reference, tokens)).toEqual([]);
  });

  it("pins every token claim to its live value", () => {
    expect(claimViolations(reference, tokens)).toEqual([]);
  });

  it("catches the restored heading-tone line", () => {
    const mutated = `${reference}\n${RESTORED_HEADING_LINE}\n`;
    expect(mentionViolations(mutated, tokens)).toEqual(["--color-fg-heading"]);
    expect(claimViolations(mutated, tokens)).toContain("--color-muted-fg: doc #9f927d, live #6f6353");
  });
});

describe("per-surface AA table", () => {
  it("recomputes every cell from the live sheet", () => {
    expect(contrastViolations(reference, tokens)).toEqual([]);
  });

  it("covers the live ramp and the upstream-only tones", () => {
    expect(parseContrastRows(reference)).toHaveLength(6);
  });

  it("lists each live text token once, in ramp order", () => {
    expect(parseContrastRows(reference).filter((row) => row.isToken).map((row) => row.name)).toEqual([
      "--color-fg",
      "--color-fg-ink",
      "--color-muted-fg",
    ]);
  });

  it("labels every upstream-only tone as upstream-only", () => {
    expect(parseContrastRows(reference).filter((row) => !row.isToken).map((row) => row.name)).toEqual([
      "text-color-muted (upstream-only)",
      "text-color-secondary (upstream-only)",
      "text-color-disabled (upstream-only)",
    ]);
  });

  it("judges the secondary token on the card ground its comment names", () => {
    expect(contrastRow(reference, "--color-muted-fg")?.passes).toEqual([true, false, true]);
  });

  it("records the upstream muted decision with its muted ratio", () => {
    expect(upstreamMutedDecision(reference)).toContain("not adopted");
    expect(contrastRow(reference, "text-color-muted (upstream-only)")?.ratios).toEqual([3.69, 3.057, 3.854]);
  });
});

describe("design-reference authority", () => {
  it("never names the superseded directory as authoritative", () => {
    expect(authorityViolations(designDocs)).toEqual([]);
  });
});

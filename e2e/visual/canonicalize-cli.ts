/**
 * CLI entry for mockup canonicalization (S0-v2 C3). Kept separate from
 * canonicalize.ts so that module stays pure (Playwright-importable).
 *
 * Usage (repo root, Node >= 22.6):
 *   node --experimental-strip-types e2e/visual/canonicalize-cli.ts \
 *     --out e2e/visual/canonical --fonts apps/web/src/styles/fonts.css
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalize, collectStylesheetLinks, copyAssets, linkHref } from "./canonicalize.ts";
import { VISUAL_FRAMES } from "./frames.ts";

interface CliArgs {
  outDir: string;
  fontsCssPath: string;
}

function parseArgs(argv: string[]): CliArgs {
  const valueOf = (flag: string, fallback: string): string => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] ?? fallback : fallback;
  };
  return {
    outDir: valueOf("--out", "e2e/visual/canonical"),
    fontsCssPath: valueOf("--fonts", "apps/web/src/styles/fonts.css"),
  };
}

function main(): void {
  const { outDir, fontsCssPath } = parseArgs(process.argv.slice(2));
  mkdirSync(outDir, { recursive: true });
  const appFontsCss = readFileSync(fontsCssPath, "utf8");
  for (const frame of Object.values(VISUAL_FRAMES)) {
    const html = readFileSync(frame.mockup, "utf8");
    const mockupDir = path.dirname(frame.mockup);
    const stylesheets = collectStylesheetLinks(html)
      .map((tag) => linkHref(tag))
      .filter((href) => !href.startsWith("http"))
      .map((href) => ({ href, css: readFileSync(path.join(mockupDir, href), "utf8") }));
    const result = canonicalize({ html, appFontsCss, stylesheets, mode: frame.mode });
    writeFileSync(path.join(outDir, frame.canonicalName), result.html);
    copyAssets(mockupDir, outDir, result.assetRefs);
  }
  console.log(`canonicalized ${Object.keys(VISUAL_FRAMES).length} frame(s) into ${outDir}`);
}

main();

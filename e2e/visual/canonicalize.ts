/**
 * Mockup canonicalization for the visual pipeline (S0-v2 C3).
 *
 * Pure transform: the same (html, stylesheets, appFontsCss, mode) always
 * produce byte-identical output. Nothing here touches the network, the clock,
 * or any non-deterministic input.
 *
 * What it does, in order:
 *  1. drops Google Fonts <link>s (fonts.googleapis.com / fonts.gstatic.com),
 *  2. strips every <script> (dev chrome: scene-cut, image-slot, mode toggle…),
 *  3. removes the #modeTg day/night dev toggle,
 *  4. drops stylesheets that carry @font-face (CDN font sheets) and inlines
 *     the rest verbatim (rewriting relative url() refs to assets/),
 *  5. injects the app's self-hosted @font-face CSS (apps/web/src/styles/fonts.css),
 *  6. injects an animation/transition kill style + prefers-reduced-motion block,
 *  7. bakes the day/night mode into <body> so the mode is part of the bytes.
 *
 * Also runs as a CLI (Node >= 22.6, ESM):
 *   node --experimental-strip-types e2e/visual/canonicalize.ts \
 *     --out e2e/visual/canonical --fonts apps/web/src/styles/fonts.css
 */

import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { type VisualMode } from "./frames.ts";

export interface StylesheetRef {
  href: string;
  css: string;
}

export interface CanonicalizeInput {
  html: string;
  appFontsCss: string;
  stylesheets: StylesheetRef[];
  mode: VisualMode;
}

export interface CanonicalizeResult {
  html: string;
  /** assets/<rel> paths referenced by the canonical HTML (src/href + CSS url()). */
  assetRefs: string[];
}

const SCRIPT_RE = /<script\b[^>]*>[\s\S]*?<\/script[^>]*>/gi;
const GOOGLE_FONTS_LINK_RE = /<link[^>]*?href="[^"]*fonts\.googleapis\.com[^"]*"[^>]*>/gi;
const GSTATIC_LINK_RE = /<link[^>]*?href="[^"]*fonts\.gstatic\.com[^"]*"[^>]*>/gi;
const STYLESHEET_LINK_RE = /<link[^>]*rel=["']stylesheet["'][^>]*>/gi;
const HREF_ATTR_RE = /href="([^"]+)"/;
const ASSET_ATTR_RE = /(?:src|href)="(assets\/[^"]+)"/g;
const CSS_URL_RE = /url\(["']?(\.[^"')]+)["']?\)/g;
const MODE_TG_RE = /<div id="modeTg"[\s\S]*?<\/div>/gi;

const ANIMATION_KILL_CSS = [
  "@media (prefers-reduced-motion: reduce){",
  "  *,*::before,*::after{animation-duration:1ms!important;animation-iteration-count:1!important;transition-duration:1ms!important;scroll-behavior:auto!important;}",
  "}",
  "*,*::before,*::after{animation:none!important;animation-play-state:paused!important;transition:none!important;}",
].join("\n");

function dropGoogleFontLinks(html: string): string {
  return html.replace(GOOGLE_FONTS_LINK_RE, "").replace(GSTATIC_LINK_RE, "");
}

function replaceUntilStable(html: string, re: RegExp): string {
  let prev = "";
  while (prev !== html) {
    prev = html;
    html = html.replace(re, "");
  }
  return html;
}

function stripScripts(html: string): string {
  return replaceUntilStable(html, SCRIPT_RE);
}

function removeModeToggle(html: string): string {
  return replaceUntilStable(html, MODE_TG_RE);
}

export function linkHref(linkTag: string): string {
  const match = linkTag.match(HREF_ATTR_RE);
  return match ? match[1] : "";
}

/** All stylesheet <link> tags, in document order. */
export function collectStylesheetLinks(html: string): string[] {
  return Array.from(html.matchAll(STYLESHEET_LINK_RE), (m) => m[0]).filter((tag) => linkHref(tag) !== "");
}

const FONT_FACE_RE = /@font-face\s*\{[^}]*\}/g;

/** Strip @font-face blocks; what remains is layout CSS. */
function stripFontFaces(css: string): string {
  return css.replace(FONT_FACE_RE, "");
}

/** A sheet that is only font declarations is replaced by the app font CSS. */
function isFontSheet(css: string): boolean {
  return stripFontFaces(css).trim() === "";
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Rewrite relative url() refs to canonical assets/ and record what to copy. */
function rewriteCssUrls(css: string, href: string, assetRefs: string[]): string {
  const cssDir = path.posix.dirname(href);
  return css.replace(CSS_URL_RE, (match, ref: string) => {
    const target = path.posix.normalize(`${cssDir}/${ref}`);
    if (!target.startsWith("assets/")) return match;
    assetRefs.push(target);
    return match.replace(ref, target);
  });
}

/** Drop dead #modeTg CSS rules (the element itself is removed earlier). */
function stripModeToggleCss(css: string): string {
  return css.replace(/#modeTg[^{]*\{[^}]*\}/g, "");
}

function inlineStylesheets(html: string, stylesheets: StylesheetRef[], assetRefs: string[]): string {
  for (const sheet of stylesheets) {
    const hrefRe = new RegExp(`<link[^>]*href=["']${escapeRegex(sheet.href)}["'][^>]*>`, "i");
    if (isFontSheet(sheet.css)) {
      html = html.replace(hrefRe, "");
      continue;
    }
    const css = stripFontFaces(rewriteCssUrls(sheet.css, sheet.href, assetRefs));
    const style = `<style data-visual-inline="${sheet.href}">\n${css}\n</style>`;
    html = html.replace(hrefRe, style);
  }
  return html;
}

function injectAppFonts(html: string, appFontsCss: string): string {
  const style = `<style data-visual-fonts="app">\n${appFontsCss}\n</style>`;
  return html.replace(/<head[^>]*>/, (match) => `${match}\n${style}`);
}

function injectAnimationKill(html: string): string {
  const style = `<style data-visual-determinism="animations">\n${ANIMATION_KILL_CSS}\n</style>`;
  return html.replace("</head>", `${style}\n</head>`);
}

function applyBodyMode(html: string, mode: VisualMode): string {
  if (mode === "day") return html;
  return html.replace(/<body(\s[^>]*)?>/i, (match, attrs: string | undefined) => {
    if (!attrs) return '<body class="night">';
    if (attrs.includes("class=")) return match.replace(/class="([^"]*)"/, 'class="$1 night"');
    return `<body${attrs} class="night">`;
  });
}

export function collectAssetRefs(html: string): string[] {
  return [...new Set(Array.from(html.matchAll(ASSET_ATTR_RE), (m) => m[1]))].sort((a, b) => a.localeCompare(b));
}

export function canonicalize(input: CanonicalizeInput): CanonicalizeResult {
  const assetRefs: string[] = [];
  let html = dropGoogleFontLinks(input.html);
  html = stripScripts(html);
  html = removeModeToggle(html);
  html = inlineStylesheets(html, input.stylesheets, assetRefs);
  html = injectAppFonts(html, input.appFontsCss);
  html = injectAnimationKill(html);
  html = stripModeToggleCss(html);
  html = applyBodyMode(html, input.mode);
  return { html, assetRefs: [...new Set(assetRefs)].concat(collectAssetRefs(html)) };
}

/** Materialize referenced mockup assets next to the canonical HTML. */
export function copyAssets(mockupDir: string, outDir: string, assetRefs: string[]): void {
  for (const ref of assetRefs) {
    const source = path.join(mockupDir, ref);
    const target = path.join(outDir, ref);
    if (ref.startsWith("assets/") && path.resolve(target).startsWith(path.resolve(outDir))) {
      mkdirSync(path.dirname(target), { recursive: true });
      try {
        copyFileSync(source, target);
      } catch {
        // Referenced but absent in this mockup's asset tree: leave the URL as-is.
      }
    }
  }
}

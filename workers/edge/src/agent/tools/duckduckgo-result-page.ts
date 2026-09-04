/**
 * One DuckDuckGo HTML result page, read as results.
 *
 * Pure, and separate from the fetch on purpose: the parse is the brittle half
 * of this adapter — it depends on somebody else's markup — so it is the half
 * that gets a committed fixture and a unit test rather than a network round
 * trip.
 *
 * The markup, measured against `https://html.duckduckgo.com/html/` on
 * 2026-09-04 (`test/fixtures/duckduckgo-result-page.html` is that response,
 * trimmed): each result is an `<a class="result__a" href="…">title</a>`
 * followed by an optional `<a class="result__snippet">body</a>`, ten per page.
 * They are paired by POSITION — the snippet belongs to the nearest title anchor
 * above it — because a result without a snippet must not steal the next one's.
 *
 * Two things this deliberately does NOT do:
 *   - it does not sanitise. Decoding entities here and sanitising in
 *     `web-result-trust.ts` is the right order: `&lt;/untrusted_web_result&gt;`
 *     becomes the literal tag here and is stripped there, whereas sanitising
 *     first would leave the encoded form to be decoded into a forged delimiter
 *     by nobody in particular.
 *   - it does not trust the anchor's own href when DuckDuckGo wrapped it in its
 *     `/l/?uddg=` redirector. The wrapped target is what the source tier is
 *     read from, so a page of wrapped links would otherwise be a page of
 *     `duckduckgo.com` results.
 */

import type { WebResult } from "./web-searcher.ts";

const TITLE_ANCHOR = /<a\b([^>]*\bclass="result__a"[^>]*)>([\s\S]*?)<\/a>/g;
const SNIPPET_ANCHOR = /<a\b[^>]*\bclass="result__snippet"[^>]*>([\s\S]*?)<\/a>/;
const HREF_ATTRIBUTE = /\bhref="([^"]*)"/;
const MARKUP_TAG = /<[^>]*>/g;

/** The named entities DuckDuckGo's own escaping actually emits. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

const ENTITY = /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi;

/** A numeric entity's own character, or null when it names no code point. */
function codePointText(code: number): string | null {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return null;
  return String.fromCodePoint(code);
}

/** One entity's own text: a code point, a known name, or itself unchanged. */
function decodedEntity(whole: string, body: string): string {
  const hex = body.startsWith("#x") || body.startsWith("#X");
  if (hex) return codePointText(Number.parseInt(body.slice(2), 16)) ?? whole;
  if (body.startsWith("#")) return codePointText(Number(body.slice(1))) ?? whole;
  return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
}

/** Inner markup dropped, entities decoded, surrounding whitespace trimmed. */
function textOf(markup: string): string {
  return markup.replace(MARKUP_TAG, "").replace(ENTITY, decodedEntity).trim();
}

/**
 * DuckDuckGo's redirector unwrapped to the destination it names.
 *
 * `//duckduckgo.com/l/?uddg=<encoded>` is how the HTML endpoint spells some of
 * its links; the base is only there so a protocol-relative href can be parsed
 * at all, and it is never fetched.
 */
function directHref(href: string): string {
  let url: URL;
  try {
    url = new URL(href, "https://duckduckgo.com");
  } catch {
    return href;
  }
  if (!url.pathname.startsWith("/l/")) return href;
  return url.searchParams.get("uddg") ?? href;
}

/** One result, from its title anchor and whatever snippet follows it. */
function resultOf(attributes: string, title: string, followingMarkup: string): WebResult | null {
  const href = HREF_ATTRIBUTE.exec(attributes)?.[1];
  if (href === undefined || href === "") return null;
  const body = SNIPPET_ANCHOR.exec(followingMarkup)?.[1] ?? "";
  return { title: textOf(title), body: textOf(body), href: directHref(href) };
}

/** Every result the page lists, in the order DuckDuckGo ranked them. */
export function duckduckgoResults(html: string): WebResult[] {
  const anchors = [...html.matchAll(TITLE_ANCHOR)];
  return anchors.flatMap((anchor, index) => {
    const from = anchor.index + anchor[0].length;
    const to = anchors[index + 1]?.index ?? html.length;
    const result = resultOf(anchor[1] ?? "", anchor[2] ?? "", html.slice(from, to));
    return result === null ? [] : [result];
  });
}

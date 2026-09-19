import { describe, expect, it } from "vitest";
import { contentOf, inlineScriptTagsOf, nonceOf } from "../csp-evaluator";

/**
 * Why the tag patterns in `csp-evaluator.ts` are case-insensitive, asserted
 * rather than argued: HTML tag and attribute names are. A browser runs
 * `<SCRIPT>` exactly as it runs `<script>`, so an evaluator matching only the
 * lower-case spelling would report "every inline script carries the served
 * nonce" for a document holding one it never looked at. That false green is the
 * one failure this helper exists to prevent, and it is what CodeQL found
 * (`js/bad-tag-filter`, alerts 30/31) — the fix is the behaviour below, not the
 * query going quiet. Its second finding on this file (32/33) is the same
 * mistake one character over: a browser discards the whitespace in `</script >`,
 * so a closer blind to it misses the script entirely, and the spaced spellings
 * are asserted beside the case-varied ones for that reason.
 */

const UPPER = "<SCRIPT>steal()</SCRIPT>";
const MIXED = '<ScRiPt nonce="abc">go()</ScRiPt>';
const EXTERNAL = '<SCRIPT SRC="/assets/app.js"></SCRIPT>';
const SPACED = '<script nonce="abc">go()</script >';

describe("inlineScriptTagsOf", () => {
  it("finds an upper-case inline script", () => {
    expect(inlineScriptTagsOf(UPPER)).toEqual([UPPER]);
  });

  it("finds a mixed-case inline script, nonce and all", () => {
    expect(inlineScriptTagsOf(MIXED)).toEqual([MIXED]);
  });

  it("still excludes an external script whose tag and attribute are upper-case", () => {
    expect(inlineScriptTagsOf(EXTERNAL)).toEqual([]);
  });

  it("keeps the lower-case spelling working", () => {
    expect(inlineScriptTagsOf('<script nonce="abc">go()</script>')).toEqual(['<script nonce="abc">go()</script>']);
  });

  it("finds a script whose end tag spaces the bracket", () => {
    expect(inlineScriptTagsOf(SPACED)).toEqual([SPACED]);
  });
});

describe("reading a script tag the document did not spell in lower case", () => {
  it("takes the nonce off a mixed-case tag", () => {
    expect(nonceOf(MIXED)).toBe("abc");
  });

  it("takes the content out of an upper-case tag", () => {
    expect(contentOf(UPPER)).toBe("steal()");
  });

  it("takes the content out of a tag whose end tag spaces the bracket", () => {
    expect(contentOf(SPACED)).toBe("go()");
  });
});

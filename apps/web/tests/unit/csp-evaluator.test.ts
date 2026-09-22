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
 * query going quiet. Its second finding on this file is the same
 * mistake at the other end of the element: a browser ends an end tag at its
 * first `>`, discarding whatever precedes it (`</script >`, even
 * `</script foo="bar">`), so a closer that stops after the tag name misses the
 * script entirely, and the spaced and junked closers are asserted beside the
 * case-varied spellings for that reason.
 */

const UPPER = "<SCRIPT>steal()</SCRIPT>";
const MIXED = '<ScRiPt nonce="abc">go()</ScRiPt>';
const EXTERNAL = '<SCRIPT SRC="/assets/app.js"></SCRIPT>';
const SPACED = '<script nonce="abc">go()</script >';
const JUNKED = '<script nonce="abc">go()</script foo="bar">';

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

  it("finds a script whose end tag carries junk before the bracket", () => {
    expect(inlineScriptTagsOf(JUNKED)).toEqual([JUNKED]);
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

  it("takes the content out of a tag whose end tag carries junk before the bracket", () => {
    expect(contentOf(JUNKED)).toBe("go()");
  });
});

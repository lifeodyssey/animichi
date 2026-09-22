import { createHash } from "node:crypto";

/**
 * A model of the one Content-Security-Policy decision these tests need: given a
 * policy header value and an inline `<script>`, would a browser run it?
 *
 * It exists because nothing in this package's dependency set enforces CSP —
 * jsdom says so in as many words ("Not implemented: CSP") — and a test that
 * only asserts the header is present would pass just as happily against
 * `script-src 'unsafe-inline'`, which buys nothing. The card that asked for
 * this policy asked for the refusal, so the refusal is what gets asserted.
 *
 * It deliberately consumes the header *text*, exactly what the browser
 * receives, rather than the builder's own data structures: it models the spec's
 * "does element match source list" step for inline scripts, and the digest is
 * computed by this file, not by the code under test.
 *
 * Every tag pattern below is case-insensitive, because HTML tag and attribute
 * names are: a browser runs `<SCRIPT>` exactly as it runs `<script>`. Matching
 * only the lower-case spelling would let that tag past the assertion that every
 * inline script carries the served nonce — a false green in the one check this
 * file exists to make (CodeQL `js/bad-tag-filter`, alerts 30/31).
 *
 * The closer's bracket is where a regex and a real tokenizer can disagree, so
 * what the tokenizer does here is stated as measured, against parse5@8.0.1
 * (the spec-compliant parser inside this package's jsdom), not as folklore.
 * parse5 ends `</script f="a>b">` at its last `>`, not its first: `f="a>b"` is
 * a quoted attribute value, so the `>` inside it is part of the value, the end
 * tag carries `f` as an attribute, and the text node that follows is `B`, not
 * `b">B`. `</scriptx>` is not an end tag carrying junk: the `x` joins the
 * would-be tag name, so inside script data the whole spelling comes out as
 * character text and the script stays open. `</script >` and
 * `</script foo="bar">` do close the script exactly as `</script>` does — the
 * junk is parsed as attributes, which tree construction then ignores. The
 * closer `<\/script[^>]*>` agrees with parse5 on those two spellings, matching
 * them in full: `[^>]*` runs to the first `>`, past anything that is not a
 * `>`. Where parse5 and the pattern disagree, the pattern fails safe, and that
 * is why the imprecision is tolerable. On `</script f="a>b">` the match
 * truncates at the first `>`, mid-attribute — but the match still starts at
 * the open tag, so the nonce `nonceOf` reads is intact; `matchAll` resumes
 * from earlier than the tokenizer's true end of the tag, inside the junk, so
 * what follows is re-scanned rather than skipped; and the three attack
 * documents built on these spellings still evaluate `false`, the attacker's
 * script refused the nonce in each. A match that ends early can only surface
 * more of the document, never hide an open tag from the scan. The pattern does
 * accept `</scriptx>` as a closer where parse5 has none, and errs the same
 * way: the open tag is still what `nonceOf` reads. Every spelling is refused
 * the nonce for the same reason, so every spelling has to be recognised first
 * — the false green CodeQL has now raised twice on this file.
 */

export interface InlineScript {
  /** The element's `nonce` attribute, when it has one. */
  readonly nonce?: string;
  /** The element's text content. */
  readonly content: string;
}

/** Sources listed for `name`, falling back to `default-src` as a browser does. */
export function sourceList(policy: string, name: string): readonly string[] {
  const named = directiveTokens(policy, name);
  return named.length > 0 ? named : directiveTokens(policy, "default-src");
}

function directiveTokens(policy: string, name: string): readonly string[] {
  const directive = policy.split(";").find((part) => part.trim().startsWith(`${name} `));
  return directive === undefined ? [] : directive.trim().slice(name.length + 1).split(/\s+/);
}

export function sha256Base64(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("base64");
}

/** `'strict-dynamic'` never rescues an inline script: only nonce/hash can. */
function matchesNonce(sources: readonly string[], script: InlineScript): boolean {
  return script.nonce !== undefined && sources.includes(`'nonce-${script.nonce}'`);
}

export function allowsInlineScript(policy: string, script: InlineScript): boolean {
  const sources = sourceList(policy, "script-src");
  if (sources.includes("'unsafe-inline'")) return true;
  if (matchesNonce(sources, script)) return true;
  return sources.includes(`'sha256-${sha256Base64(script.content)}'`);
}

/** Every inline script's opening tag, so a caller can read its `nonce`. */
export function inlineScriptTagsOf(html: string): readonly string[] {
  const tags = [...html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script[^>]*>/giu)].map((match) => match[0]);
  return tags.filter((tag) => !/\bsrc=/iu.test(tag.slice(0, tag.indexOf(">") + 1)));
}

export function nonceOf(scriptTag: string): string | undefined {
  return /<script\b[^>]*\bnonce="([^"]*)"/iu.exec(scriptTag)?.[1];
}

export function contentOf(scriptTag: string): string {
  return /<script\b[^>]*>([\s\S]*?)<\/script[^>]*>/iu.exec(scriptTag)?.[1] ?? "";
}

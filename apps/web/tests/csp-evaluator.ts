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
  const tags = [...html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gu)].map((match) => match[0]);
  return tags.filter((tag) => !/\bsrc=/u.test(tag.slice(0, tag.indexOf(">") + 1)));
}

export function nonceOf(scriptTag: string): string | undefined {
  return /<script\b[^>]*\bnonce="([^"]*)"/u.exec(scriptTag)?.[1];
}

export function contentOf(scriptTag: string): string {
  return /<script\b[^>]*>([\s\S]*?)<\/script>/u.exec(scriptTag)?.[1] ?? "";
}

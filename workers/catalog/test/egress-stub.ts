import type { FetchLike } from "../src/ingest/sources";

/**
 * Test stand-in for the anitabi egress service (#1792). The signing key is
 * generated at RUNTIME — no key value ever lives in this tree — and the
 * wrappers stamp the response markers the real service sends. The strict
 * wrapper additionally verifies the signature the way the service does, so
 * tests can prove the catalog signs correctly.
 *
 * There is deliberately no base URL here: the egress address is a constant in
 * `src/ingest/anitabi-egress.ts` and `fetchImpl` is the test seam, so a test
 * that wants to see the destination reads the URL the code actually built.
 */

/** A fresh random key (workerd WebCrypto), never a literal. */
export function stubEgressSigningKey(): string {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

const RESPONSE_MARKER = "x-egress-response";
const RELAYED = "relayed-upstream";

/** Rewrite a canned response so it carries the service's relayed marker, keeping any original headers. */
function withMarkers(res: Awaited<ReturnType<FetchLike>>, extraHeaders: Record<string, string> = {}): Awaited<ReturnType<FetchLike>> {
  const markers: Record<string, string> = { [RESPONSE_MARKER]: RELAYED, ...extraHeaders };
  const inner = res.headers;
  return {
    ok: res.ok,
    status: res.status,
    headers: {
      get: (name: string) => markers[name.toLowerCase()] ?? inner?.get(name) ?? null,
    },
    json: () => res.json(),
  };
}

/**
 * A lenient egress stand-in: stamps the relayed marker on whatever the inner
 * fetch answers, without checking signatures. For suites whose subject is
 * parsing/normalization/retry wiring, not signing.
 */
export function lenientEgressFetch(inner: FetchLike): FetchLike {
  return async (url, init) => withMarkers(await inner(url, init));
}

/** The signature scheme, computed the way the SERVICE verifies it. */
export async function egressSignature(key: string, path: string, timestampSeconds: number): Promise<string> {
  const message = `${String(timestampSeconds)}\n${path}`;
  const encoded = new TextEncoder().encode(message);
  const hmac = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", hmac, encoded);
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The strict stand-in: behaves like the real service — unsigned or
 * wrongly-signed requests are refused with the auth refusal, valid ones are
 * relayed — so a test can prove the catalog's outgoing request is signed the
 * way the service demands.
 */
export function strictEgressFetch(signingKey: string, inner: FetchLike): FetchLike {
  return async (url, init) => {
    const path = new URL(url).pathname;
    const timestamp = init?.headers?.["x-egress-timestamp"];
    const signature = init?.headers?.["x-egress-signature"];
    // Verified against the timestamp the request CARRIES, exactly as the
    // service does — the stub needs no clock of its own, and a test that
    // wants a deterministic timestamp injects `nowMs` on the source config.
    const expected = timestamp === undefined ? null : await egressSignature(signingKey, path, Number(timestamp));
    if (expected === null || expected !== signature) {
      return {
        ok: false,
        status: 401,
        headers: {
          get: (name: string) => (name === RESPONSE_MARKER ? "refused-here" : name === "x-egress-refusal" ? "auth" : null),
        },
        json: () => Promise.resolve({ refusedBy: "anitabi-egress", reason: "auth" }),
      };
    }
    return withMarkers(await inner(url, init));
  };
}

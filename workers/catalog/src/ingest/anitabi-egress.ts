/**
 * The anitabi egress service, from the caller's side (#1792): how the catalog
 * reaches `api.anitabi.cn` from the one address the upstream allowlisted. The
 * Workers egress pool was the reason anitabi began refusing the catalog, so
 * every anitabi fetch goes through the small signed egress service in
 * `apps/anitabi-egress` — never directly to the upstream, and never "best
 * effort": without the signing key the anitabi fetchers refuse.
 *
 * The service's address is a CONSTANT here, not a parameter. A configurable
 * base would be a destination parameter — the thing #1792 forbids everywhere
 * on this path — and buying the ability to move the service at run time costs
 * more than a redeploy does. The one variable the caller has is the signing
 * key, which is a secret and cannot live in the tree.
 *
 * The two operations are an enumeration, not strings: the egress path is built
 * here from the operation name and an already-validated bangumi id, so no
 * caller can name a path. The service builds the upstream URL from its own
 * capture of the API document; what crosses this boundary is the bangumi id
 * and nothing else.
 *
 * The adapter signs each request the way the service verifies it
 * (`${timestamp}\n${path}`, HMAC-SHA256, WebCrypto — the key never crosses the
 * wire into a log), then checks the service's response marker. The three
 * failure worlds stay distinguishable: a relayed answer carries
 * `x-egress-response: relayed-upstream` and flows into the upstream taxonomy;
 * a refusal carries `refused-here` plus a reason and becomes an
 * {@link EgressRefusedError} — OUR refusal, never retried in-request.
 */
import { EgressRefusedError, type EgressRefusalReason } from "./egress-refusal";
import type { FetchLike } from "./sources";

/** The egress service's address: committed, because the hostname is not a secret. */
export const ANITABI_EGRESS_BASE_URL = "https://animichi-anitabi-egress.fly.dev";

/** The two operations the service exposes. There is no third, and no way to express one. */
export type AnitabiOperation = "points" | "lite";

/** The egress path for an operation and an already-validated bangumi id. */
export function egressPathFor(operation: AnitabiOperation, bangumiId: string): string {
  return operation === "points" ? `/anitabi/points/${bangumiId}` : `/anitabi/lite/${bangumiId}`;
}

/** The environment slice the signing key resolves from. */
export interface EgressKeyEnv {
  INGEST_SIGNING_KEY?: string | { get(): Promise<string> };
}

/**
 * Resolve the signing key from the Worker env; undefined = not configured, and
 * the anitabi fetchers refuse. `INGEST_SIGNING_KEY` is a Cloudflare Secrets
 * Store binding in a deployed environment and a plain string locally; its value
 * is never in this tree.
 *
 * "Not configured" covers a value outside the documented form as well as an
 * absent one. A key `openssl rand -base64 48` could not have produced is one
 * the service refuses to start with, so resolving it here would buy nothing but
 * requests this side can sign and no side can verify.
 */
export async function egressSigningKeyFromEnv(env: EgressKeyEnv | undefined): Promise<string | undefined> {
  const key = env?.INGEST_SIGNING_KEY;
  if (key === undefined) return undefined;
  const value = typeof key === "string" ? key : await key.get();
  return isSigningKey(value) ? value : undefined;
}

/**
 * The signing key's one documented form, mirrored from the service
 * (`apps/anitabi-egress/src/egress-config.ts`): the runbook's generator,
 * `openssl rand -base64 48`, writes 48 bytes as exactly 64 base64 characters,
 * unpadded. Both sides hold the check deliberately — a form one side calls a
 * key and the other does not is a deployment that can only refuse, and a value
 * both sides accept while it is short enough to guess is a signature an
 * attacker can forge (CWE-326). It is a shape, not an entropy estimate: 64
 * base64 characters of `a` passes, and no string inspection can say otherwise.
 */
function isSigningKey(value: string): boolean {
  return /^[A-Za-z0-9+/]{64}$/.test(value);
}

/** Thrown when an anitabi fetch runs without its signing key — our misconfiguration, fail closed. */
export class EgressNotConfiguredError extends Error {
  constructor() {
    super(
      "the anitabi egress is not configured: set INGEST_SIGNING_KEY "
        + "(the service in apps/anitabi-egress is the only path to api.anitabi.cn)",
    );
    this.name = "EgressNotConfiguredError";
  }
}

/** The signing key an anitabi fetch requires, or the fail-closed refusal. */
export function requireEgressSigningKey(cfg: { egressSigningKey?: string }): string {
  if (cfg.egressSigningKey === undefined) throw new EgressNotConfiguredError();
  return cfg.egressSigningKey;
}

const RESPONSE_MARKER = "x-egress-response";
const RELAYED = "relayed-upstream";
const REFUSED = "refused-here";
const REFUSAL_REASON = "x-egress-refusal";

/**
 * Wrap a fetch so it signs egress requests and polices the response markers.
 * Everything this wrapper is given is an egress URL built by `egressPathFor`;
 * no input can retarget it.
 */
export function signedEgressFetch(
  signingKey: string,
  inner: FetchLike,
  nowMs: () => number = Date.now,
): FetchLike {
  return async (url, init) => {
    const signatureHeaders = await signedHeaders(signingKey, new URL(url).pathname, nowMs());
    const res = await inner(url, { ...init, headers: { ...init?.headers, ...signatureHeaders } });
    return assertMarked(res, url);
  };
}

/** The two signature headers over the request path, keyed HMAC-SHA256. */
async function signedHeaders(key: string, path: string, nowMs: number): Promise<Record<string, string>> {
  const timestampSeconds = Math.floor(nowMs / 1000);
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
  const signature = [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return { "x-egress-timestamp": String(timestampSeconds), "x-egress-signature": signature };
}

/** Accept only marked answers; a refusal becomes our typed error, an unmarked one is not-ours. */
function assertMarked(res: Awaited<ReturnType<FetchLike>>, url: string): Awaited<ReturnType<FetchLike>> {
  const marker = res.headers?.get(RESPONSE_MARKER) ?? null;
  if (marker === RELAYED) return res;
  if (marker === REFUSED) {
    const rawReason = res.headers?.get(REFUSAL_REASON) ?? "unmarked";
    throw new EgressRefusedError(knownReason(rawReason), url);
  }
  throw new EgressRefusedError("unmarked", url);
}

/** Trust the reason only when it is one the catalog knows; anything else reads as unmarked. */
function knownReason(raw: string): EgressRefusalReason {
  const reasons: readonly EgressRefusalReason[] = [
    "auth", "ceiling", "no-such-operation", "method-not-allowed", "configuration", "upstream-timeout",
  ];
  return (reasons as readonly string[]).includes(raw) ? (raw as EgressRefusalReason) : "unmarked";
}

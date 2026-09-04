/**
 * The four `X-BYOK-*` headers one request carries, read into a credential
 * (W2-3 #1289) — a semantic port of `parse_byok_credential` /
 * `has_byok_signal` in `apps/agent/src/animichi/agents/byok_models.py`.
 *
 * TWO OUTCOMES THAT ARE NOT THE SAME. `null` means the request carried no BYOK
 * signal at all and must run on the server's own model unchanged. A
 * `ByokRejection` means it carried one and it is unusable — and the caller is
 * told so rather than being quietly served on the server key, which is spec
 * §四 S5's "无 server-key fallback" red line said at the parser: a BYOK request
 * that cannot be honoured never becomes a non-BYOK request.
 *
 * AN ORPHANED `X-BYOK-Model` / `X-BYOK-Base-Url` IS A REJECTION, not a
 * `null` — verbatim from the Python docstring's reasoning: it is far more
 * likely that a caller forgot the other two headers than that they meant
 * nothing by these.
 *
 * THE BASE URL IS NOT VALIDATED HERE. It is handed to `EgressPolicy`, the
 * module W0-S5 measured every red line of (spec Appendix D), so private,
 * metadata, link-local, CGNAT, non-443, non-HTTPS, userinfo-bearing,
 * own-infrastructure and non-allowlisted destinations are refused by the SAME
 * decision the guarded fetch re-runs on every redirect hop. Python's separate
 * "must be https" string check is deliberately NOT ported: it would be a
 * second copy of one line of that policy, free to drift from it.
 *
 * ONE DELIBERATE NARROWING vs the Python tier, and it is the spec's own red
 * line rather than this card's idea: §四 S5's first condition is an ALLOWLIST
 * of provider hosts, and Appendix D says the production path reuses the module
 * that implements it. Python's `openai-compatible` family accepted any https
 * endpoint that passed its address-range checks; here the same family reaches
 * `api.openai.com` and nothing else, because `provider-allowlist.ts` enumerates
 * exact hosts. A caller pointing that family at a third-party gateway is
 * refused with `host_not_allowlisted` — a real behaviour difference between
 * the two positions of `AGENT_TURN_ROUTE`, and the one place the flag is not
 * byte-for-byte a fallback. Widening it is an edit to that allowlist, which is
 * where such a decision belongs.
 */
import { BYOK_EGRESS_POLICY, type EgressPolicy } from "../egress/egress-policy.ts";
import { ByokCredential, ByokRejection, type ByokCredentialParts } from "./byok-credential.ts";
import { BYOK_DIALECTS, byokFamilyOf, type ByokDialect, type ByokFamily } from "./byok-family.ts";

const PROVIDER_HEADER = "x-byok-provider";
const KEY_HEADER = "x-byok-key";
const MODEL_HEADER = "x-byok-model";
const BASE_URL_HEADER = "x-byok-base-url";

/** Every header this module reads, for the callers that must strip them. */
export const BYOK_HEADER_NAMES: readonly string[] = [
  PROVIDER_HEADER,
  KEY_HEADER,
  MODEL_HEADER,
  BASE_URL_HEADER,
];

/**
 * Whether the request carries any BYOK signal at all — presence only, no shape
 * validation. The login gate has to answer this BEFORE parsing, or a malformed
 * header from an anonymous caller would surface as `invalid_request` instead of
 * `byok_requires_login` (Python's P3 ordering).
 */
export function byokSignalIn(headers: Headers): boolean {
  return headers.get(PROVIDER_HEADER) !== null || headers.get(KEY_HEADER) !== null;
}

function trimmedHeader(headers: Headers, name: string): string {
  return headers.get(name)?.trim() ?? "";
}

/** No provider and no key: either a plain request, or an orphaned pair. */
function noSignalOutcome(headers: Headers): null {
  const orphaned = headers.get(MODEL_HEADER) !== null || headers.get(BASE_URL_HEADER) !== null;
  if (!orphaned) return null;
  throw new ByokRejection(
    "invalid_request",
    "X-BYOK-Model/X-BYOK-Base-Url require X-BYOK-Provider and X-BYOK-Key.",
  );
}

function requiredFamily(headers: Headers): ByokFamily {
  const family = byokFamilyOf(trimmedHeader(headers, PROVIDER_HEADER));
  if (family === null) {
    throw new ByokRejection("invalid_request", "Unknown or missing X-BYOK-Provider.");
  }
  return family;
}

/** A blank key is refused here, before any provider client could be built —
 * several SDKs read an ambient credential when handed a falsy one. */
function requiredSecret(headers: Headers): string {
  const secret = trimmedHeader(headers, KEY_HEADER);
  if (secret === "") throw new ByokRejection("invalid_request", "X-BYOK-Key is required.");
  return secret;
}

/** A family with a fixed endpoint may not be pointed anywhere by the caller. */
function fixedBaseUrl(supplied: string, fixed: string): string {
  if (supplied === "") return fixed;
  throw new ByokRejection(
    "invalid_request",
    "X-BYOK-Base-Url is only valid for the openai-compatible family.",
  );
}

function baseUrlOf(headers: Headers, dialect: ByokDialect): string {
  const supplied = trimmedHeader(headers, BASE_URL_HEADER);
  if (dialect.baseUrl !== null) return fixedBaseUrl(supplied, dialect.baseUrl);
  if (supplied !== "") return supplied;
  throw new ByokRejection(
    "invalid_request",
    "X-BYOK-Base-Url is required for the openai-compatible family.",
  );
}

function modelIdOf(headers: Headers, dialect: ByokDialect): string {
  const supplied = trimmedHeader(headers, MODEL_HEADER);
  if (supplied !== "") return supplied;
  if (dialect.defaultModel !== null) return dialect.defaultModel;
  throw new ByokRejection(
    "invalid_request",
    "X-BYOK-Model is required for the openai-compatible family.",
  );
}

/** The one egress verdict this module makes; the guarded fetch re-runs it. */
function allowedBy(policy: EgressPolicy, parts: ByokCredentialParts): ByokCredentialParts {
  const decision = policy.decide({
    provider: parts.provider,
    baseUrl: parts.baseUrl,
    key: parts.secret,
  });
  if (decision.allowed) return parts;
  throw new ByokRejection("egress_blocked", "base_url failed egress validation.", decision.reason);
}

function credentialParts(headers: Headers, family: ByokFamily): ByokCredentialParts {
  const dialect = BYOK_DIALECTS[family];
  return {
    family,
    provider: dialect.provider,
    baseUrl: baseUrlOf(headers, dialect),
    modelId: modelIdOf(headers, dialect),
    secret: requiredSecret(headers),
  };
}

/** The credential this request carries, or `null` when it carries none. */
export function byokCredentialIn(
  headers: Headers,
  policy: EgressPolicy = BYOK_EGRESS_POLICY,
): ByokCredential | null {
  if (!byokSignalIn(headers)) return noSignalOutcome(headers);
  const parts = credentialParts(headers, requiredFamily(headers));
  return new ByokCredential(allowedBy(policy, parts));
}

/**
 * The credential written back as the headers it was read from — for the ONE
 * in-process hop it makes: the intake's `POST /arm` on the session's own
 * Durable Object stub (`session-wakeup.ts`).
 *
 * Headers rather than a serialised object, so the far side re-runs THIS
 * parser and THIS egress policy on what it receives instead of trusting a
 * shape someone assembled. A family with a fixed endpoint emits no base-URL
 * header at all, because the parser refuses one — the two halves are each
 * other's inverse by construction.
 */
export function byokHeadersOf(credential: ByokCredential): Record<string, string> {
  const fixed = BYOK_DIALECTS[credential.family].baseUrl !== null;
  return {
    [PROVIDER_HEADER]: credential.family,
    [KEY_HEADER]: credential.secret,
    [MODEL_HEADER]: credential.modelId,
    ...(fixed ? {} : { [BASE_URL_HEADER]: credential.baseUrl }),
  };
}

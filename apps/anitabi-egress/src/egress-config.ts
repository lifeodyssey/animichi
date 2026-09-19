/**
 * The service's configuration, read once at boot — and failed closed
 * (#1792). A key outside its documented form, a ceiling that is not a whole
 * positive number the service can actually exhaust, or either one missing,
 * yields null, and the handler answers every request with a configuration
 * refusal; it never falls back to an unauthenticated or unbounded path.
 *
 * `INGEST_SIGNING_KEY` is set via `fly secrets` (its value is never in this
 * tree) and must be a key `openssl rand -base64 48` produced — the runbook's
 * one generator; `INGEST_SIGNING_KEY_PREVIOUS` is the optional rotation
 * widow-mate, held to the same form. The ceiling's canonical value lives in
 * fly.toml's `[env]`, beside the comment recording it as the agreement given
 * to the upstream.
 */

export interface EgressConfig {
  readonly currentKey: string;
  readonly previousKey: string | null;
  readonly ceilingPerHour: number;
}

/** Environment variable names, in one place for both the config and the docs. */
export const CURRENT_KEY_VAR = "INGEST_SIGNING_KEY";
export const PREVIOUS_KEY_VAR = "INGEST_SIGNING_KEY_PREVIOUS";
export const CEILING_VAR = "UPSTREAM_REQUEST_CEILING_PER_HOUR";

/**
 * Where the ceiling's counter lives (#1810). Both are `fly secrets` values of
 * the same kind as the signing key: the URL may carry the provider's tenant
 * identifier, the token opens the counter, and neither is in this tree.
 */
export const CEILING_STORE_URL_VAR = "CEILING_STORE_URL";
export const CEILING_STORE_TOKEN_VAR = "CEILING_STORE_TOKEN";

/** The whole configuration, or null when anything required is missing — null refuses everything. */
export function readEgressConfig(env: Record<string, string | undefined>): EgressConfig | null {
  const currentKey = env[CURRENT_KEY_VAR];
  const ceiling = parseCeiling(env[CEILING_VAR]);
  if (typeof currentKey !== "string" || !isSigningKey(currentKey) || ceiling === null) return null;
  const previousRaw = env[PREVIOUS_KEY_VAR];
  return {
    currentKey,
    previousKey: typeof previousRaw === "string" && isSigningKey(previousRaw) ? previousRaw : null,
    ceilingPerHour: ceiling,
  };
}

/**
 * The ceiling store's address and token, or null — and null means the service
 * has no counter, so its ceiling is null and every request is refused
 * (`configuration`). A ceiling the service cannot count is not a ceiling.
 */
export interface CeilingStoreConfig {
  readonly url: string;
  readonly token: string;
}

/**
 * Read the ceiling store's configuration (#1810). Both halves are required,
 * and both are checked for the failure a paste actually produces: a missing or
 * unreadable value, an http URL the token would cross in clear, a token that
 * arrived blank or still carrying the line break it was copied with.
 *
 * The store's token is the PROVIDER's value, not one this repository
 * generates, so it is not held to the signing key's 64-character generator
 * shape: that shape is a claim about `openssl rand -base64 48`, and this value
 * does not come from it. A wrong-but-present token is refused by the store
 * itself (401, which the ceiling turns into a refusal), so the check here is
 * the one that can be made and the rest fails closed anyway.
 */
export function readCeilingStoreConfig(env: Record<string, string | undefined>): CeilingStoreConfig | null {
  const url = httpsBase(env[CEILING_STORE_URL_VAR]);
  const token = env[CEILING_STORE_TOKEN_VAR];
  if (url === null || token === undefined || !isStoreToken(token)) return null;
  return { url, token };
}

/** The store's base URL with no trailing slash, https only: the token rides this connection. */
function httpsBase(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? `${url.origin}${url.pathname.replace(/\/+$/, "")}` : null;
  } catch {
    return null;
  }
}

/** A token is present and whole: not the blank placeholder, and not a paste that lost or gained a line. */
function isStoreToken(value: string): boolean {
  return value.length > 0 && !/\s/.test(value);
}

/**
 * The signing key's one documented form. `openssl rand -base64 48` — the
 * command the runbook tells the operator to run, and the command the docs
 * describe — writes 48 bytes as exactly 64 base64 characters, unpadded, so a
 * value the generator cannot have produced is not a key this service will
 * start on. That refuses a short key, a blank-looking one, a truncated paste,
 * a value still carrying its newline, and the placeholder prose the runbook
 * uses to talk ABOUT the variable — every one of which the service would
 * otherwise sign with while the caller held something else, or while an
 * attacker could guess it (CWE-326).
 *
 * It is a shape, not an entropy estimate, and this comment is the claim it
 * keeps: 64 base64 characters of `a` passes. Nothing readable from a string
 * can tell that value from a random one, so the guard checks the only thing it
 * can — that the value came from the documented generator's alphabet and
 * length — and the runbook says how to make a real one.
 *
 * The catalog caller (`workers/catalog`'s egress request module) holds the
 * mirrored check: a key one side calls a key and the other does not is a
 * configuration only one side can be signing with.
 */
export function isSigningKey(value: string): boolean {
  return /^[A-Za-z0-9+/]{64}$/.test(value);
}

/**
 * The largest ceiling the service will run with: one request per second of its
 * own window. A ceiling past it is not a generous limit, it is the absence of
 * one, and the arithmetic that enforces it (`used >= limit` against an hour of
 * seconds) stops meaning anything — so it fails closed at boot like every other
 * unusable value rather than starting up ungated. It is derived from the
 * window, not a second opinion about the agreed number: an agreement larger
 * than this needs the window's arithmetic reconsidered first.
 */
const MAX_CEILING_PER_HOUR = 60 * 60;

/** A ceiling is a positive decimal integer — the promise's unit is requests, whole. */
function parseCeiling(raw: string | undefined): number | null {
  if (raw === undefined || !/^[1-9]\d*$/.test(raw)) return null;
  const ceiling = Number(raw);
  if (!Number.isSafeInteger(ceiling)) return null;
  return ceiling <= MAX_CEILING_PER_HOUR ? ceiling : null;
}

/** The listen port; PORT is convenience, not security, so a garbage value keeps the default. */
export function readListenPort(env: Record<string, string | undefined>): number {
  const raw = env.PORT;
  if (raw === undefined || !/^\d{1,5}$/.test(raw)) return 8080;
  const port = Number(raw);
  return port >= 1 && port <= 65535 ? port : 8080;
}

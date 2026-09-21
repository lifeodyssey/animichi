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
 * Where the ceiling's counter lives (#1810, #1824). One `fly secrets` value of
 * the same kind as the signing key — the Fly Redis Private URL `fly redis
 * status` prints, which carries the store's own password inside the address —
 * and it is not in this tree.
 */
export const CEILING_STORE_URL_VAR = "CEILING_STORE_URL";

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
 * The ceiling store's address, or null — and null means the service has no
 * counter, so its ceiling is null and every request is refused
 * (`configuration`). A ceiling the service cannot count is not a ceiling.
 */
export interface CeilingStoreConfig {
  readonly url: string;
}

/**
 * Read the ceiling store's address (#1810, #1824). The store is the Redis
 * `fly redis create` provisions, reached over TCP, and the address is the
 * Private URL that command's status prints — so `redis` is the only scheme
 * this service will dial.
 *
 * THE SCHEME IS THE CHECK. #1810's store was an HTTPS REST endpoint addressed
 * by a separate token; that pair cannot be filled from `fly redis status`, and
 * its `https://` address must fail closed at boot rather than be read as a
 * Redis host — a service that dialed it would be reaching a destination that
 * is not its store. Every other scheme, the public `rediss://` endpoint
 * included, is a destination this service was not told to use: the counter is
 * reached over Fly's private network, and a value naming anything else is a
 * paste of the wrong URL.
 *
 * A missing value, a value with no host to dial, and a value still carrying
 * the line break it was copied with are all null as well. The password inside
 * the address is the store's own; a URL that carries none is accepted here and
 * refused by the store, which is the one authority on whether it will open.
 */
export function readCeilingStoreConfig(env: Record<string, string | undefined>): CeilingStoreConfig | null {
  const url = redisUrl(env[CEILING_STORE_URL_VAR]);
  return url === null ? null : { url };
}

/** The Fly Private URL, or null: `redis://`, a host, and no whitespace from a bad paste. */
function redisUrl(raw: string | undefined): string | null {
  if (raw === undefined || raw === "" || /\s/.test(raw)) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "redis:" && url.hostname !== "" ? raw : null;
  } catch {
    return null;
  }
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

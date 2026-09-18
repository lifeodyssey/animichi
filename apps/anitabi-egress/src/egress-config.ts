/**
 * The service's configuration, read once at boot — and failed closed
 * (#1792). A missing key, or a ceiling that is not a whole positive number the
 * service can actually exhaust, yields null, and the handler answers every
 * request with a configuration refusal; it never falls back to an
 * unauthenticated or unbounded path.
 *
 * `INGEST_SIGNING_KEY` is set via `fly secrets` (its value is never in this
 * tree); `INGEST_SIGNING_KEY_PREVIOUS` is the optional rotation widow-mate.
 * The ceiling's canonical value lives in fly.toml's `[env]`, beside the
 * comment recording it as the agreement given to the upstream.
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

/** The whole configuration, or null when anything required is missing — null refuses everything. */
export function readEgressConfig(env: Record<string, string | undefined>): EgressConfig | null {
  const currentKey = env[CURRENT_KEY_VAR];
  const ceiling = parseCeiling(env[CEILING_VAR]);
  if (typeof currentKey !== "string" || currentKey.length === 0 || ceiling === null) return null;
  const previousRaw = env[PREVIOUS_KEY_VAR];
  return {
    currentKey,
    previousKey: typeof previousRaw === "string" && previousRaw.length > 0 ? previousRaw : null,
    ceilingPerHour: ceiling,
  };
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

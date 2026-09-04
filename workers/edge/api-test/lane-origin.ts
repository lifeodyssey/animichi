/**
 * The deployment a staging lane talks to, and the credential it presents.
 *
 * One door, deliberately. Every file in this directory sends a real request to
 * a real origin, and two of them send a real Neon Auth access token with it, so
 * the checks that decide WHERE that goes cannot live in each lane: three copies
 * are three places for one of them to be forgotten, and the copy that was
 * forgotten is the one an operator finds by leaking a token.
 *
 * Two refusals, both fail-closed:
 *   - an unset variable is never guessed. A lane with no origin has nothing to
 *     assert about, and a lane that invented `localhost` would pass vacuously.
 *   - a non-HTTPS origin is refused before anything is sent (CWE-319). The very
 *     next thing that happens is a bearer token going over that wire, and an
 *     operator who exported `CATALOG_API_ORIGIN=http://…` for a local
 *     experiment would otherwise put a staging credential on it in plaintext.
 *     The refusal is here rather than at the call sites for the same reason the
 *     module exists: `catalog-api.test.ts` carries no token today, but it is one
 *     edit away from carrying one.
 *
 * Not a `*.test.ts` file, so `pnpm run test:catalog-api`'s glob does not run it
 * as a suite; it is imported by the lanes that do.
 */
import assert from "node:assert/strict";

const ORIGIN = process.env.CATALOG_API_ORIGIN;
const BEARER = process.env.AGENT_TURN_BEARER;

/** The staging origin, without its trailing slash, or a failed assertion. */
export function laneOrigin(): string {
  assert.ok(ORIGIN, "set CATALOG_API_ORIGIN (see api-test/README.md); this lane never guesses");
  assert.equal(
    new URL(ORIGIN).protocol,
    "https:",
    "CATALOG_API_ORIGIN must be https — these lanes send a real bearer token",
  );
  return ORIGIN.replace(/\/$/, "");
}

/** The Neon Auth access token a signed-in lane presents, or a failed assertion. */
export function laneBearer(): string {
  assert.ok(BEARER, "set AGENT_TURN_BEARER to a Neon Auth access token (see api-test/README.md)");
  return BEARER;
}

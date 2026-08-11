/** Neon Auth staging declarations — pure derivation, no stack build.
 *
 * A separate file from the topology-*.test.ts files because this one never
 * imports `index.ts`: it pins the JWKS/issuer derivation functions and the
 * env-var names the edge and the QA login depend on, without constructing a
 * Pulumi stack. Runs under `node --test topology-*.test.ts` (the infra package
 * test lane) with zero network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QA_NEON_USER_EMAIL_VAR,
  QA_NEON_USER_PASSWORD_VAR,
  NEON_AUTH_JWKS_VAR,
  issuerFromJwksUrl,
  jwksUrlFromAuthBaseUrl,
} from "./src/neon-auth.ts";

const BRANCH_BASE = "https://branch.neonauth.c-2.ap-southeast-1.aws.neon.tech/neondb/auth";

test("jwksUrlFromAuthBaseUrl appends the well-known JWKS path", () => {
  assert.equal(
    jwksUrlFromAuthBaseUrl(BRANCH_BASE),
    `${BRANCH_BASE}/.well-known/jwks.json`,
  );
});

test("jwksUrlFromAuthBaseUrl tolerates a trailing slash", () => {
  assert.equal(
    jwksUrlFromAuthBaseUrl(`${BRANCH_BASE}/`),
    `${BRANCH_BASE}/.well-known/jwks.json`,
  );
});

test("issuerFromJwksUrl round-trips a derived JWKS URL back to the base URL", () => {
  assert.equal(issuerFromJwksUrl(jwksUrlFromAuthBaseUrl(BRANCH_BASE)), BRANCH_BASE);
});

test("issuerFromJwksUrl returns a non-JWKS input untouched", () => {
  assert.equal(issuerFromJwksUrl(BRANCH_BASE), BRANCH_BASE);
});

test("env var names match the edge worker binding and the QA login contract", () => {
  assert.equal(NEON_AUTH_JWKS_VAR, "NEON_AUTH_JWKS_URL");
  assert.equal(QA_NEON_USER_EMAIL_VAR, "QA_NEON_USER_EMAIL");
  assert.equal(QA_NEON_USER_PASSWORD_VAR, "QA_NEON_USER_PASSWORD");
});

test("issuer derivation matches the edge copy", () => {
  const url = "https://branch.neonauth.region.neon.tech/neondb/auth/.well-known/jwks.json";
  const fromInfra = issuerFromJwksUrl(url);
  // The edge's derivation is identical by contract (workers/edge/src/identity/auth.ts);
  // import it here would couple infra to the worker package, so assert the
  // invariant structurally instead: strip the suffix, never mutate the rest.
  assert.equal(fromInfra, "https://branch.neonauth.region.neon.tech/neondb/auth");
  assert.equal(fromInfra.endsWith("/.well-known/jwks.json"), false);
});

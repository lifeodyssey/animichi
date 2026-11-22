/** Neon Auth staging declarations: the env-var names, no stack build.
 *
 * A separate file from the topology-*.test.ts files that import `index.ts`:
 * it pins the names the edge and the QA login depend on without constructing a
 * Pulumi stack. The JWKS address and issuer derivations in `src/neon-auth.ts`
 * are pinned by `packages/contract/test/neon-auth.test.ts`, the issuer beside
 * the contract module it copies; `pnpm test` runs that file as
 * `test:neon-auth-parity`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QA_NEON_USER_EMAIL_VAR,
  QA_NEON_USER_PASSWORD_VAR,
  NEON_AUTH_JWKS_VAR,
} from "./src/neon-auth.ts";

test("env var names match the edge worker binding and the QA login contract", () => {
  assert.equal(NEON_AUTH_JWKS_VAR, "NEON_AUTH_JWKS_URL");
  assert.equal(QA_NEON_USER_EMAIL_VAR, "QA_NEON_USER_EMAIL");
  assert.equal(QA_NEON_USER_PASSWORD_VAR, "QA_NEON_USER_PASSWORD");
});

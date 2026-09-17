import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createMigratorApp, type MigratorDeps } from "../src/create-app";
import { joseEnv, testEnv } from "./migrate.worker.helpers";
import { GITHUB_OIDC_ISSUER } from "@animichi/contract/oidc-github";
import { MIGRATOR_OIDC_AUDIENCE, TRUSTED_CD_WORKFLOW } from "../src/policy";
import { MIGRATIONS, requestMetadata } from "./sealed-migrations";

export { COMPATIBLE_PREVIEW, recordingExecutor } from "./selected-executor-double";

export const metadata = requestMetadata;

export function preflightRequest(body: unknown, token: string): Request {
  return new Request("https://migrator.test/preflight", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** An app that carries the repository's sealed graph, reached by a correctly signed caller. */
export async function signedApp(claims: Record<string, unknown> = {}, overrides: Partial<MigratorDeps> = {}) {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...await exportJWK(publicKey), kid: "preflight-test" };
  const token = await new SignJWT({ repository: "lifeodyssey/animichi", ref: "refs/heads/main",
    environment: "staging", sub: "repo:lifeodyssey/animichi:environment:staging",
    workflow_ref: TRUSTED_CD_WORKFLOW, iss: GITHUB_OIDC_ISSUER, aud: MIGRATOR_OIDC_AUDIENCE,
    exp: Math.floor(Date.now() / 1000) + 300, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "preflight-test" }).sign(privateKey);
  return { token, app: createMigratorApp({ jwks: joseEnv(jwk), migrationsDir: MIGRATIONS, ...overrides }), env: testEnv() };
}

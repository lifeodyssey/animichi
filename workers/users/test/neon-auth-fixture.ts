import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWK,
  type JWTVerifyGetKey,
} from "jose";
import type { Env } from "../src/index";

/** Test Neon Auth issuer/audience. */
export const BASE = "https://auth.test.invalid/neondb/auth";
/** Test Neon Auth JWKS endpoint. */
export const JWKS_URL = `${BASE}/.well-known/jwks.json`;
/** Complete configured Worker environment for tests. */
export const TEST_ENV: Env = {
  ENVIRONMENT: "test",
  NEON_AUTH_JWKS_URL: JWKS_URL,
  DATABASE_URL: "postgresql://fake",
};

interface JwtOptions { sub: string; iss?: string; aud?: string; exp?: number }
/** Shared JWT tools initialized once per worker isolate. */
export interface AuthTools {
  getKey: JWTVerifyGetKey;
  makeJwt: (options: JwtOptions) => Promise<string>;
}

let authToolsPromise: Promise<AuthTools> | undefined;

async function createAuthTools(): Promise<AuthTools> {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", { extractable: true });
  const jwk = await exportedTestKey(publicKey);
  const getKey = createLocalJWKSet({ keys: [jwk] });
  const makeJwt = makeJwtFactory(privateKey);
  return { getKey, makeJwt };
}

async function exportedTestKey(publicKey: Parameters<typeof exportJWK>[0]): Promise<JWK> {
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  return jwk;
}

function makeJwtFactory(privateKey: Parameters<typeof exportJWK>[0]): (options: JwtOptions) => Promise<string> {
  return (options: JwtOptions): Promise<string> => new SignJWT({})
    .setProtectedHeader({ alg: "EdDSA", kid: "test-key" })
    .setSubject(options.sub)
    .setIssuer(options.iss ?? BASE)
    .setAudience(options.aud ?? BASE)
    .setExpirationTime(options.exp ?? Math.floor(Date.now() / 1000) + 900)
    .sign(privateKey);
}

/** Return the isolate's one-time Ed25519 test fixture. */
export function authTools(): Promise<AuthTools> {
  authToolsPromise ??= createAuthTools();
  return authToolsPromise;
}

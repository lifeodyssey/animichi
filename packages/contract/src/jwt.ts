import { jwtVerify, type JWTClaimVerificationOptions, type JWTPayload, type JWTVerifyGetKey } from "jose";

export interface EdDsaJwtVerification {
  readonly audience: string;
  readonly issuer: string;
  readonly key: JWTVerifyGetKey;
  readonly token: string;
}

/**
 * The Neon Auth access token always carries `exp` and `sub`
 * (https://neon.com/docs/auth/guides/plugins/jwt); jose checks `exp` only when
 * present, so both are required. No `maxTokenAge`: Neon fixes the lifetime and
 * `exp` already ends it, so an age bound would only refuse every login if Neon
 * lengthened the lifetime.
 */
const NEON_AUTH_TOKEN_CLAIMS = {
  requiredClaims: ["exp", "sub"],
} satisfies JWTClaimVerificationOptions;

/**
 * Verify a Neon Auth access token: the EdDSA envelope, issuer, audience and the
 * token's own claims. Callers own the trust policy built on the payload.
 */
export async function verifyEdDsaJwt(options: EdDsaJwtVerification): Promise<JWTPayload> {
  const { payload } = await jwtVerify(options.token, options.key, {
    algorithms: ["EdDSA"], audience: options.audience, issuer: options.issuer, ...NEON_AUTH_TOKEN_CLAIMS,
  });
  return payload;
}

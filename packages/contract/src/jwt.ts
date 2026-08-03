import { jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

export interface EdDsaJwtVerification {
  readonly audience: string;
  readonly issuer: string;
  readonly key: JWTVerifyGetKey;
  readonly token: string;
}

/** Verify the shared EdDSA cryptographic envelope; callers own trust policy. */
export async function verifyEdDsaJwt(options: EdDsaJwtVerification): Promise<JWTPayload> {
  const { payload } = await jwtVerify(options.token, options.key, {
    algorithms: ["EdDSA"], audience: options.audience, issuer: options.issuer,
  });
  return payload;
}

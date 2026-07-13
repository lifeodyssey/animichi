import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";

const JWKS_SUFFIX = "/.well-known/jwks.json";
const remoteKeys = new Map<string, JWTVerifyGetKey>();

/** Derive the Neon Auth issuer/audience base URL from its JWKS URL. */
export function issuerFromJwksUrl(jwksUrl: string): string {
  return jwksUrl.endsWith(JWKS_SUFFIX) ? jwksUrl.slice(0, -JWKS_SUFFIX.length) : jwksUrl;
}

function cachedRemote(url: string): JWTVerifyGetKey {
  const cached = remoteKeys.get(url);
  if (cached) return cached;
  const key = createRemoteJWKSet(new URL(url));
  remoteKeys.set(url, key);
  return key;
}

function bearerToken(authorization: string | null): string | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  return token.length > 0 ? token : null;
}

/** Verify an EdDSA Neon Auth bearer and return its non-empty subject. */
export async function verifyBearer(
  authorization: string | null,
  jwksUrl: string,
  getKey?: JWTVerifyGetKey,
): Promise<{ userId: string } | null> {
  const token = bearerToken(authorization);
  if (!token) return null;
  try {
    const base = issuerFromJwksUrl(jwksUrl);
    const { payload } = await jwtVerify(token, getKey ?? cachedRemote(jwksUrl), {
      algorithms: ["EdDSA"], issuer: base, audience: base,
    });
    return typeof payload.sub === "string" && payload.sub.length > 0
      ? { userId: payload.sub }
      : null;
  } catch {
    return null;
  }
}

import { createAuthClient } from "better-auth/client";
import { jwtClient, magicLinkClient } from "better-auth/client/plugins";

/**
 * Neon Auth (Better Auth base) magic-link client.
 *
 * Uses the official Better Auth client SDK (`createAuthClient` + the
 * `magicLinkClient` plugin) pointed at the per-branch Neon Auth base URL
 * (`…/neondb/auth`, see `docs/ops/auth-migration-neon.md` §4). The base URL is
 * operator-supplied via `VITE_NEON_AUTH_BASE_URL`; when absent the caller
 * surfaces a "not configured" state rather than a fabricated success. The
 * client is built lazily at call time so tests and SSR resolve the env freshly.
 */
export type MagicLinkResult = "sent" | "not_configured" | "error";

export interface MagicLinkRequest {
  email: string;
  callbackURL: string;
}

function baseUrl(): string | undefined {
  const value = import.meta.env.VITE_NEON_AUTH_BASE_URL;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function isNeonAuthConfigured(): boolean {
  return baseUrl() !== undefined;
}

function neonAuthClient(baseURL: string) {
  return createAuthClient({
    baseURL,
    fetchOptions: { credentials: "include" },
    plugins: [magicLinkClient(), jwtClient()],
  });
}

export async function sendMagicLink(request: MagicLinkRequest): Promise<MagicLinkResult> {
  const base = baseUrl();
  if (!base) return "not_configured";
  try {
    const { error } = await neonAuthClient(base).signIn.magicLink(request);
    return error ? "error" : "sent";
  } catch {
    return "error";
  }
}

/**
 * Exchanges the Better Auth session cookie (set by the magic-link callback
 * on the Neon Auth origin) for an EdDSA JWT via Better Auth's `jwtClient`.
 * The edge worker (`worker/auth.ts`) verifies this token against the same JWKS.
 */
export async function fetchAuthToken(): Promise<string | undefined> {
  const base = baseUrl();
  if (!base) return undefined;
  try {
    const { data, error } = await neonAuthClient(base).token();
    // No null-guard on `data`: better-auth types the success branch as
    // non-nullable with a required `token`, and type-aware oxlint rejects the
    // check as provably dead (`no-unnecessary-condition`). A review bot asked
    // for one; the type system says the shape it fears cannot occur here.
    return error ? undefined : data.token;
  } catch {
    return undefined;
  }
}

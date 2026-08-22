import { createAuthClient } from "@neondatabase/auth";
import { BetterAuthVanillaAdapter } from "@neondatabase/auth/vanilla";
import { currentRuntimeConfig } from "../runtime-config/provider";

/**
 * Neon Auth client via the official `@neondatabase/auth` SDK.
 *
 * The SDK forwards `neon_auth_session_verifier` from the callback URL onto
 * `/get-session` and `/token`. Base URL is `neonAuthBaseUrl` (#1013 AC1);
 * absent means "not configured". Auth failures surface `error.message` as-is.
 */
export type MagicLinkResult = "sent" | "not_configured" | { readonly error: string };

export interface MagicLinkRequest {
  email: string;
  callbackURL: string;
}

export type AuthTokenResult =
  | { readonly token: string }
  | { readonly error: { readonly message: string } };

function baseUrl(): string | undefined {
  // The runtime-config loader guarantees the field is undefined-or-valid-URL,
  // so an absent field is the documented "auth not configured" shape.
  return currentRuntimeConfig().neonAuthBaseUrl;
}

export function isNeonAuthConfigured(): boolean {
  return baseUrl() !== undefined;
}

const CREDENTIALS: { fetchOptions: { credentials: RequestCredentials } } = {
  fetchOptions: { credentials: "include" },
};

export function neonAuthClient(baseURL: string) {
  return createAuthClient(baseURL, { adapter: BetterAuthVanillaAdapter(CREDENTIALS) });
}

/** Better Auth / SDK envelopes expose `message`; that string is what we show. */
export function authErrorMessage(error: unknown): string {
  if (typeof error !== "object" || error === null || !("message" in error)) return "";
  return typeof error.message === "string" ? error.message : "";
}

export async function sendMagicLink(request: MagicLinkRequest): Promise<MagicLinkResult> {
  const base = baseUrl();
  if (!base) return "not_configured";
  try {
    return await requestMagicLink(base, request);
  } catch (error) {
    return { error: authErrorMessage(error) };
  }
}

async function requestMagicLink(base: string, request: MagicLinkRequest): Promise<MagicLinkResult> {
  const { error } = await neonAuthClient(base).signIn.magicLink(request);
  return error ? { error: authErrorMessage(error) } : "sent";
}

/**
 * Exchanges the Neon Auth session (cookie and/or `neon_auth_session_verifier`)
 * for an EdDSA JWT. Failures keep the SDK's `error.message`.
 */
export async function redeemAuthToken(): Promise<AuthTokenResult> {
  const base = baseUrl();
  if (!base) return { error: { message: "" } };
  try {
    return await requestToken(base);
  } catch (error) {
    return { error: { message: authErrorMessage(error) } };
  }
}

async function requestToken(base: string): Promise<AuthTokenResult> {
  const { data, error } = await neonAuthClient(base).token();
  if (error) return { error: { message: authErrorMessage(error) } };
  return { token: data.token };
}

/** Anonymous-safe: no session or a failed redeem is `undefined`, never a throw. */
export async function fetchAuthToken(): Promise<string | undefined> {
  const result = await redeemAuthToken();
  return "token" in result ? result.token : undefined;
}

import "@tanstack/react-start/client-only";
import { createAuthClient } from "@neondatabase/auth";
import { BetterAuthVanillaAdapter } from "@neondatabase/auth/vanilla";
import { currentRuntimeConfig } from "../runtime-config/provider";
import { authErrorMessage } from "./auth-error";
import type { AuthTokenResult, MagicLinkRequest, MagicLinkResult } from "./neon-auth";

/**
 * The browser binding of `AuthSessionSource`: one official `@neondatabase/auth`
 * client for the whole app.
 *
 * The SDK forwards `neon_auth_session_verifier` onto `/get-session` and injects
 * the EdDSA JWT from `set-auth-jwt` into `session.token`. Login, callback,
 * auth-gate, and API headers all reach it through `./neon-auth`.
 *
 * **Never import this module statically.** Its module graph runs browser-only
 * side effects at evaluation time — `@neondatabase/auth` mints a BroadcastChannel
 * tab id with `crypto.randomUUID()` at module scope — and workerd evaluates every
 * module top level outside an I/O context, so merely reaching this file from the
 * server graph makes the Worker answer 500 to every request. `./neon-auth` loads
 * it with a dynamic import that is dead code in the SSR build; the sourcemap
 * assertion in `tests/integration/build-output.test.ts` holds that line.
 */
const CREDENTIALS: { fetchOptions: { credentials: RequestCredentials } } = {
  fetchOptions: { credentials: "include" },
};

function makeClient(baseURL: string) {
  return createAuthClient(baseURL, { adapter: BetterAuthVanillaAdapter(CREDENTIALS) });
}

type AuthClient = ReturnType<typeof makeClient>;

let singleton: { readonly base: string; readonly client: AuthClient } | undefined;

function baseUrl(): string | undefined {
  return currentRuntimeConfig().neonAuthBaseUrl;
}

export function neonAuthClient(baseURL: string): AuthClient {
  if (singleton?.base === baseURL) return singleton.client;
  const client = makeClient(baseURL);
  singleton = { base: baseURL, client };
  return client;
}

/** Test seam: each case must not inherit the previous client's SDK cache. */
export function resetNeonAuthClient(): void {
  singleton = undefined;
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

export async function redeemAuthToken(): Promise<AuthTokenResult> {
  const base = baseUrl();
  if (!base) return { error: { message: "" } };
  try {
    return await requestJwt(base);
  } catch (error) {
    return { error: { message: authErrorMessage(error) } };
  }
}

async function requestJwt(base: string): Promise<AuthTokenResult> {
  const { data, error } = await neonAuthClient(base).getSession();
  if (error) return { error: { message: authErrorMessage(error) } };
  return jwtFromSession(data);
}

function jwtFromSession(data: unknown): AuthTokenResult {
  const token = sessionToken(data);
  if (typeof token === "string" && token.split(".").length === 3) return { token };
  return { error: { message: "" } };
}

function sessionToken(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null || !("session" in data)) return undefined;
  return tokenField(data.session);
}

function tokenField(session: unknown): string | undefined {
  if (typeof session !== "object" || session === null || !("token" in session)) return undefined;
  return typeof session.token === "string" ? session.token : undefined;
}

export async function fetchAuthToken(): Promise<string | undefined> {
  const result = await redeemAuthToken();
  return "token" in result ? result.token : undefined;
}

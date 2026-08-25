import { currentRuntimeConfig } from "../runtime-config/provider";
import { signedOutSession } from "./signed-out-session";

export { authErrorMessage } from "./auth-error";

/**
 * The app's Neon Auth port, bound to a different source per environment.
 *
 * Auth is a browser concern here: every consumer is a React hook or an event
 * handler, and a Worker has no cookie jar to read a session from. The browser
 * binds to `./neon-auth-client` (the official SDK); SSR binds to
 * `./signed-out-session`. The split is not stylistic — `@neondatabase/auth`
 * mints a BroadcastChannel tab id with `crypto.randomUUID()` at module scope,
 * and workerd evaluates every module top level outside an I/O context, so the
 * SDK reaching the server graph at all makes the Worker answer 500 to every
 * request, static assets included.
 */
export type MagicLinkResult = "sent" | "not_configured" | { readonly error: string };

export interface MagicLinkRequest {
  email: string;
  callbackURL: string;
}

export type AuthTokenResult =
  | { readonly token: string }
  | { readonly error: { readonly message: string } };

/** What this app needs from Neon Auth, in the shape both bindings implement. */
export interface AuthSessionSource {
  sendMagicLink(request: MagicLinkRequest): Promise<MagicLinkResult>;
  redeemAuthToken(): Promise<AuthTokenResult>;
  fetchAuthToken(): Promise<string | undefined>;
}

export function isNeonAuthConfigured(): boolean {
  return currentRuntimeConfig().neonAuthBaseUrl !== undefined;
}

let source: Promise<AuthSessionSource> | undefined;

/**
 * `import.meta.env.SSR` is a build-time constant, so the SSR build folds this to
 * the signed-out branch and Rollup drops the `./neon-auth-client` import as dead
 * code — the SDK is absent from the server graph rather than merely unreached.
 */
function loadSource(): Promise<AuthSessionSource> {
  if (import.meta.env.SSR) return Promise.resolve(signedOutSession);
  return import("./neon-auth-client");
}

export function authSessionSource(): Promise<AuthSessionSource> {
  source ??= loadSource();
  return source;
}

/** Test seam: each case must not inherit the previous case's bound source. */
export function resetAuthSessionSource(): void {
  source = undefined;
}

export async function sendMagicLink(request: MagicLinkRequest): Promise<MagicLinkResult> {
  return (await authSessionSource()).sendMagicLink(request);
}

export async function redeemAuthToken(): Promise<AuthTokenResult> {
  return (await authSessionSource()).redeemAuthToken();
}

export async function fetchAuthToken(): Promise<string | undefined> {
  return (await authSessionSource()).fetchAuthToken();
}

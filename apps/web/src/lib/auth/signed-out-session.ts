import type { AuthSessionSource } from "./neon-auth";

/**
 * The SSR binding of `AuthSessionSource`: a Worker rendering a page has no
 * session to read.
 *
 * This is not a stub standing in for behaviour we gave up on. A Worker has no
 * browser cookie jar, so the SDK's `credentials: "include"` sent nothing and
 * `getSession()` answered "signed out" on the server even while it was still on
 * the server graph. Every consumer of a session in this app is a hook or an
 * event handler, so the server renders the signed-out view and the client
 * corrects it on hydration — exactly what it already did.
 */
export const signedOutSession: AuthSessionSource = {
  sendMagicLink: () => Promise.resolve("not_configured"),
  redeemAuthToken: () => Promise.resolve({ error: { message: "" } }),
  fetchAuthToken: () => Promise.resolve(undefined),
};

import { createMiddleware } from "@tanstack/react-start";
import { currentRuntimeConfig } from "../lib/runtime-config/provider";
import {
  CSP_NONCE_CONTEXT_KEY,
  contentSecurityPolicy,
  deploymentConnectOrigins,
  mintNonce,
} from "./csp-policy";

/**
 * Mints this response's nonce, hands it to the render through the start
 * context, and puts the policy on the response on the way back out — one value
 * on both sides, so the header and the render cannot disagree (issue #469).
 *
 * It is a global request middleware rather than a `setResponseHeader` call
 * because h3 v2 merges an event's prepared headers into a returned Response
 * only when that response is `ok`
 * (`prepareResponse`: `if (!preparedHeaders || nested || !val.ok) return val`).
 * The branded 404 is a rendered document like any other and it was shipping
 * with no policy at all. A middleware holds the final `Response` object and
 * sets the header on it directly, which every status code reaches.
 *
 * Registered in `src/start.ts`; that entry must keep the CSRF middleware
 * alongside this one, or server functions lose their cross-site protection.
 */
export const cspMiddleware = createMiddleware({ type: "request" }).server(async ({ next }) => {
  const nonce = mintNonce();
  const result = await next({ context: { [CSP_NONCE_CONTEXT_KEY]: nonce } });
  result.response.headers.set("Content-Security-Policy", contentSecurityPolicy(nonce, configuredOrigins()));
  return result;
});

/**
 * Connect origins only the deployment knows: the Neon Auth origin the browser
 * SDK dials (#1013 carries it in the runtime config), as an origin — the SDK's
 * paths are its own business. An unreadable binding yields no extra origin
 * rather than no policy; an invalid `RUNTIME_CONFIG` fails the request in the
 * runtime-config plugin, which is where that error belongs.
 */
function configuredOrigins(): readonly string[] {
  try {
    return deploymentConnectOrigins(currentRuntimeConfig().neonAuthBaseUrl);
  } catch {
    return [];
  }
}

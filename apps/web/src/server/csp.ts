import { getGlobalStartContext } from "@tanstack/react-start";
import { CSP_NONCE_CONTEXT_KEY } from "./csp-policy";

/**
 * `getGlobalStartContext` is a `createIsomorphicFn`, which types the callable
 * off the branch registered first (`.client(() => undefined)`) — so its server
 * branch, the one that actually runs here, is erased from the type. This
 * restates the real contract: the context middleware passed down.
 */
const readStartContext = getGlobalStartContext as unknown as () => Record<string, unknown> | undefined;

/**
 * The nonce `cspMiddleware` minted for this response (issue #469), for the
 * router to stamp on every inline script the document emits.
 *
 * `getGlobalStartContext()` is the framework's own per-request store and the
 * documented way to read what a global request middleware passed down:
 * `cspMiddleware` hands the nonce over with `next({ context })`, and every call
 * site here — the router factory and the root document — runs inside it. The
 * framework reads `router.options.ssr.nonce` from the same value to stamp its
 * own hydration and streaming scripts, and republishes it to the browser as
 * `<meta property="csp-nonce">` so client navigation keeps using it.
 *
 * Off the server this is a no-op returning undefined, and so is a call with no
 * start context around it: the unit pool builds routers with no request behind
 * them, where a missing nonce means "no policy in play" rather than an error.
 */
export function currentCspNonce(): string | undefined {
  try {
    const nonce = readStartContext()?.[CSP_NONCE_CONTEXT_KEY];
    return typeof nonce === "string" && nonce.length > 0 ? nonce : undefined;
  } catch {
    return undefined;
  }
}

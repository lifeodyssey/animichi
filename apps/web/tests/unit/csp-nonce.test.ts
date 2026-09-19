import { describe, expect, it } from "vitest";
import { currentCspNonce } from "../../src/server/csp";
import { CSP_NONCE_CONTEXT_KEY } from "../../src/server/csp-policy";

/**
 * The render's half of the agreement #469 rests on: the nonce the middleware
 * handed down through the start context is the one the router stamps on every
 * inline script. `csp-policy.test.ts` covers the other half — that the header
 * advertises that same value.
 *
 * `currentCspNonce` reads the framework's store through
 * `getGlobalStartContext`. `runWithStartContext` is not re-exported from any
 * public entry point, so these cases enter the store the way the framework
 * publishes it: an AsyncLocalStorage on `globalThis` under a registered symbol
 * (`@tanstack/start-storage-context`). That is the same object the framework
 * reads, so this exercises the real lookup rather than a double.
 */

/**
 * `getGlobalStartContext` resolves to the start context's
 * `contextAfterGlobalMiddlewares` — the record the framework hands the router
 * handler once the global request middleware chain has run — so that is where
 * the nonce sits inside the store.
 */
function afterMiddlewares(context: Record<string, unknown>): Record<string, unknown> {
  return { contextAfterGlobalMiddlewares: context };
}

function withinStartContext<T>(context: Record<string, unknown>, run: () => T): T {
  const key = Symbol.for("tanstack-start:start-storage-context");
  const storage = (globalThis as unknown as Record<symbol, { run<U>(store: unknown, fn: () => U): U }>)[key];
  if (storage === undefined) throw new Error("the framework published no start-context store to enter");
  return storage.run(afterMiddlewares(context), run);
}

describe("the render reads back the nonce the middleware handed down", () => {
  it("returns the nonce the middleware put in the start context", () => {
    expect(withinStartContext({ [CSP_NONCE_CONTEXT_KEY]: "minted-nonce" }, currentCspNonce)).toBe("minted-nonce");
  });

  it("returns undefined when the context carries no nonce, or a non-string one", () => {
    expect(withinStartContext({}, currentCspNonce)).toBeUndefined();
    expect(withinStartContext({ [CSP_NONCE_CONTEXT_KEY]: 42 }, currentCspNonce)).toBeUndefined();
    expect(withinStartContext({ [CSP_NONCE_CONTEXT_KEY]: "" }, currentCspNonce)).toBeUndefined();
  });

  it("returns undefined when there is no start context at all", () => {
    expect(currentCspNonce()).toBeUndefined();
  });
});

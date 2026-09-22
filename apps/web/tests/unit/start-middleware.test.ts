import { describe, expect, it } from "vitest";
import { startInstance } from "../../src/start";
import { cspMiddleware } from "../../src/server/csp-middleware";

/**
 * `src/start.ts` is the only place the app declares its global request
 * middleware, and that declaration REPLACES the framework's built-in default:
 * `createStartHandler` reads this list instead of falling back to its own, and
 * the default it displaces is the CSRF middleware. A dropped entry is therefore
 * not a weakened protection but an absent one — server functions stop checking
 * cross-site provenance and nothing in the app reports it. These cases read the
 * declared list and drive its entries rather than restating the wiring they
 * exist to guard, so they fail if either entry leaves, whatever the reason.
 */

/** A sentinel `next`, so "the chain continued" is distinguishable from a refusal. */
const CONTINUED = { continued: true } as const;
const SERVER_FN_URL = "https://web.test/_server";

/** The middleware exactly as `createStartHandler` invokes it. */
type ServerMiddleware = (options: {
  request: Request;
  pathname: string;
  context: undefined;
  handlerType: "serverFn";
  next: () => Promise<unknown>;
}) => Promise<unknown>;

function request(headers: Readonly<Record<string, string>>): Request {
  return new Request(SERVER_FN_URL, { method: "POST", headers });
}

async function declared(): Promise<readonly unknown[]> {
  const { requestMiddleware } = await startInstance.getOptions();
  return requestMiddleware ?? [];
}

async function drive(middleware: unknown, sent: Request): Promise<unknown> {
  const server = (middleware as { options: { server: ServerMiddleware } }).options.server;
  return server({
    request: sent,
    pathname: "/",
    context: undefined,
    handlerType: "serverFn",
    next: () => Promise.resolve(CONTINUED),
  });
}

describe("the global request middleware src/start.ts declares", () => {
  it("carries the CSRF middleware beside the CSP middleware, and nothing else", async () => {
    const list = await declared();
    expect(list).toHaveLength(2);
    expect(list).toContain(cspMiddleware);
  });

  it("refuses a cross-site server function — the protection the entry displaced", async () => {
    const [csrf] = await declared();
    const refusal = await drive(csrf, request({ "Sec-Fetch-Site": "cross-site" }));
    expect(refusal).toBeInstanceOf(Response);
    expect((refusal as Response).status).toBe(403);
  });

  it("lets a same-origin server function through that same entry", async () => {
    const [csrf] = await declared();
    expect(await drive(csrf, request({ "Sec-Fetch-Site": "same-origin" }))).toBe(CONTINUED);
  });
});

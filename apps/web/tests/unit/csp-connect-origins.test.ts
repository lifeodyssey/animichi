import { afterEach, describe, expect, it, vi } from "vitest";
import { cspMiddleware } from "../../src/server/csp-middleware";
import { deploymentConnectOrigins } from "../../src/server/csp-policy";
import { sourceList } from "../csp-evaluator";

/**
 * The `connect-src` origins a deployment's own config names (#1013) — the half
 * of the policy that is not a constant. `deploymentConnectOrigins` projects the
 * runtime config, `csp-middleware.ts` puts that projection on the response, and
 * these cases drive the pair through the real middleware: a runtime config in,
 * the served source list out. A base the policy omits is refused by the browser
 * before any of this app's code runs, so a missing origin is not a degraded
 * feature here, it is an unreachable one.
 *
 * They live apart from `csp-policy.test.ts` because they change for a different
 * reason: that suite pins the nonce the middleware mints and writes on both
 * sides of the render, which the deployment's origins have no say in.
 */

/**
 * The middleware exactly as `createStartHandler` invokes it. `createMiddleware`
 * types its server function generically over the whole middleware chain, so
 * this states the slice the test drives instead of importing that generics
 * soup; the three fields the middleware reads are the real ones.
 */
type ServerMiddleware = (options: {
  request: Request;
  pathname: string;
  context: undefined;
  handlerType: "router";
  next: (options?: { context?: unknown }) => Promise<unknown>;
}) => Promise<unknown>;

const HOME = new Request("http://web.test/");

/** The `connect-src` sources of the response the client gets, read off the header. */
async function connectSources(): Promise<readonly string[]> {
  const document = new Response("<html><body>doorway</body></html>", {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
  const server = cspMiddleware.options.server as unknown as ServerMiddleware;
  const next = (): Promise<unknown> =>
    Promise.resolve({ request: HOME, pathname: "/", context: undefined, response: document });
  const result = (await server({ request: HOME, pathname: "/", context: undefined, handlerType: "router", next })) as {
    response: Response;
  };
  return sourceList(result.response.headers.get("Content-Security-Policy") ?? "", "connect-src");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("every request base the deployment declares is reachable (AC3)", () => {
  it("allows the Neon Auth origin the deployment declares", async () => {
    expect(await connectSources()).not.toContain("https://auth.example.test");
    // The cloudflare-module preset publishes the live binding as `__env__`;
    // runtime-config-plugin.test.ts stubs the same seam.
    vi.stubGlobal("__env__", {
      RUNTIME_CONFIG: JSON.stringify({
        schemaVersion: 1, showcaseMode: "false", featureFlags: {},
        neonAuthBaseUrl: "https://auth.example.test/neondb/auth",
      }),
    });
    const connect = await connectSources();
    expect(connect).toContain("https://auth.example.test");
    // The origin, not the SDK's path, is what a source list can carry.
    expect(connect).not.toContain("https://auth.example.test/neondb/auth");
  });

  it("allows every API base the runtime config names, not only the auth one", async () => {
    // The regression this pins. `api.agentUrl` is the base the chat page and
    // the Turnstile verdict are fetched from; a policy carrying only
    // `neonAuthBaseUrl` refused both, and it refused them at the browser —
    // `connect-src` blocks the request before any of this app's code runs, so
    // the entry gate never resolved and every chat journey failed on a page
    // that had rendered and hydrated perfectly.
    vi.stubGlobal("__env__", {
      RUNTIME_CONFIG: JSON.stringify({
        schemaVersion: 1, showcaseMode: "false", featureFlags: {},
        api: {
          agentUrl: "https://agent.example.test/v1",
          catalogUrl: "https://catalog.example.test",
          usersUrl: "https://users.example.test/users",
        },
      }),
    });
    const connect = await connectSources();
    expect(connect).toContain("https://agent.example.test");
    expect(connect).toContain("https://catalog.example.test");
    expect(connect).toContain("https://users.example.test");
  });
});

describe("a runtime config the policy must neither widen nor break on", () => {
  it("leaves api.siteOrigin out, because the browser answers for it with 'self'", async () => {
    // `siteOrigin` is the SSR fallback for a request with no origin of its own
    // (`api/config.ts`); the browser always has one. Listing it would widen the
    // policy to an origin nothing in the page ever dials.
    vi.stubGlobal("__env__", {
      RUNTIME_CONFIG: JSON.stringify({
        schemaVersion: 1, showcaseMode: "false", featureFlags: {},
        api: { siteOrigin: "https://site.example.test" },
      }),
    });
    expect(await connectSources()).not.toContain("https://site.example.test");
  });

  it("still serves a policy when the runtime config binding is unusable", async () => {
    vi.stubGlobal("__env__", { RUNTIME_CONFIG: "{ not json" });
    expect(await connectSources()).toEqual(["'self'", "https://cloudflareinsights.com"]);
  });

  it("turns a deployment URL into an origin, and a junk one into nothing", () => {
    expect(deploymentConnectOrigins({ api: {}, neonAuthBaseUrl: "https://auth.example.test/neondb/auth" }))
      .toEqual(["https://auth.example.test"]);
    expect(deploymentConnectOrigins({ api: { agentUrl: "not a url" } })).toEqual([]);
    expect(deploymentConnectOrigins({ api: {} })).toEqual([]);
  });
});

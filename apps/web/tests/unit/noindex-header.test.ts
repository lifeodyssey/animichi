import { createApp, createRouter, defineEventHandler, setResponseStatus, toWebHandler } from "h3";
import type { NitroRuntimeHooks } from "nitropack/types";
import { describe, expect, it } from "vitest";
import noindexPlugin, { registerNoindexHook } from "../../src/server/noindex-plugin";

type WorkerEnv = Record<string, string>;

type BeforeResponseHook = NitroRuntimeHooks["beforeResponse"];

interface TestHooks {
  hook: (name: "beforeResponse", callback: BeforeResponseHook) => void;
  callHook: (
    name: "beforeResponse",
    event: Parameters<BeforeResponseHook>[0],
    response: Parameters<BeforeResponseHook>[1],
  ) => Promise<void>;
}

function createTestHooks(): TestHooks {
  const handlers: BeforeResponseHook[] = [];
  return {
    hook: (_name, callback) => handlers.push(callback),
    callHook: async (_name, event, response) => {
      for (const handler of [...handlers]) await handler(event, response);
    },
  };
}

// Mirrors the wiring nitropack 2.13.4 uses in dist/runtime/internal/app.mjs:
// plugins register on nitroApp.hooks, and the h3 app's onBeforeResponse calls
// hooks.callHook("beforeResponse", event, response) for every response.
function buildHandler(cloudflare?: Record<string, unknown>): (request: Request) => Promise<Response> {
  const hooks = createTestHooks();
  registerNoindexHook({ hooks });
  const app = createApp({
    onRequest: (event) => {
      if (cloudflare) event.context.cloudflare = cloudflare;
    },
    onBeforeResponse: (event, response) => hooks.callHook("beforeResponse", event, response),
  });
  // A router (not app.use base mounting) keeps event.path intact — app.use
  // strips its base, which would hide any path-conditional bug from the hook.
  const router = createRouter();
  router.get(
    "/",
    defineEventHandler(() => "<html>home</html>"),
  );
  router.get(
    "/missing",
    defineEventHandler((event) => {
      setResponseStatus(event, 404);
      return "<html>not found</html>";
    }),
  );
  app.use(router);
  return toWebHandler(app);
}

const home = new Request("http://web.test/");
const missing = new Request("http://web.test/missing");
const withEnv = (env: WorkerEnv): ((request: Request) => Promise<Response>) =>
  buildHandler({ env });

describe("X-Robots-Tag noindex header", () => {
  it("adds noindex, nofollow when APP_ENV is staging (AC1)", async () => {
    const response = await withEnv({ APP_ENV: "staging" })(home);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("adds the header for any non-production APP_ENV value (AC1)", async () => {
    const response = await withEnv({ APP_ENV: "preview" })(home);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("does NOT add the header when APP_ENV is production (AC2)", async () => {
    const response = await withEnv({ APP_ENV: "production" })(home);
    expect(response.headers.get("X-Robots-Tag")).toBeNull();
  });

  it("treats a missing APP_ENV as non-production (AC3)", async () => {
    const response = await withEnv({})(home);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("treats an empty APP_ENV as non-production (AC3)", async () => {
    const response = await withEnv({ APP_ENV: "" })(home);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("treats an absent cloudflare context as non-production (AC3)", async () => {
    const response = await buildHandler()(home);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("treats a cloudflare context without an env record as non-production (AC3)", async () => {
    const response = await buildHandler({})(home);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("covers non-homepage responses: 404 page gets the header too (AC4)", async () => {
    const response = await withEnv({ APP_ENV: "staging" })(missing);
    expect(response.status).toBe(404);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("keeps production 404 responses indexable-clean as well (AC2+AC4)", async () => {
    const response = await withEnv({ APP_ENV: "production" })(missing);
    expect(response.status).toBe(404);
    expect(response.headers.get("X-Robots-Tag")).toBeNull();
  });

  it("exports the hook registrar as the Nitro plugin default", () => {
    expect(noindexPlugin).toBe(registerNoindexHook);
  });
});

interface CaptureHost {
  hooks: { hook: (name: "beforeResponse", callback: HookCallback) => unknown };
}

/** The event slice the plugin reads, plus whichever response surfaces exist. */
interface HookEventLike {
  context: Record<string, unknown>;
  res?: { headers?: unknown };
  node?: { res?: { setHeader(name: string, value: string): void } };
}

/** Deliberately untyped response: each case builds the surfaces its runtime
 *  offers, and the plugin's own boundary is what narrows them. */
type HookCallback = (event: HookEventLike, response?: unknown) => void | Promise<void>;

/** Registers the plugin and returns the captured nitro hook callback. */
function captureHook(): HookCallback {
  let hook: HookCallback | undefined;
  registerNoindexHook({ hooks: { hook: (_name, callback) => { hook = callback; } } } satisfies CaptureHost);
  if (hook === undefined) throw new Error("plugin did not register its hook");
  return hook;
}

const staging = { context: { cloudflare: { env: { APP_ENV: "staging" } } } };
const nodeWriter = (written: [string, string][]) => ({
  node: { res: { setHeader: (name: string, value: string) => written.push([name, value]) } },
});

describe("X-Robots-Tag across h3 generations", () => {
  // The plugin must survive nitro's h3 upgrade (#1744): its hook callback is
  // written against the event slice both generations share, and the header
  // write discriminates on the response surface the runtime offers. Each
  // generation's own surfaces are driven here; the end-to-end proof that a
  // real h3 2 app ships the header is
  // tests/integration/h3-2-server-plugins.test.ts.
  it("writes through the node adapter when the event has no response store (nitro 2.13 / h3 1.15 runtime)", () => {
    const written: [string, string][] = [];
    // h3 1.15 hands onBeforeResponse a body-only wrapper.
    void captureHook()({ ...staging, ...nodeWriter(written) }, { body: "<html>home</html>" });
    expect(written).toEqual([["X-Robots-Tag", "noindex, nofollow"]]);
  });

  it("writes through the response the hook is handed when the runtime built it first (h3 2 onResponse)", () => {
    const headers = new Headers();
    // h3 2 empties the event's own slot in prepareResponse before onResponse runs,
    // so a write there would never reach the client.
    const store = new Headers();
    const written: [string, string][] = [];
    void captureHook()({ ...staging, res: { headers: store }, ...nodeWriter(written) }, { headers });
    expect(headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(store.get("X-Robots-Tag")).toBeNull();
    expect(written).toEqual([]);
  });

  it("writes through the h3 2 event store when the hook runs before the response exists", () => {
    const headers = new Headers();
    void captureHook()({ ...staging, res: { headers } });
    expect(headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("fails loud when the runtime offers no writable response surface", () => {
    expect(() => void captureHook()(staging)).toThrow(/carries no writable response surface/);
  });

  it("writes nothing on any surface when APP_ENV is production", () => {
    const written: [string, string][] = [];
    const handed = new Headers();
    const store = new Headers();
    const production = { context: { cloudflare: { env: { APP_ENV: "production" } } } };
    void captureHook()({ ...production, res: { headers: store }, ...nodeWriter(written) }, { headers: handed });
    expect(written).toEqual([]);
    expect(store.get("X-Robots-Tag")).toBeNull();
    expect(handed.get("X-Robots-Tag")).toBeNull();
  });
});

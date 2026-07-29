import { createApp, defineEventHandler, setResponseStatus, toWebHandler } from "h3";
import { createHooks } from "hookable";
import type { NitroRuntimeHooks } from "nitropack/types";
import { describe, expect, it } from "vitest";
import noindexPlugin, { registerNoindexHook } from "../../src/server/noindex-plugin";

type WorkerEnv = Record<string, string>;

// Mirrors the wiring nitropack 2.13.4 uses in dist/runtime/internal/app.mjs:
// plugins register on nitroApp.hooks, and the h3 app's onBeforeResponse calls
// hooks.callHook("beforeResponse", event, response) for every response.
function buildHandler(cloudflare?: Record<string, unknown>): (request: Request) => Promise<Response> {
  const hooks = createHooks<NitroRuntimeHooks>();
  registerNoindexHook({ hooks });
  const app = createApp({
    onRequest: (event) => {
      if (cloudflare) event.context.cloudflare = cloudflare;
    },
    onBeforeResponse: (event, response) => hooks.callHook("beforeResponse", event, response),
  });
  app.use(
    "/missing",
    defineEventHandler((event) => {
      setResponseStatus(event, 404);
      return "<html>not found</html>";
    }),
  );
  app.use(
    "/",
    defineEventHandler(() => "<html>home</html>"),
  );
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

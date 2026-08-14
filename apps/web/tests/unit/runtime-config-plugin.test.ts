import { createApp, createRouter, defineEventHandler, toWebHandler } from "h3";
import type { NitroRuntimeHooks } from "nitropack/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RUNTIME_CONFIG_GLOBAL_KEY } from "../../src/lib/runtime-config/provider";
import { DEFAULT_RUNTIME_CONFIG } from "../../src/lib/runtime-config/runtime-config";
import runtimeConfigPlugin, { registerRuntimeConfigHook } from "../../src/server/runtime-config-plugin";

type RequestHook = NitroRuntimeHooks["request"];

interface TestHooks {
  hook: (name: "request", callback: RequestHook) => void;
  callHook: (name: "request", event: Parameters<RequestHook>[0]) => Promise<void>;
}

function createTestHooks(): TestHooks {
  const handlers: RequestHook[] = [];
  return {
    hook: (_name, callback) => handlers.push(callback),
    callHook: async (_name, event) => {
      for (const handler of [...handlers]) await handler(event);
    },
  };
}

function buildHandler(cloudflare?: Record<string, unknown>): (request: Request) => Promise<Response> {
  const hooks = createTestHooks();
  registerRuntimeConfigHook({ hooks });
  const app = createApp({
    onRequest: (event) => {
      if (cloudflare) event.context.cloudflare = cloudflare;
      void hooks.callHook("request", event);
    },
  });
  const router = createRouter();
  router.get("/", defineEventHandler(() => "<html>home</html>"));
  app.use(router);
  return toWebHandler(app);
}

const home = new Request("http://web.test/");

function readGlobal(): unknown {
  return (globalThis as Record<string, unknown>)[RUNTIME_CONFIG_GLOBAL_KEY];
}

afterEach(() => {
  vi.unstubAllGlobals();
  (globalThis as Record<string, unknown>)[RUNTIME_CONFIG_GLOBAL_KEY] = undefined;
});

describe("runtime config Nitro plugin", () => {
  it("publishes the validated RUNTIME_CONFIG binding onto the global", async () => {
    vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, undefined);
    const payload = JSON.stringify({ schemaVersion: 1, showcaseMode: "false", featureFlags: {} });
    await buildHandler({ env: { RUNTIME_CONFIG: payload } })(home);
    const published = readGlobal() as { showcaseMode: string; schemaVersion: number };
    expect(published.showcaseMode).toBe("false");
    expect(published.schemaVersion).toBe(1);
  });

  it("publishes the env-neutral default when no binding is present", async () => {
    vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, undefined);
    await buildHandler({ env: {} })(home);
    expect(readGlobal()).toEqual(DEFAULT_RUNTIME_CONFIG);
  });

  it("leaves the global untouched when the cloudflare context is absent", async () => {
    vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, undefined);
    await buildHandler()(home);
    expect(readGlobal()).toBeUndefined();
  });

  it("leaves the global untouched when the cloudflare env is not a record", async () => {
    vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, undefined);
    await buildHandler({ env: "not-a-record" })(home);
    expect(readGlobal()).toBeUndefined();
  });

  it("prefers the live globalThis.__env__ binding the module handler sets", async () => {
    vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, undefined);
    vi.stubGlobal("__env__", { RUNTIME_CONFIG: JSON.stringify({ schemaVersion: 1, showcaseMode: "true", featureFlags: {} }) });
    // No cloudflare context: the module-handler global is the source.
    await buildHandler()(home);
    const published = readGlobal() as { showcaseMode: string; schemaVersion: number };
    expect(published.showcaseMode).toBe("true");
    expect(published.schemaVersion).toBe(1);
  });

  it("exports the hook registrar as the Nitro plugin default", () => {
    expect(runtimeConfigPlugin).toBe(registerRuntimeConfigHook);
  });
});

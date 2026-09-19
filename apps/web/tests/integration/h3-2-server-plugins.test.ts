/**
 * Issue #1744: h3 2 dropped `onBeforeResponse` from its app config, so an
 * h3-2 nitro drives our two server plugins from h3 2's `onRequest` /
 * `onResponse` pair instead. This lane runs them through a REAL h3 2 app —
 * `h3-v2` is the 2.0.1-rc.32 copy the declaration bump would install, aliased
 * so the Worker keeps nitro 2.13's h3 1.15 runtime — and asserts the effect a
 * client sees, not that a hook was called.
 *
 * The second copy is what makes the difference: `event.res.headers` on an h3 2
 * event is the PRE-response store, and h3 2 clears it in `prepareResponse`
 * before it calls `onResponse`, so a write there is a silent no-op by the time
 * this hook fires. The live surface is the response the hook is handed.
 */
import { H3, defineEventHandler } from "h3-v2";
import type { H3Event, H3EventContext } from "h3-v2";
import { afterEach, describe, expect, it } from "vitest";
import { RUNTIME_CONFIG_GLOBAL_KEY } from "../../src/lib/runtime-config/provider";
import { DEFAULT_RUNTIME_CONFIG } from "../../src/lib/runtime-config/runtime-config";
import { registerNoindexHook } from "../../src/server/noindex-plugin";
import { registerRuntimeConfigHook } from "../../src/server/runtime-config-plugin";

type HookName = "request" | "beforeResponse";
type HookCallback = (event: H3Event, response?: Response) => void | Promise<void>;

/** nitropack's hook store, as `nitroApp.hooks`: named hooks, fired in order. */
interface NitroHooks {
  hook: (name: HookName, callback: HookCallback) => void;
  fire: (name: HookName, event: H3Event, response?: Response) => Promise<void>;
}

function nitroHooks(): NitroHooks {
  const handlers = new Map<HookName, HookCallback[]>();
  return {
    hook: (name, callback) => {
      handlers.set(name, [...(handlers.get(name) ?? []), callback]);
    },
    fire: async (name, event, response) => {
      for (const handler of handlers.get(name) ?? []) await handler(event, response);
    },
  };
}

type WorkerEnv = Record<string, unknown>;

/** Both plugins registered on an h3 2 app, fired the way an h3-2 nitro fires them. */
function buildApp(): H3 {
  const hooks = nitroHooks();
  registerNoindexHook({ hooks });
  registerRuntimeConfigHook({ hooks });
  const app = new H3({
    onRequest: (event) => hooks.fire("request", event),
    onResponse: (response, event) => hooks.fire("beforeResponse", event, response),
  });
  app.get(
    "/",
    defineEventHandler(() => "<html>home</html>"),
  );
  return app;
}

const HOME = "http://web.test/";
const MISSING = "http://web.test/missing";

/** The context the cloudflare-module preset hands an h3 event. */
function cloudflareContext(env: WorkerEnv): H3EventContext {
  return { cloudflare: { env } };
}

afterEach(() => {
  (globalThis as Record<string, unknown>)[RUNTIME_CONFIG_GLOBAL_KEY] = undefined;
});

describe("X-Robots-Tag plugin on h3 2", () => {
  it("reaches the client on a staging response (AC1)", async () => {
    const response = await buildApp().request(HOME, undefined, cloudflareContext({ APP_ENV: "staging" }));
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("leaves a production response clean (AC2)", async () => {
    const response = await buildApp().request(HOME, undefined, cloudflareContext({ APP_ENV: "production" }));
    expect(response.headers.get("X-Robots-Tag")).toBeNull();
  });

  it("covers a non-homepage response too (AC4)", async () => {
    const response = await buildApp().request(MISSING, undefined, cloudflareContext({ APP_ENV: "staging" }));
    expect(response.status).toBe(404);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });
});

describe("runtime config plugin on h3 2", () => {
  it("publishes the validated RUNTIME_CONFIG binding onto the global", async () => {
    const payload = JSON.stringify({ schemaVersion: 1, showcaseMode: "true", featureFlags: {} });
    await buildApp().request(HOME, undefined, cloudflareContext({ RUNTIME_CONFIG: payload }));
    const published = (globalThis as Record<string, unknown>)[RUNTIME_CONFIG_GLOBAL_KEY] as {
      showcaseMode: string;
      schemaVersion: number;
    };
    expect(published.showcaseMode).toBe("true");
    expect(published.schemaVersion).toBe(1);
  });

  it("publishes the env-neutral default when the binding is absent", async () => {
    await buildApp().request(HOME, undefined, cloudflareContext({}));
    expect((globalThis as Record<string, unknown>)[RUNTIME_CONFIG_GLOBAL_KEY]).toEqual(DEFAULT_RUNTIME_CONFIG);
  });

  it("leaves the global untouched when the request carries no cloudflare context", async () => {
    await buildApp().request(HOME);
    expect((globalThis as Record<string, unknown>)[RUNTIME_CONFIG_GLOBAL_KEY]).toBeUndefined();
  });
});

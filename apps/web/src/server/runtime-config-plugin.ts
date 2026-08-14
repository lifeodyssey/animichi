import type { H3Event } from "h3";
import type { NitroAppPlugin, NitroRuntimeHooks } from "nitropack/types";
import {
  RUNTIME_CONFIG_GLOBAL_KEY,
  runtimeConfigFromServerEnv,
} from "../lib/runtime-config/provider";

// SSR runtime source (#1013 merge-blocker): reads the `RUNTIME_CONFIG`
// Cloudflare binding FIRST and publishes the validated versioned payload onto
// the well-known global the app resolves through. The cloudflare-module preset
// sets `globalThis.__env__` to the live binding for every request
// (dist/presets/cloudflare/runtime/_module-handler.mjs); `event.context.cloudflare`
// is the same env for plugin-hook consumers. Fail-closed typed errors from the
// loader abort the request rather than silently serving env-neutral defaults —
// a malformed binding is a deploy misconfig, not a graceful feature gap.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The live Cloudflare env for the current request (module handler first). */
function readEnvRecord(event: H3Event): Record<string, unknown> | undefined {
  const live = (globalThis as Record<string, unknown>).__env__;
  if (isRecord(live)) return live;
  const cloudflare = (event.context as Record<string, unknown>).cloudflare;
  if (!isRecord(cloudflare)) return undefined;
  return isRecord(cloudflare.env) ? cloudflare.env : undefined;
}

function publish(event: H3Event): void {
  const env = readEnvRecord(event);
  if (env === undefined) return;
  (globalThis as Record<string, unknown>)[RUNTIME_CONFIG_GLOBAL_KEY] = runtimeConfigFromServerEnv(env);
}

interface RuntimeConfigHookHost {
  hooks: {
    hook: (name: "request", callback: NitroRuntimeHooks["request"]) => unknown;
  };
}

export function registerRuntimeConfigHook(nitroApp: RuntimeConfigHookHost): void {
  nitroApp.hooks.hook("request", publish);
}

const runtimeConfigPlugin: NitroAppPlugin = registerRuntimeConfigHook;
export default runtimeConfigPlugin;

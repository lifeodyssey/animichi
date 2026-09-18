import type { NitroAppPlugin } from "nitropack/types";
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
//
// Two h3 generations, one plugin: the built Worker runs nitro 2.13 (h3 1.15
// events), this package's own h3 is 2.x. `context` is an open record in both,
// so the hook reads only the shared slice — `cloudflare` is the one entry the
// plugin needs — and never touches a generation-specific member.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The event surface the hook reads: the slice both h3 generations share. */
interface HookEvent {
  context: { cloudflare?: unknown; [key: string]: unknown };
}

/** The live Cloudflare env for the current request (module handler first). */
function readEnvRecord(event: HookEvent): Record<string, unknown> | undefined {
  const live = (globalThis as Record<string, unknown>).__env__;
  if (isRecord(live)) return live;
  const cloudflare = event.context.cloudflare;
  if (!isRecord(cloudflare)) return undefined;
  return isRecord(cloudflare.env) ? cloudflare.env : undefined;
}

function publish(event: HookEvent): void {
  const env = readEnvRecord(event);
  if (env === undefined) return;
  (globalThis as Record<string, unknown>)[RUNTIME_CONFIG_GLOBAL_KEY] = runtimeConfigFromServerEnv(env);
}

interface RuntimeConfigHookHost {
  hooks: {
    hook: (name: "request", callback: (event: HookEvent) => void | Promise<void>) => unknown;
  };
}

export function registerRuntimeConfigHook(nitroApp: RuntimeConfigHookHost): void {
  nitroApp.hooks.hook("request", publish);
}

const runtimeConfigPlugin: NitroAppPlugin = registerRuntimeConfigHook;
export default runtimeConfigPlugin;

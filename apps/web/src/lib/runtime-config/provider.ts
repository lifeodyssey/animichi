import { parseRuntimeConfig, DEFAULT_RUNTIME_CONFIG, type RuntimeConfig } from "./runtime-config";

/**
 * Runtime source for the ONE built web artifact (#1013 AC2/merge-blocker).
 *
 * The ONE artifact resolves its environment-varying PUBLIC config through two
 * sources in precedence order (#1013):
 *
 *   1. Server env binding FIRST: on the SSR side, the cloudflare-module preset
 *      exposes the live Worker env as `globalThis.__env__`
 *      (dist/presets/cloudflare/runtime/_module-handler.mjs), so the deployed
 *      `RUNTIME_CONFIG` payload is read and validated synchronously.
 *   2. The injected global (`window.__ANIMICHI_RUNTIME_CONFIG__`): the SSR
 *      seed script writes the same payload onto the browser, so hydration and
 *      client navigation read an identical config without a second source.
 *   3. The env-neutral {@link DEFAULT_RUNTIME_CONFIG} when neither is present
 *      (defaults on missing config).
 *
 * A present but invalid payload fails closed through {@link parseRuntimeConfig}
 * — a wrong version, unknown field, or malformed required value refuses to
 * load rather than silently defaulting.
 */

export const RUNTIME_CONFIG_GLOBAL_KEY = "__ANIMICHI_RUNTIME_CONFIG__";

const SERVER_ENV_KEY = "RUNTIME_CONFIG";
const LIVE_ENV_KEY = "__env__";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readGlobal(): unknown {
  return (globalThis as Record<string, unknown>)[RUNTIME_CONFIG_GLOBAL_KEY];
}

function readJson(raw: unknown): unknown {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  return raw;
}

/** Client/global seam: read the config injected by SSR or set by a fixture. */
export function runtimeConfigFromClient(): RuntimeConfig {
  return parseRuntimeConfig(readGlobal());
}

/** SSR binding reader: parse the structured `RUNTIME_CONFIG` Cloudflare var. */
export function runtimeConfigFromServerEnv(
  env: Readonly<Record<string, unknown>>,
): RuntimeConfig {
  return parseRuntimeConfig(readJson(env[SERVER_ENV_KEY]));
}

/** The live Worker env on the SSR side, if the module handler exposed it. */
function liveServerEnv(): Readonly<Record<string, unknown>> | undefined {
  const live = (globalThis as Record<string, unknown>)[LIVE_ENV_KEY];
  return isRecord(live) ? live : undefined;
}

/**
 * The resolved config in source-precedence order: an explicit server env
 * (SSR callers) → the live `__env__` binding (server) → the injected global
 * (client hydration / fixtures) → the env-neutral default.
 */
export function currentRuntimeConfig(
  serverEnv?: Readonly<Record<string, unknown>>,
): RuntimeConfig {
  if (serverEnv !== undefined) return runtimeConfigFromServerEnv(serverEnv);
  const live = liveServerEnv();
  if (live !== undefined) return runtimeConfigFromServerEnv(live);
  const global = readGlobal();
  return global === undefined ? DEFAULT_RUNTIME_CONFIG : parseRuntimeConfig(global);
}

import { parseRuntimeConfig, type RuntimeConfig } from "./runtime-config";

/**
 * Runtime source for the ONE built web artifact (#1013 AC2).
 *
 * The resolver reads a single well-known global (`window.__ANIMICHI_RUNTIME_CONFIG__`,
 * which equals `globalThis` in a browser) set by the SSR render from the
 * versioned contract; when absent it degrades to the env-neutral
 * {@link DEFAULT_RUNTIME_CONFIG}. Both the browser client and the test pool read
 * through the same global, so a fixture injected via `addInitScript` or
 * `vi.stubGlobal` drives the identical code path that a deployed runtime-config
 * payload exercises.
 */

export const RUNTIME_CONFIG_GLOBAL_KEY = "__ANIMICHI_RUNTIME_CONFIG__";

const SERVER_ENV_KEY = "RUNTIME_CONFIG";

function readGlobal(): unknown {
  return (globalThis as Record<string, unknown>)[RUNTIME_CONFIG_GLOBAL_KEY];
}

/** Browser/global seam: read the config injected by SSR (object or JSON string). */
export function runtimeConfigFromClient(): RuntimeConfig {
  return parseRuntimeConfig(readGlobal());
}

/** SSR seam: read the structured `RUNTIME_CONFIG` binding from Cloudflare env. */
export function runtimeConfigFromServerEnv(
  env: Readonly<Record<string, unknown>>,
): RuntimeConfig {
  const raw = env[SERVER_ENV_KEY];
  return parseRuntimeConfig(readJson(raw));
}

function readJson(raw: unknown): unknown {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  return raw;
}

/** Isomorphic resolution: reads the injected global, else the env-neutral default. */
export function currentRuntimeConfig(): RuntimeConfig {
  return runtimeConfigFromClient();
}

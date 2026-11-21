/**
 * The `main` a wrangler config file declares, for the entry-export check
 * (`check-worker-entry-exports.ts`), read with wrangler's own config reader,
 * `experimental_readRawConfig`. The file is parsed as wrangler parses it, so
 * comments, every TOML and JSONC string form and environment tables are read as
 * wrangler reads them, and only the top-level `main` counts. A file wrangler
 * cannot parse throws wrangler's `ParseError`, which names the file and line.
 *
 * The raw reader validates nothing. wrangler's schema declares `main` an optional
 * string (`config-schema.json`, `RawConfig.main`), but a config can hold any value
 * there, so `main` comes back as the config holds it, and the check reports one
 * that is not a string.
 *
 * wrangler's published types re-export the reader from
 * `@cloudflare/workers-utils`, which wrangler bundles and does not install, so
 * the type checker has no type for it. `ReadRawConfig` states the part used
 * here: the reader takes the config's path and returns the raw config.
 */
import { experimental_readRawConfig } from "wrangler";

type ReadRawConfig = (args: { config: string }) => { rawConfig: { main?: unknown } };

const readRawConfig = experimental_readRawConfig as ReadRawConfig;

/** The top-level `main` of the wrangler config at `configFile`, as the config holds it. */
export function wranglerMain(configFile: string): unknown {
  return readRawConfig({ config: configFile }).rawConfig.main;
}

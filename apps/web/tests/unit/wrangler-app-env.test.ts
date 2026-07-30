import { type ParseError, parse } from "jsonc-parser";
import { describe, expect, it } from "vitest";
import { z } from "zod";
// `?raw` inlines wrangler.jsonc at transform time, so this guard asserts on the
// file a human edits and always runs in the unit pool — a skipped guard is not
// a guard (pattern from workers/catalog/test/wrangler-private.worker.test.ts).
import wranglerRaw from "../../wrangler.jsonc?raw";

// The noindex plugin reads APP_ENV from the Worker env at runtime. `vars` is a
// non-inheritable wrangler key: every env block must declare it itself, or that
// deployment ships without APP_ENV and (fail-safe) serves noindex — which would
// silently deindex production. This is exactly how worker/containerEnv.ts once
// hardcoded "production" for staging (issue #498), just in the other direction.
const envSchema = z.looseObject({
  name: z.string().optional(),
  vars: z.looseObject({ APP_ENV: z.string() }).optional(),
});

const configSchema = envSchema.extend({ env: z.record(z.string(), envSchema) });

function parseWranglerConfig(): z.infer<typeof configSchema> {
  const errors: ParseError[] = [];
  const raw: unknown = parse(wranglerRaw, errors);
  expect(errors).toEqual([]);
  return configSchema.parse(raw);
}

const declaredEnvironments = ["staging", "production"];

describe("wrangler.jsonc APP_ENV declarations (AC5)", () => {
  it("finds every environment the file actually declares", () => {
    // Guards the iterator below: a new env block added without updating this
    // list fails here instead of silently escaping the per-env assertion.
    expect(Object.keys(parseWranglerConfig().env)).toEqual(declaredEnvironments);
  });

  it.each(declaredEnvironments)("env.%s declares APP_ENV matching its env name", (name) => {
    expect(parseWranglerConfig().env[name]?.vars?.APP_ENV).toBe(name);
  });

  // A `wrangler deploy` with no `--env` uses the top-level block. Its `name` is
  // the same Worker as one of the env blocks, so its APP_ENV must agree with
  // that block's — otherwise a bare deploy publishes to a real environment
  // under the wrong identity, and for production that means the fail-safe
  // silently deindexes the live site.
  //
  // Asserted as a relation rather than the literal "production" so a rename
  // cannot leave this passing while meaning something else.
  it("top-level APP_ENV agrees with the env block that shares its Worker name", () => {
    const config = parseWranglerConfig();
    const twin = Object.entries(config.env).find(([, e]) => e.name === config.name);
    expect(twin, `no env block declares name=${String(config.name)}`).toBeDefined();
    expect(config.vars?.APP_ENV).toBe(twin?.[1].vars?.APP_ENV);
  });
});

import { execFileSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CONFIG = `${ROOT}workers/migrator/wrangler.toml`;
const RETIRED_CLASS = "MigrationContainer";
const RETIREMENT_TAG = "v3-retire-migration-container";
const RINGS = ["default", "staging", "production"] as const;
const READ_CONFIG = `
process.env.WRANGLER_WRITE_LOGS = "false";
const { unstable_readConfig } = await import("wrangler");
const view = (env) => {
  const config = unstable_readConfig({ config: process.argv[1], ...(env === "default" ? {} : { env }) });
  return { main: config.main, containers: config.containers ?? [],
    bindings: config.durable_objects.bindings, migrations: config.migrations ?? [] };
};
process.stdout.write(JSON.stringify(Object.fromEntries(
  ["default", "staging", "production"].map((ring) => [ring, view(ring)]),
)));
`;

interface Migration {
  tag: string;
  new_sqlite_classes?: string[];
  new_classes?: string[];
  deleted_classes?: string[];
}

interface RingConfig {
  main: string;
  containers: { class_name?: string }[];
  bindings: { name: string; class_name: string }[];
  migrations: Migration[];
}

function readRingConfigs(): Record<typeof RINGS[number], RingConfig> {
  const output = execFileSync(process.execPath, ["--input-type=module", "--eval", READ_CONFIG, CONFIG], {
    encoding: "utf8",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false" },
  });
  return JSON.parse(output) as Record<typeof RINGS[number], RingConfig>;
}

const RING_CONFIGS = readRingConfigs();

function ringConfig(ring: typeof RINGS[number]): RingConfig {
  return RING_CONFIGS[ring];
}

function deletionIndex(migrations: Migration[]): number {
  return migrations.findIndex((migration) => migration.deleted_classes?.includes(RETIRED_CLASS));
}

function reintroducesRetiredClass(migration: Migration): boolean {
  return [...(migration.new_classes ?? []), ...(migration.new_sqlite_classes ?? [])]
    .includes(RETIRED_CLASS);
}

describe("migrator deployment retirement contract", () => {
  it("keeps every ring free of the retired container and binding", () => {
    for (const ring of RINGS) {
      const config = ringConfig(ring);
      expect(config.containers, `${ring} containers`).toEqual([]);
      expect(config.bindings, `${ring} bindings`).toEqual([
        { name: "MIGRATOR_APPLY_LOCK", class_name: "MigratorApplyLock" },
      ]);
    }
  });

  it("appends one unique deletion tag in every ring with no later reintroduction", () => {
    for (const ring of RINGS) {
      const migrations = ringConfig(ring).migrations;
      const index = deletionIndex(migrations);
      expect(index, `${ring} deletion migration`).toBeGreaterThan(-1);
      expect(migrations.at(-1), `${ring} appended deletion`).toMatchObject({
        tag: RETIREMENT_TAG, deleted_classes: [RETIRED_CLASS],
      });
      expect(new Set(migrations.map(({ tag }) => tag)).size, `${ring} unique tags`).toBe(migrations.length);
      expect(migrations.slice(index + 1).some(reintroducesRetiredClass), `${ring} later migrations`).toBe(false);
    }
  });

  it("bundles the deployed entry without the container SDK or retired class export", async () => {
    const result = await build({
      entryPoints: [ringConfig("production").main],
      bundle: true,
      external: ["cloudflare:workers"],
      format: "esm",
      loader: { ".sql": "text", ".sum": "text" },
      metafile: true,
      outfile: "migrator-contract.js",
      platform: "node",
      write: false,
    });
    const inputs = Object.keys(result.metafile.inputs);
    const exports = Object.values(result.metafile.outputs).flatMap((output) => output.exports);
    expect(inputs.some((path) => path.includes("@cloudflare/containers"))).toBe(false);
    expect(exports).not.toContain(RETIRED_CLASS);
  });
});

import test from "node:test";
import { process } from "../test-support/node-globals.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { URL, fileURLToPath } from "node:url";

/**
 * #1605 AC1/AC2: the edge Worker carries no container, and the Durable Object
 * class it used to own is retired rather than orphaned.
 *
 * The card's precedent is the migrator's own retirement (#1589,
 * `workers/migrator/test/deployment-contract.test.ts`): read every ring through
 * the REAL wrangler config parser and assert the absence, not a TOML grep —
 * `[[containers]]`, a `class_name` reference and a binding indirection are three
 * different ways to reintroduce the class, and only the resolved config sees all
 * three. `staging` inherits the top-level blocks, so a value that survived only
 * in the default ring would still answer for staging here.
 *
 * The deployment side of the same fact — the built entry's module graph and
 * exports — is asserted in `bundle-smoke/entry-bundle.test.ts`; this file owns
 * the configuration, that one owns the artifact.
 *
 * test-type: unit (parses a checked-in config through wrangler; no network, no
 * clock, no mocks).
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CONFIG = `${ROOT}workers/edge/wrangler.toml`;
const RETIRED_CLASS = "RuntimeContainer";
const RINGS = ["default", "staging", "production"] as const;

/** One `node --eval` in the child, so the imported wrangler module graph never
 * leaks into this test's own resolver — the same shape the migrator's contract
 * test uses, and the only way to read a resolved ring without a deploy. */
const READ_CONFIG = `
process.env.WRANGLER_WRITE_LOGS = "false";
const { unstable_readConfig } = await import("wrangler");
const view = (env) => {
  const config = unstable_readConfig({ config: process.argv[1], ...(env === "default" ? {} : { env }) });
  return { main: config.main, containers: config.containers ?? [],
    bindings: config.durable_objects?.bindings ?? [], migrations: config.migrations ?? [] };
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
  containers: { name?: string; class_name?: string }[];
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

/** Every `class_name` a ring still references, however it is bound. */
function referencedClasses(config: RingConfig): string[] {
  return [...config.containers, ...config.bindings].map((entry) => entry.class_name ?? "");
}

function deletionIndex(migrations: Migration[]): number {
  return migrations.findIndex((migration) => migration.deleted_classes?.includes(RETIRED_CLASS));
}

function reintroducesRetiredClass(migration: Migration): boolean {
  return [...(migration.new_classes ?? []), ...(migration.new_sqlite_classes ?? [])].includes(RETIRED_CLASS);
}

void test("every ring declares no container and no binding to the retired class", () => {
  for (const ring of RINGS) {
    const config = ringConfig(ring);
    assert.deepEqual(config.containers, [], `${ring} must declare no [[containers]] block`);
    assert.equal(
      referencedClasses(config).includes(RETIRED_CLASS),
      false,
      `${ring} must not reference ${RETIRED_CLASS} from any container or Durable Object binding`,
    );
    assert.equal(
      config.bindings.some((binding) => binding.name === "CONTAINER"),
      false,
      `${ring} must not bind a CONTAINER namespace`,
    );
  }
});

void test("the edge still deploys its own entry with the two surviving Durable Objects", () => {
  for (const ring of RINGS) {
    const config = ringConfig(ring);
    assert.equal(config.main.endsWith("workers/edge/src/entry.ts"), true, `${ring} main`);
    assert.deepEqual(
      config.bindings.map((binding) => binding.name).sort(),
      ["AGENT_SESSION", "EDGE_GUARD"],
      `${ring} keeps the agent session and the guard namespace`,
    );
  }
});

void test("one deletion tag retires the class in every ring, with no later reintroduction", () => {
  for (const ring of RINGS) {
    const migrations = ringConfig(ring).migrations;
    const index = deletionIndex(migrations);
    assert.ok(index > -1, `${ring} needs a [[migrations]] tag with deleted_classes = ["${RETIRED_CLASS}"]`);
    assert.deepEqual(migrations.at(-1)?.deleted_classes, [RETIRED_CLASS], `${ring} deletion tag is the last one`);
    assert.equal(migrations.at(-1)?.tag, "v6", `${ring} deletion tag`);
    assert.equal(
      new Set(migrations.map(({ tag }) => tag)).size,
      migrations.length,
      `${ring} migration tags must stay unique`,
    );
    assert.equal(migrations.slice(index + 1).some(reintroducesRetiredClass), false, `${ring} later migrations`);
  }
});

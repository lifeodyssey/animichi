/**
 * W1-2 (#1251): the config half of the agent tier. A `durable_objects` binding
 * names a class by string, and wrangler resolves that string against the
 * Worker's own exports at DEPLOY time — a binding whose class nobody exports
 * fails there, long after the change that caused it. These read the two files
 * against each other instead.
 *
 * It is also what keeps card #1252's seam honest: `AgentSession` must stay
 * UNBOUND until the class it names exists, so the reservation lives in a
 * comment here rather than in a binding that would break the deploy.
 *
 * test-type: unit (reads checked-in files; no network, no clock).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const WRANGLER = read("../wrangler.toml");
const ENTRY = read("../src/entry.ts");
const ENVIRONMENTS = ["", "env.production.", "env.staging."] as const;

/** Every class name any environment binds a Durable Object to. */
function boundClasses(): string[] {
  return [...WRANGLER.matchAll(/^class_name = "([^"]+)"$/gm)].map((match) => match[1] ?? "");
}

/** The `[[<prefix>migrations]]` tags that declare `className` as new. */
function migrationTagsFor(className: string): string[] {
  const blocks = [...WRANGLER.matchAll(/\[\[(?:env\.\w+\.)?migrations\]\]\ntag = "(v\d+)"\nnew_sqlite_classes = \[([^\]]*)\]/g)];
  return blocks.filter((block) => (block[2] ?? "").includes(`"${className}"`)).map((block) => block[1] ?? "");
}

void test("every Durable Object class the config binds is exported by the Worker entry", () => {
  const unexported = [...new Set(boundClasses())].filter((name) => !new RegExp(`export (class |\\{ )${name}\\b`).test(ENTRY));
  assert.deepEqual(unexported, [], "wrangler resolves class_name against src/entry.ts's exports");
});

void test("RunSweeper is bound in every environment, once each", () => {
  const bindings = [...WRANGLER.matchAll(/name = "RUN_SWEEPER"\nclass_name = "RunSweeper"/g)];
  assert.equal(bindings.length, ENVIRONMENTS.length);
});

void test("RunSweeper is declared new in every environment's migration chain", () => {
  assert.deepEqual(migrationTagsFor("RunSweeper"), ["v3", "v3", "v3"]);
});

void test("the sweep cadence is configured in every environment", () => {
  for (const prefix of ENVIRONMENTS) {
    const header = prefix === "" ? "[vars]" : `[${prefix}vars]`;
    const block = WRANGLER.slice(WRANGLER.indexOf(`\n${header}\n`));
    assert.match(block.slice(0, block.indexOf("\n[[")), /^RUN_SWEEP_INTERVAL_SECONDS = "60"$/m, header);
  }
});

void test("AgentSession stays unbound until card #1252 exports the class", () => {
  assert.doesNotMatch(WRANGLER, /^class_name = "AgentSession"$/m);
  assert.match(WRANGLER, /binding `AGENT_SESSION` \(class_name = "AgentSession"\)/);
});

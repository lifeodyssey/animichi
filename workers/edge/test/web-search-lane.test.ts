/**
 * W2-1 (#1287) lane contract: no staging lane can leak its bearer token onto a
 * plaintext wire.
 *
 * `api-test/` talks to a real deployed origin, so this suite cannot execute it
 * — what it CAN do is read the lanes verbatim, exactly as
 * `catalog-api-lane.test.ts` reads its own. The invariant is the one an
 * operator trips by exporting `CATALOG_API_ORIGIN=http://localhost:8787` for a
 * local experiment: those requests carry a real Neon Auth access token, so the
 * origin has to be refused before the token is sent, not after.
 *
 * The check that matters most is the LAST one. A guard on one lane is a guard
 * one new lane forgets, so `lane-origin.ts` is the single door and this asserts
 * that it stays single: any lane resolving `process.env.CATALOG_API_ORIGIN` for
 * itself is a second door, and a second door is one nobody guarded.
 *
 * test-type: unit (reads checked-in files; no network, no clock).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";

/** One file of the staging lane directory, read verbatim. */
function laneFile(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../api-test/${name}`, import.meta.url)), "utf8");
}

/** Every lane `pnpm run test:catalog-api` actually executes. */
const LANE_SUITES = [
  "catalog-api.test.ts",
  "agent-turn.test.ts",
  "web-search-turn.test.ts",
  "byok-probe.test.ts",
];

const DOOR = laneFile("lane-origin.ts");
const LANE = laneFile("web-search-turn.test.ts");
const RUNBOOK = readFileSync(fileURLToPath(new URL("../api-test/README.md", import.meta.url)), "utf8");
const TOOL = readFileSync(fileURLToPath(new URL("../src/agent/tools/web-search-tool.ts", import.meta.url)), "utf8");
const SEARCHER = readFileSync(fileURLToPath(new URL("../src/agent/tools/duckduckgo-web-searcher.ts", import.meta.url)), "utf8");
const EGRESS = readFileSync(fileURLToPath(new URL("../src/agent/egress/egress-decision.ts", import.meta.url)), "utf8");

/** The body of the shared `laneOrigin()`, the one door every request uses. */
function originFunction(): string {
  const start = DOOR.indexOf("export function laneOrigin(): string {");
  assert.notEqual(start, -1, "the lanes must resolve their origin in one named place");
  return DOOR.slice(start, DOOR.indexOf("\n}", start));
}

void test("the shared door refuses a non-HTTPS origin, where the origin is read", () => {
  assert.match(originFunction(), /"https:"/);
  assert.match(originFunction(), /new URL\(ORIGIN\)\.protocol/);
});

void test("no lane opens a second door onto the origin or the credential", () => {
  const own = LANE_SUITES.filter((name) => /process\.env\.(CATALOG_API_ORIGIN|AGENT_TURN_BEARER)/.test(laneFile(name)));
  assert.deepEqual(own, [], "these lanes read the environment instead of lane-origin.ts");
});

void test("every lane that makes a request resolves it through that door", () => {
  const importing = LANE_SUITES.filter((name) => laneFile(name).includes('from "./lane-origin.ts"'));
  assert.deepEqual(importing, LANE_SUITES);
});

void test("every request the web-search lane makes goes through the door", () => {
  const requests = [...LANE.matchAll(/`\$\{origin\(\)\}/g)];
  const urls = [...LANE.matchAll(/fetch\(\s*`/g)];
  assert.equal(requests.length, urls.length);
  assert.ok(urls.length > 0, "the lane makes no requests at all");
});

void test("the door still refuses to guess an origin or a credential", () => {
  assert.match(DOOR, /assert\.ok\(ORIGIN,/);
  assert.match(DOOR, /assert\.ok\(BEARER,/);
});

/**
 * `Search failed for …` is one sentence covering four different causes, and the
 * runbook is the only place an operator learns to tell them apart. These pin it
 * to the code: a detail the runbook explains but nothing produces would send
 * somebody hunting a failure mode that does not exist, and a detail the code
 * produces but the runbook omits is the one they will misdiagnose.
 */
void test("the runbook does not read one failure sentence as one diagnosis", () => {
  assert.match(RUNBOOK, /that is ALL it means on its own/);
  assert.match(RUNBOOK, /web_search_failed/, "the server-side half has to be findable too");
});

void test("every failure detail the runbook explains is one the code can produce", () => {
  const source = `${TOOL}${SEARCHER}${EGRESS}`;
  const documented = ["egress denied: ", "search backend answered ", "the search timed out"];
  const produced = documented.filter((detail) => RUNBOOK.includes(detail) && source.includes(detail));
  assert.deepEqual(produced, documented);
});

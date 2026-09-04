/**
 * W2-1 (#1287) lane contract: the web-search staging lane cannot leak its
 * bearer token onto a plaintext wire.
 *
 * `api-test/` talks to a real deployed origin, so this suite cannot execute it
 * — what it CAN do is read the lane verbatim, exactly as
 * `catalog-api-lane.test.ts` reads its own. The invariant here is the one an
 * operator trips by exporting `CATALOG_API_ORIGIN=http://localhost:8787` for a
 * local experiment: every request in that file carries a real Neon Auth access
 * token, so the origin has to be refused before the token is sent, not after.
 *
 * test-type: unit (reads a checked-in file; no network, no clock).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";

const LANE = readFileSync(fileURLToPath(new URL("../api-test/web-search-turn.test.ts", import.meta.url)), "utf8");
const RUNBOOK = readFileSync(fileURLToPath(new URL("../api-test/README.md", import.meta.url)), "utf8");
const TOOL = readFileSync(fileURLToPath(new URL("../src/agent/tools/web-search-tool.ts", import.meta.url)), "utf8");
const SEARCHER = readFileSync(fileURLToPath(new URL("../src/agent/tools/duckduckgo-web-searcher.ts", import.meta.url)), "utf8");
const EGRESS = readFileSync(fileURLToPath(new URL("../src/agent/egress/egress-decision.ts", import.meta.url)), "utf8");

/** The body of the lane's own `origin()`, the single door every request uses. */
function originFunction(): string {
  const start = LANE.indexOf("function origin(): string {");
  assert.notEqual(start, -1, "the lane must resolve its origin in one named place");
  const end = LANE.indexOf("\n}", start);
  return LANE.slice(start, end);
}

void test("the lane refuses a non-HTTPS origin, and does it where the origin is read", () => {
  assert.match(originFunction(), /"https:"/);
  assert.match(originFunction(), /new URL\(ORIGIN\)\.protocol/);
});

void test("every request the lane makes resolves its origin through that one door", () => {
  const requests = [...LANE.matchAll(/`\$\{origin\(\)\}/g)];
  const urls = [...LANE.matchAll(/fetch\(\s*`/g)];
  assert.equal(requests.length, urls.length);
  assert.ok(urls.length > 0, "the lane makes no requests at all");
});

void test("the lane still refuses to guess an origin or a credential", () => {
  assert.match(LANE, /assert\.ok\(ORIGIN,/);
  assert.match(LANE, /assert\.ok\(BEARER,/);
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

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import { ADOPT_TURN_KEY_PREFIX } from "../src/identity/session-adoption-marker.ts";

const STORE_SOURCE = readFileSync(
  fileURLToPath(new URL("../src/identity/session-adoption-store.ts", import.meta.url)), "utf8",
);
const FIXTURE_SOURCE = readFileSync(
  fileURLToPath(new URL("../agent-db-test/session-adoption-fixture.ts", import.meta.url)), "utf8",
);

function insertCteSource(): string {
  const start = STORE_SOURCE.indexOf("function insertCte");
  const end = STORE_SOURCE.indexOf("function adoptionStatement");
  return STORE_SOURCE.slice(start, end);
}

void test("adoption markers ignore a concurrent next-revision reservation", () => {
  const insertSource = insertCteSource();
  assert.match(insertSource, /ON CONFLICT ON CONSTRAINT turn_reservations_session_revision DO NOTHING/);
  assert.doesNotMatch(insertSource, /ON CONFLICT\s*\(/);
});

// The disposable-database fixture installs a conflict trigger whose pattern
// must recognize the production adoption marker. The fixture cannot be imported
// here — importing it registers the PostgreSQL lifecycle hooks — so the
// derivation is pinned on its source: the pattern interpolates the exported
// prefix (never a hard-coded copy), and the prefix carries no character that
// could escape the SQL literal it lands in.
void test("the adoption conflict trigger derives its marker pattern from the exported prefix", () => {
  assert.match(ADOPT_TURN_KEY_PREFIX, /^[a-z_]+:$/);
  assert.match(FIXTURE_SOURCE, /LIKE '\$\{ADOPT_TURN_KEY_PREFIX\}%'/);
  assert.doesNotMatch(FIXTURE_SOURCE, /LIKE 'adopt:/);
});

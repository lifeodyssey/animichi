import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { executeSelection } from "@animichi/agent/selection";
import { catalogClock, GUARDED_TEST_TIMEOUT_MS, settledWithin } from "./catalog-clock.ts";
import { multiCatalog, selectionFixture } from "./native-selection-fixture.ts";

void test("multi-work selection fetches concurrently, deduplicates points in pick order and discloses omitted works", { timeout: GUARDED_TEST_TIMEOUT_MS }, async (context) => {
  catalogClock(context);
  const { repo, entries, revision } = await selectionFixture("resolve_anime", { outcome: "needs_disambiguation", reason: "anime_ambiguity",
    candidates: [{ bangumi_id: "123", title: "First" }, { bangumi_id: "456", title: "Duplicate" }] });
  const { catalog, planned, first, second, release } = multiCatalog();
  const pending = executeSelection({ of: "candidates", candidateIds: ["123", "456"], clarificationId: revision, locale: "en" }, entries, catalog, BACKGROUND_CONTEXT);
  await settledWithin(Promise.all([first.promise, second.promise]), "the second concurrent catalog fetch of the two selected works");
  release.resolve(undefined);
  const result = await settledWithin(pending, "the merged multi-work selection result");
  assert.deepEqual(planned, [{ point_ids: ["a", "b"] }]);
  assert.deepEqual(result.omitted, ["Duplicate"]);
  assert.equal(result.response.message, "Selected works were merged and routed. Omitted works: Duplicate.");
  assert.equal(result.status, "ok");
  await repo.close(BACKGROUND_CONTEXT);
});

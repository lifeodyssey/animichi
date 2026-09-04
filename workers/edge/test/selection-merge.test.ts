/**
 * The two boundary rules a pick's own inputs turn on (review of #1296).
 *
 * Both are places where a port of Python read as faithful and was not: one
 * counted a work as contributing when the merge was identical without it, the
 * other let `Number("")` stand in for a coordinate Python's `float("")` would
 * have refused.
 *
 * test-type: unit (pure; no clock, no network, no database).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mergedWorks, omittedTitles } from "../src/agent/selection/merged-works.ts";
import { coordinateOrigin } from "../src/agent/selection/selected-itinerary.ts";
import { SATTE, UJI_BRIDGE, WASHINOMIYA } from "./doubles/catalog-payloads.ts";

const SYNCED = "2026-09-01T00:00:00Z";

/** One work's catalog answer. */
function fetchedWork(bangumiId: string, rows: typeof WASHINOMIYA[], partial = false) {
  return { bangumiId, result: { rows, synced_at: SYNCED, partial } };
}

void test("a work whose every spot an earlier work already merged is omitted", () => {
  const fetched = [fetchedWork("1", [WASHINOMIYA, SATTE]), fetchedWork("2", [WASHINOMIYA])];
  const merged = mergedWorks(["1", "2"], fetched, "ja");
  assert.deepEqual(merged.omittedIds, ["2"]);
  assert.equal(merged.payload.row_count, 2);
});

void test("a work omitted for adding nothing distinct makes the merge partial", () => {
  const fetched = [fetchedWork("1", [WASHINOMIYA]), fetchedWork("2", [WASHINOMIYA])];
  assert.equal(mergedWorks(["1", "2"], fetched, "ja").payload.partial, true);
});

void test("a work that adds one new spot among duplicates still contributes", () => {
  const fetched = [fetchedWork("1", [WASHINOMIYA]), fetchedWork("2", [WASHINOMIYA, UJI_BRIDGE])];
  const merged = mergedWorks(["1", "2"], fetched, "ja");
  assert.deepEqual([merged.omittedIds, merged.payload.row_count, merged.payload.partial], [[], 2, false]);
});

void test("a work the catalog could not serve at all is omitted", () => {
  const merged = mergedWorks(["1", "2"], [fetchedWork("1", [WASHINOMIYA])], "ja");
  assert.deepEqual(merged.omittedIds, ["2"]);
});

void test("duplicate rows inside one work's own answer are merged once", () => {
  const merged = mergedWorks(["1"], [fetchedWork("1", [WASHINOMIYA, WASHINOMIYA])], "ja");
  assert.deepEqual([merged.payload.row_count, merged.omittedIds], [1, []]);
});

void test("a still-syncing work makes the merge partial even when it contributed", () => {
  const fetched = [fetchedWork("1", [WASHINOMIYA], true)];
  assert.equal(mergedWorks(["1"], fetched, "ja").payload.partial, true);
});

void test("omitted works are named by the titles the question offered them under", () => {
  const offered = [{ id: "2", title: "らき☆すた OVA" }];
  assert.deepEqual(omittedTitles(["2", "9"], offered), ["らき☆すた OVA", "9"]);
});

void test("a coordinate origin with a blank component is no origin at all", () => {
  assert.equal(coordinateOrigin(","), undefined);
  assert.equal(coordinateOrigin(" , "), undefined);
  assert.equal(coordinateOrigin("35.0,"), undefined);
  assert.equal(coordinateOrigin(",135.0"), undefined);
});

void test("a real coordinate pair is still read, spaces and all", () => {
  assert.deepEqual(coordinateOrigin(" 35.0 , 135.0 "), { lat: 35, lng: 135 });
});

void test("a place name, a malformed pair and an out-of-range pair are all no origin", () => {
  assert.equal(coordinateOrigin("秩父"), undefined);
  assert.equal(coordinateOrigin("35,135,1"), undefined);
  assert.equal(coordinateOrigin("91,135"), undefined);
  assert.equal(coordinateOrigin(null), undefined);
});

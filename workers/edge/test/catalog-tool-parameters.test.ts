/**
 * W1-4 (#1253): the four catalog tools' parameter surface, validated by pi
 * itself.
 *
 * The assertions run through `validateToolArguments` — the same function
 * `pi-agent-core`'s loop calls before `execute` — so this proves the generated
 * JSON Schema is one pi can compile, not merely one that looks right. That is
 * also where the rejection text comes from: pi formats it, so a tool cannot
 * quietly grow a second validation path with its own wording.
 *
 * test-type: unit (no network, no clock, no bindings).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { catalogToolbox } from "../src/agent/tools/catalog-toolbox.ts";
import { makeCatalogToolSession } from "./doubles/make-catalog-tool-session.ts";
import { scriptedCatalog } from "./doubles/scripted-catalog.ts";

const TOOLS = catalogToolbox(scriptedCatalog({}).catalog, makeCatalogToolSession());

/** The tool the model would call by that name. */
function tool(name: string) {
  const found = TOOLS.find((candidate) => candidate.name === name);
  assert.ok(found, `no tool named ${name}`);
  return found;
}

/** The arguments pi accepts for that call, after its own coercion. */
function accepted(name: string, args: object): unknown {
  return validateToolArguments(tool(name), { type: "toolCall", id: "call-1", name, arguments: args });
}

/** Assert pi rejects that call, with the wording pi itself produces. */
function rejects(name: string, args: object, wording: RegExp): void {
  assert.throws(() => accepted(name, args), wording);
}

void test("every catalog tool is registered under the name Python used", () => {
  assert.deepEqual(TOOLS.map((entry) => entry.name), [
    "resolve_anime",
    "search_bangumi",
    "search_nearby",
    "plan_route",
  ]);
});

void test("resolve_anime takes a title and refuses an empty one", () => {
  assert.deepEqual(accepted("resolve_anime", { title: "らき☆すた" }), { title: "らき☆すた" });
  rejects("resolve_anime", { title: "" }, /title: must not have fewer than 1 characters/);
  rejects("resolve_anime", {}, /title: must have required properties title/);
});

void test("search_bangumi takes a numeric work id and refuses a title", () => {
  assert.deepEqual(accepted("search_bangumi", { bangumi_id: "115908" }), { bangumi_id: "115908" });
  rejects("search_bangumi", { bangumi_id: "hyouka" }, /bangumi_id: must match pattern/);
  rejects("search_bangumi", {}, /must have required properties bangumi_id/);
});

void test("search_bangumi coerces the number a model sometimes sends", () => {
  assert.deepEqual(accepted("search_bangumi", { bangumi_id: 115908 }), { bangumi_id: "115908" });
});

void test("search_nearby takes nothing at all, because GPS may be the location", () => {
  assert.deepEqual(accepted("search_nearby", {}), {});
  assert.deepEqual(accepted("search_nearby", { location: "久喜" }), { location: "久喜" });
});

void test("search_nearby refuses a radius that cannot describe an area", () => {
  rejects("search_nearby", { radius_m: 0 }, /radius_m: must be > 0/);
  rejects("search_nearby", { radius_m: -5 }, /radius_m: must be > 0/);
});

void test("search_nearby drops the null a model sends for an absent location", () => {
  assert.deepEqual(accepted("search_nearby", { location: null }), {});
});

void test("plan_route requires the ref and accepts only the catalog's pacing words", () => {
  assert.deepEqual(accepted("plan_route", { search_result_ref: "search:2:1", pacing: "chill" }), {
    search_result_ref: "search:2:1",
    pacing: "chill",
  });
  rejects("plan_route", { pacing: "normal" }, /must have required properties search_result_ref/);
  rejects("plan_route", { search_result_ref: "search:2:1", pacing: "brisk" }, /pacing: must be/);
});

void test("no tool accepts an argument it never declared", () => {
  rejects("resolve_anime", { title: "K-On!", limit: 3 }, /must not have additional properties/);
});

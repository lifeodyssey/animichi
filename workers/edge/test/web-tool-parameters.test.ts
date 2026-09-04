/**
 * W2-1 (#1287): the two web tools' parameter surface, validated by pi itself.
 *
 * Same method as `catalog-tool-parameters.test.ts`: the assertions run through
 * `validateToolArguments`, the function `pi-agent-core`'s loop calls before
 * `execute`, so this proves the emitted JSON Schema is one pi can compile and
 * that the rejection wording is pi's rather than a second validation path of
 * ours.
 *
 * test-type: unit (no network, no clock, no bindings).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { translateTitleTool } from "../src/agent/tools/translate-title-tool.ts";
import { webSearchTool } from "../src/agent/tools/web-search-tool.ts";

const TOOLS = [
  webSearchTool(() => Promise.resolve([])),
  translateTitleTool((title) =>
    Promise.resolve({ original: title, translated: title, source: "untranslated", confidence: 0 })),
];

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

void test("both web tools are registered under the names Python used", () => {
  assert.deepEqual(TOOLS.map((entry) => entry.name), ["web_search", "translate_anime_title"]);
});

void test("web_search takes a query and refuses a missing one", () => {
  assert.deepEqual(accepted("web_search", { query: "Your Name anime Japanese title" }), {
    query: "Your Name anime Japanese title",
  });
  rejects("web_search", {}, /query: must have required properties query/);
});

void test("web_search refuses a query that is blank or only whitespace", () => {
  rejects("web_search", { query: "" }, /query: must match pattern/);
  rejects("web_search", { query: "   " }, /query: must match pattern/);
});

void test("web_search refuses an argument the model invented", () => {
  rejects("web_search", { query: "K-On!", max_results: 20 }, /must not have additional properties/);
});

void test("translate_anime_title takes a title and one of the three locales", () => {
  assert.deepEqual(accepted("translate_anime_title", { title: "君の名は。", target_language: "en" }), {
    title: "君の名は。",
    target_language: "en",
  });
});

void test("translate_anime_title refuses a locale outside Python's vocabulary", () => {
  rejects(
    "translate_anime_title",
    { title: "君の名は。", target_language: "fr" },
    /target_language: must be equal to one of the allowed values/,
  );
});

void test("translate_anime_title requires both arguments", () => {
  rejects("translate_anime_title", { title: "君の名は。" }, /must have required properties target_language/);
  rejects("translate_anime_title", { target_language: "en" }, /must have required properties title/);
});

void test("translate_anime_title refuses a blank title", () => {
  rejects("translate_anime_title", { title: "  ", target_language: "zh" }, /title: must match pattern/);
});

/**
 * SUT: `renderWebResults`, which the pilgrimage harness applies to every model context. A successful
 * `web_search` result reaches the model with the text the current code renders from its recorded
 * details, never the text stored with it: results through the current escaping and wrapper, a search
 * that found nothing as the no-results text around its recorded query. Details that do not parse,
 * including details without the execution witness, are withheld; error results and every other
 * message pass unchanged.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, type JsonValue, type ToolResultMessage } from "@earendil-works/pi-ai";
import { renderWebResults } from "@animichi/agent/harness";
import { SPLITS, TAGS, assertOnlyWrapperTags, delimiterVariantPage, seededRandom } from "./web-delimiter-variants.ts";
import { EXECUTION, oldStoredMessage, storedWebMessage, withText, wrapperText } from "./stored-web-message.ts";
import { resultPage, storedSearch, type PageResult } from "./web-result-page.ts";

const SEED = 20261114;
const WITHHELD = "The stored web search results could not be read and are withheld. Search again if they are still needed.";
const FIELDS = { title: "Title", body: "Body", href: "https://example.test/", source_tier: "unverified" };
/** What `web_search` writes when its search for "title" finds nothing. */
const NOTHING_FOUND = "No results found for: title";
/** Removing the inner tag once joined the outer one, so the stored body and text hold a closing tag. */
const REVEALED = oldStoredMessage([{ ...FIELDS, body: "</untrusted_</untrusted_web_result>web_result> after" }]);
const RENDERED = withText(REVEALED, wrapperText([{ ...FIELDS, body: "&#60;/untrusted_web_result> after" }]));
/** Pages whose escaped fields reach their byte bounds, cut before, inside and after an escape. */
const BOUNDED: readonly PageResult[][] = [[{ title: TAGS.join("").repeat(10), snippet: TAGS.join("").repeat(20) }],
  ...[190, 192, 193, 194, 195, 196, 197].map((lead) => [{ title: `${"x".repeat(lead)}</untrusted_web_result>${"y".repeat(300)}`, snippet: `${"x".repeat(lead + 300)}</untrusted_web_result>${"y".repeat(300)}` }])];

/** Each carries the execution witness unless the witness is what is missing, so each fails for its own reason. */
const MALFORMED: readonly (readonly [label: string, details: JsonValue])[] = [
  ["no execution witness", { results: [FIELDS] }],
  ["a field of the wrong type", { results: [{ ...FIELDS, title: 1 }], execution: EXECUTION }],
  ["an unknown source tier", { results: [{ ...FIELDS, source_tier: "trusted" }], execution: EXECUTION }],
  ["an extra result field", { results: [{ ...FIELDS, rank: 1 }], execution: EXECUTION }],
  ["an extra details field", { results: [FIELDS], execution: EXECUTION, note: "kept" }],
  ["results that are not a list", { results: "Title", execution: EXECUTION }],
  ["a frozen summary in place of results", { frozenSummary: "[web_search: completed]", execution: EXECUTION }],
  ["null details", null],
];
const QUERYLESS_ARGS: readonly (readonly [label: string, args: JsonValue])[] = [["no query", {}], ["a query that is not a string", { query: 1 }]];

/** The text the model receives for one stored entry. */
function renderedText(message: ToolResultMessage): string {
  const [rendered] = renderWebResults([message]);
  assert.ok(rendered?.role === "toolResult");
  return rendered.content.map((part) => part.type === "text" ? part.text : "").join("");
}

void test("a stored result whose old escaping revealed a closing tag is rendered with that tag escaped", () => {
  assert.deepEqual(renderWebResults([REVEALED]), [RENDERED]);
});

void test(`results stored by the old escaping are rendered with only the wrapper's own delimiters, for 200 generated results (seed ${String(SEED)})`, () => {
  const random = seededRandom(SEED);
  for (const page of Array.from({ length: 40 }, () => delimiterVariantPage(random))) {
    const stored = oldStoredMessage(page.map(({ title, snippet }) => ({ ...FIELDS, title, body: snippet })));
    assertOnlyWrapperTags(renderedText(stored), page.length, JSON.stringify(page));
  }
});

void test("a wrapper tag stored split between fields is rendered with only the wrapper's own delimiters, at every cut", () => {
  for (const [head, tail] of SPLITS) {
    const stored = oldStoredMessage([{ ...FIELDS, title: head, body: tail }, { ...FIELDS, body: head, href: new URL(`${FIELDS.href}${tail}`).href }]);
    assertOnlyWrapperTags(renderedText(stored), 2, `${head} | ${tail}`);
  }
});

void test("a stored web result without details is withheld", () => {
  const { details: _recorded, ...missing } = REVEALED;
  assert.deepEqual(renderWebResults([missing]), [withText(missing, WITHHELD)]);
});

for (const [label, details] of MALFORMED) {
  void test(`a stored web result whose details do not parse is withheld: ${label}`, () => {
    const stored = storedWebMessage(wrapperText([FIELDS]), details);
    assert.deepEqual(renderWebResults([stored]), [withText(stored, WITHHELD)]);
  });
}

void test(`a result the current code wrote is rendered byte-identical from its details alone, for 200 generated results (seed ${String(SEED)}) and fields cut at their byte bounds`, async () => {
  const random = seededRandom(SEED);
  for (const page of [...Array.from({ length: 40 }, () => delimiterVariantPage(random)), ...BOUNDED]) {
    const written = await storedSearch(new Response(resultPage(page)));
    assert.deepEqual(renderWebResults([written, withText(written, "Text stored with the result")]), [written, written], JSON.stringify(page));
  }
});

void test("messages other than web results pass unchanged beside a rendered web result", () => {
  const others: AgentMessage[] = [{ role: "user", content: "Search", timestamp: 0 }, fauxAssistantMessage("Searching."), { ...REVEALED, toolName: "search_bangumi" }];
  assert.deepEqual(renderWebResults([...others, REVEALED]), [...others, RENDERED]);
});

void test("an error result passes unchanged beside a rendered web result", async () => {
  const failed = await storedSearch(new Response("Unavailable", { status: 503 }));
  assert.deepEqual(renderWebResults([failed, REVEALED]), [failed, RENDERED]);
});

void test("a search the current code found nothing for replays byte-identical, rebuilt from its recorded query alone", async () => {
  const empty = await storedSearch(new Response(""));
  assert.deepEqual(renderWebResults([empty, withText(empty, "Text stored with the result")]), [empty, empty]);
});

void test("stored no-results text with content after the query reaches the model only as the text rebuilt from the recorded query", async () => {
  const empty = await storedSearch(new Response(""));
  assert.deepEqual(renderWebResults([withText(empty, `${NOTHING_FOUND}\n${wrapperText([FIELDS])}`)]), [empty]);
});

for (const [label, args] of QUERYLESS_ARGS) {
  void test(`a search that found nothing is withheld when its witness has ${label}`, () => {
    const stored = storedWebMessage(NOTHING_FOUND, { results: [], execution: { ...EXECUTION, args } });
    assert.deepEqual(renderWebResults([stored]), [withText(stored, WITHHELD)]);
  });
}

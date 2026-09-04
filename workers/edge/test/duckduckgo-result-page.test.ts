/**
 * W2-1 (#1287): reading a real DuckDuckGo results page.
 *
 * The parse is the brittle half of the search adapter, so it is the half held
 * against somebody else's ACTUAL markup (`doubles/duckduckgo-result-markup.ts`,
 * captured 2026-09-04) rather than against a tidied idea of it. The synthetic
 * cases below cover only what that capture happens not to contain.
 *
 * test-type: unit (no network; the page is a committed capture).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { duckduckgoResults } from "../src/agent/tools/duckduckgo-result-page.ts";
import { MEASURED_RESULT_PAGE, makeResultPage } from "./doubles/duckduckgo-result-markup.ts";

void test("every result of the measured page is read, in DuckDuckGo's own order", () => {
  const results = duckduckgoResults(MEASURED_RESULT_PAGE);
  assert.equal(results.length, 3);
  assert.deepEqual(
    results.map((result) => new URL(result.href).hostname),
    ["zh.wikipedia.org", "zh.wikipedia.org", "bangumi.pro"],
  );
});

void test("a title is the anchor's text, not its markup", () => {
  const [first] = duckduckgoResults(MEASURED_RESULT_PAGE);
  assert.equal(first?.title, "吹响吧!上低音号 - 维基百科，自由的百科全书");
});

void test("the snippet's own highlighting is dropped and its escaping decoded", () => {
  const results = duckduckgoResults(MEASURED_RESULT_PAGE);
  const body = results[2]?.body ?? "";
  assert.ok(body.includes('"Sound! Euphonium"'), `&quot; survived: ${body}`);
  assert.ok(!body.includes("<b>"), `highlighting survived: ${body}`);
  assert.ok(body.includes("響け! ユーフォニアム ドラマCD"), body);
});

void test("a numeric character reference is decoded too", () => {
  const [first] = duckduckgoResults(MEASURED_RESULT_PAGE);
  assert.ok(first, "the measured page has a first result");
  assert.ok(first.body.includes("的'吹响吧!"), first.body);
});

void test("a result with no snippet anchor keeps an empty body, not the next one's", () => {
  const results = duckduckgoResults(
    makeResultPage([
      { href: "https://a.example/", title: "First" },
      { href: "https://b.example/", title: "Second", snippet: "Second body" },
    ]),
  );
  assert.deepEqual(
    results.map((result) => [result.title, result.body]),
    [
      ["First", ""],
      ["Second", "Second body"],
    ],
  );
});

void test("a link behind DuckDuckGo's redirector is read as the site it points at", () => {
  const wrapped = "//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FUji&rut=abc";
  const results = duckduckgoResults(makeResultPage([{ href: wrapped, title: "Uji", snippet: "b" }]));
  assert.equal(results[0]?.href, "https://en.wikipedia.org/wiki/Uji");
});

void test("an anchor with no href is not a result", () => {
  const page = '<a class="result__a">Untargeted</a>';
  assert.deepEqual(duckduckgoResults(page), []);
});

void test("a page with no results at all reads as none, never as a throw", () => {
  assert.deepEqual(duckduckgoResults("<html><body>anomaly detected</body></html>"), []);
});

void test("an entity the endpoint never emits is left exactly as it was written", () => {
  const results = duckduckgoResults(
    makeResultPage([{ href: "https://a.example/", title: "&notanentity;", snippet: "&#x110000;" }]),
  );
  assert.deepEqual(
    results.map((result) => [result.title, result.body]),
    [["&notanentity;", "&#x110000;"]],
  );
});

/**
 * SUT: how `web_search` decodes a search page within its byte limit. However the body is cut into
 * chunks, through the middle of multi-byte characters included, it records the results the
 * whole-body read recorded: an invalid byte, and a page that ends mid-character, each decode to
 * U+FFFD exactly as `Response.text()` decodes them.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { chunksOf, searchedWith, servedResponse } from "./served-search-response.ts";

const ENCODER = new TextEncoder();
const REDIRECTED = `//duckduckgo.com/l/?uddg=${encodeURIComponent("https://ja.wikipedia.org/wiki/響け")}`;

/** Two results: Japanese, an emoji, an accent, an entity and an invalid byte, then a snippet the page cuts mid-character. */
const PAGE = new Uint8Array([
  ...ENCODER.encode(`<div class="result"><a class="result__a" href="${REDIRECTED}">響け！ユーフォニアム 🎺 café</a><a class="result__snippet">京都アニメーション&#x27;s <b>Euphonium</b> `),
  0xff,
  ...ENCODER.encode(' 続き</a></div><div class="result"><a class="result__a" href="https://example.test/">Cut mid-character</a><a class="result__snippet">まだ続'),
  ...ENCODER.encode("く").subarray(0, 2),
]);

/** What the whole-body read, `response.text()`, recorded for that page before the body was read as a stream. */
const RECORDED = { results: [
  { title: "響け！ユーフォニアム 🎺 café", body: "京都アニメーション's Euphonium \u{fffd} 続き", href: "https://ja.wikipedia.org/wiki/%E9%9F%BF%E3%81%91", source_tier: "verified" },
  { title: "Cut mid-character", body: "まだ続\u{fffd}", href: "https://example.test/", source_tier: "unverified" },
] };

const DELIVERIES: readonly (readonly [label: string, chunks: readonly Uint8Array[]])[] = [
  ["in one chunk", [PAGE]],
  ["one byte per chunk", chunksOf(PAGE, 1)],
  ["in chunks of two bytes", chunksOf(PAGE, 2)],
  ["in chunks of three bytes", chunksOf(PAGE, 3)],
];

for (const [label, chunks] of DELIVERIES) {
  void test(`web search records a page that arrives ${label} as the whole-body read recorded it`, async () => {
    assert.deepEqual((await searchedWith(servedResponse(chunks).response)).details, RECORDED);
  });
}

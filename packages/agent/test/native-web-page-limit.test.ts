/**
 * SUT: the byte limit `web_search` puts on the search response body it reads. A body of up to
 * WEB_SEARCH_PAGE_MAX_BYTES bytes is parsed. Past it, whatever the Content-Length says, reading
 * stops, the body is cancelled, no part of it is parsed, and the call fails as a refusal fails.
 */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Parser } from "htmlparser2";
import { WEB_SEARCH_PAGE_MAX_BYTES as LIMIT } from "@animichi/agent/tools";
import { refusal, searchedWith, servedResponse } from "./served-search-response.ts";
import { resultPage } from "./web-result-page.ts";

const ENCODER = new TextEncoder();
const PAGE = resultPage([{ title: "A result inside the limit", snippet: "Its snippet" }]);
const RECORDED = { results: [{ title: "A result inside the limit", body: "Its snippet", href: "https://example.test/", source_tier: "unverified" }] };
const CHUNK = 65_536;
/** The page, then chunks of spaces until the body runs four chunks past the limit. */
const OVERSIZED = [ENCODER.encode(PAGE), ...Array.from({ length: Math.ceil(LIMIT / CHUNK) + 4 }, () => new Uint8Array(CHUNK).fill(0x20))];
const OVERSIZED_BYTES = OVERSIZED.reduce((total, chunk) => total + chunk.byteLength, 0);

const UNDECLARED: readonly (readonly [label: string, headers: HeadersInit | undefined])[] = [
  ["without a Content-Length", undefined],
  ["whose Content-Length understates it", { "Content-Length": "1" }],
];

/** The page followed by as many `filler` characters as it takes to reach at least `bytes` UTF-8 bytes. */
function paddedPage(bytes: number, filler: string): string {
  return PAGE + filler.repeat(Math.ceil((bytes - ENCODER.encode(PAGE).length) / ENCODER.encode(filler).length));
}

/** Searches with `served`, then asserts the call failed as a refusal does, cancelled the body and parsed none of it. */
async function assertRefusedUnparsed(context: TestContext, served: ReturnType<typeof servedResponse>) {
  const parse = context.mock.method(Parser.prototype, "end");
  const { isError, content } = await searchedWith(served.response);
  assert.deepEqual({ isError, content }, await refusal());
  assert.equal(served.cancelled(), true, "the unread rest of the body must be cancelled");
  assert.equal(parse.mock.callCount(), 0, "no part of a body past the limit may be parsed");
}

for (const [label, headers] of UNDECLARED) {
  void test(`web search treats a body past its byte limit ${label} as a refusal: reading stops, the body is cancelled, nothing is parsed`, async (context) => {
    const served = servedResponse(OVERSIZED, headers);
    await assertRefusedUnparsed(context, served);
    assert.ok(served.served() < OVERSIZED_BYTES, "reading must stop at the limit, not at the end of the body");
  });
}

void test("web search parses a body of exactly its byte limit", async (context) => {
  const page = paddedPage(LIMIT, "x");
  const parse = context.mock.method(Parser.prototype, "end");
  assert.equal(ENCODER.encode(page).length, LIMIT);
  assert.deepEqual((await searchedWith(new Response(page))).details, RECORDED);
  assert.equal(parse.mock.callCount(), 1, "the parse spy sees a page that is parsed");
});

void test("web search treats one chunk a byte past its limit as a refusal, without decoding that chunk", async (context) => {
  const chunk = ENCODER.encode(paddedPage(LIMIT + 1, "x"));
  const decode = context.mock.method(TextDecoder.prototype, "decode");
  assert.equal(chunk.length, LIMIT + 1);
  await assertRefusedUnparsed(context, servedResponse([chunk]));
  assert.ok(!decode.mock.calls.some((call) => call.arguments[0] === chunk), "the chunk that would pass the limit must not be decoded");
});

void test("web search counts its byte limit in UTF-8 bytes, not characters", async (context) => {
  const page = paddedPage(LIMIT + 1, "あ");
  assert.ok(page.length <= LIMIT, "counted in characters, the page is within the limit");
  await assertRefusedUnparsed(context, servedResponse([ENCODER.encode(page)]));
});

void test("web search reads a 200 response without a body as a search that found nothing", async () => {
  const message = await searchedWith(new Response(null));
  assert.deepEqual(message.details, { results: [] });
  assert.deepEqual(message.content, [{ type: "text", text: "No results found for: title" }]);
});

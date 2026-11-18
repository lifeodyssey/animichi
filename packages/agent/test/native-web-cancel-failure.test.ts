/**
 * SUT: what `web_search` returns when a body it abandons cannot be cancelled. The release is best
 * effort: on a page past the byte limit and on a refusal alike, a cancel that fails still ends in
 * the native tool error every other upstream fault gives, and the release is still attempted.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { WEB_SEARCH_PAGE_MAX_BYTES as LIMIT } from "@animichi/agent/tools";
import { refusal, searchedWith, uncancellableResponse } from "./served-search-response.ts";

const ABANDONED: readonly (readonly [label: string, chunks: readonly Uint8Array[], status: number])[] = [
  ["a page past its byte limit", [new Uint8Array(LIMIT + 1).fill(0x20)], 200],
  ["a refusal", [new TextEncoder().encode("Anti-bot")], 202],
];

for (const [label, chunks, status] of ABANDONED) {
  void test(`web search returns the shared upstream failure for ${label} whose body cannot be cancelled`, async () => {
    const uncancellable = uncancellableResponse(chunks, status);
    const { isError, content } = await searchedWith(uncancellable.response);
    assert.deepEqual({ isError, content }, await refusal());
    assert.equal(uncancellable.cancelAttempted(), true, "the body's release must still be attempted");
  });
}

/**
 * W2-1 (#1287): the search backend's way out of the Worker.
 *
 * `web_search` is the first thing in `src/` that talks to the public internet,
 * so the claim under test is spec Appendix D's: it leaves through the SAME
 * guard BYOK egress uses, against an allowlist of its own, and there is no path
 * from the adapter to a host that is not on it.
 *
 * The `fetch` double is the BYOK suite's own `ScriptedEgressFetch`, which
 * returns real `Response` objects and records the `RequestInit` — so "the
 * redirect was re-validated" is asserted on what the guard actually sent, not
 * on a promise that it would.
 *
 * test-type: unit (scripted transport; no network).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { EgressDeniedError } from "../src/agent/egress/egress-decision.ts";
import {
  WEB_SEARCH_ALLOWLIST,
  WEB_SEARCH_EGRESS_POLICY,
  WEB_SEARCH_HOST,
  webSearchFetch,
} from "../src/agent/egress/web-search-egress.ts";
import { DUCKDUCKGO_SEARCH_URL, duckduckgoWebSearcher } from "../src/agent/tools/duckduckgo-web-searcher.ts";
import { webSearchTool } from "../src/agent/tools/web-search-tool.ts";
import { MEASURED_RESULT_PAGE } from "./doubles/duckduckgo-result-markup.ts";
import { ScriptedEgressFetch, type ScriptedAnswer } from "./doubles/scripted-egress-fetch.ts";
import { unspentBudget } from "./doubles/make-tool-budget.ts";

/** The one destination this policy allows, whichever family asks. */
function decide(url: string) {
  return WEB_SEARCH_EGRESS_POLICY.decide({ provider: "openai", baseUrl: url, key: "k" });
}

const SEARCH_QUERY = "響け！ユーフォニアム 中文名";

/** One search through the guard, over a scripted transport. */
function searchThrough(answers: readonly ScriptedAnswer[]) {
  const transport = new ScriptedEgressFetch(answers);
  const searcher = duckduckgoWebSearcher(webSearchFetch(transport.fetch));
  return { transport, search: () => searcher(SEARCH_QUERY) };
}

/** The URL of the hop the guard actually made. */
function requestedUrl(transport: ScriptedEgressFetch): string {
  const [url] = transport.urls;
  assert.ok(url, "the guard made no request at all");
  return url;
}

void test("the search backend's own host is the only destination allowed", () => {
  assert.equal(decide(`https://${WEB_SEARCH_HOST}/html/?q=x`).allowed, true);
  assert.deepEqual(decide("https://api.openai.com/v1/chat"), {
    allowed: false,
    reason: "host_not_allowlisted",
  });
});

void test("no BYOK provider family can be pointed at anything else through it", () => {
  const families = ["openai", "anthropic", "google"] as const;
  const hosts = families.map((family) => WEB_SEARCH_ALLOWLIST.allows(family, "api.anthropic.com"));
  assert.deepEqual(hosts, [false, false, false]);
});

void test("the address red lines still apply to the search hop", () => {
  assert.deepEqual(decide("https://169.254.169.254/html/"), { allowed: false, reason: "metadata_address" });
  assert.deepEqual(decide("http://html.duckduckgo.com/html/"), { allowed: false, reason: "scheme_not_https" });
  assert.deepEqual(decide("https://animichi.com/html/"), { allowed: false, reason: "own_infrastructure" });
});

void test("a real page is fetched from the allowlisted host, with redirects held manually", async () => {
  const { transport, search } = searchThrough([{ status: 200, body: MEASURED_RESULT_PAGE }]);
  const results = await search();
  assert.equal(results.length, 3);
  assert.deepEqual(transport.calls.map((call) => call.redirect), ["manual"]);
  assert.ok(requestedUrl(transport).startsWith(DUCKDUCKGO_SEARCH_URL), requestedUrl(transport));
});

void test("the query rides the URL, encoded rather than interpolated", async () => {
  const { transport, search } = searchThrough([{ status: 200, body: MEASURED_RESULT_PAGE }]);
  await search();
  assert.equal(new URL(requestedUrl(transport)).searchParams.get("q"), SEARCH_QUERY);
});

void test("a redirect off the allowlisted host is refused, not followed", async () => {
  const { transport, search } = searchThrough([
    { status: 302, location: "https://evil.example/steal" },
    { status: 200, body: MEASURED_RESULT_PAGE },
  ]);
  await assert.rejects(search(), (error: unknown) => {
    assert.ok(error instanceof EgressDeniedError);
    assert.equal(error.reason, "host_not_allowlisted");
    return true;
  });
  assert.deepEqual(transport.urls.length, 1, "the refused target must never have been requested");
});

void test("a refusal reaches the model as the failure sentence, never as a tool error", async () => {
  const transport = new ScriptedEgressFetch([{ status: 302, location: "https://169.254.169.254/" }]);
  const searcher = duckduckgoWebSearcher(webSearchFetch(transport.fetch));
  const result = await webSearchTool(searcher, unspentBudget).execute("call-1", { query: "q" }, undefined);
  assert.equal(result.details, "Search failed for 'q': egress denied: metadata_address");
});

void test("a backend that answers with an error status is a failure, not an empty page", async () => {
  const { search } = searchThrough([{ status: 202, body: "" }]);
  await assert.rejects(search(), /search backend answered 202/);
});

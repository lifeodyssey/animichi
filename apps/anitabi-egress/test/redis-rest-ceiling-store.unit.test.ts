import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RedisRestCeilingStore,
  type StoreRequest,
  type StoreTransport,
} from "../src/redis-rest-ceiling-store.ts";

/**
 * The production store (#1810): a Redis-compatible REST endpoint (Upstash
 * style) holding one integer per window. It is a counter and nothing else —
 * no user data, no data-plane credential — and the tests here pin the whole
 * conversation it can have, because that surface is the service's second
 * destination and the only one a credential travels to.
 *
 * Every failure path is a refusal. An answer this adapter cannot read is a
 * store failure, never a grant: the store's whole job is to be believed.
 */

/** Where the tests' store is; the adapter appends its one endpoint. */
const STORE_URL = "https://store.test";
const TOKEN = "a-store-token-the-test-owns";
const WINDOW = "anitabi-egress:upstream-requests:472222";

/** One recorded request: where it went, and everything it carried. */
interface Call {
  readonly url: string;
  readonly init: StoreRequest;
}

/** A transport that records what it was asked and answers with what the test decides. */
function transportDouble(answer: { status: number; body: string }): { transport: StoreTransport; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    transport: (url, init) => {
      calls.push({ url, init });
      return Promise.resolve({ status: answer.status, arrayBuffer: () => encode(answer.body) });
    },
  };
}

function encode(body: string): Promise<ArrayBuffer> {
  return Promise.resolve(new TextEncoder().encode(body).buffer);
}

/** The Upstash pipeline answer for an `INCR` that landed on `count`, and the `EXPIRE` beside it. */
function pipelineAnswer(count: number): { status: number; body: string } {
  return { status: 200, body: JSON.stringify([{ result: count }, { result: 1 }]) };
}

/** The store under test, over a transport that answers `answer`, and the requests it made. */
function storeAnswering(answer: { status: number; body: string }): {
  store: RedisRestCeilingStore;
  calls: Call[];
} {
  const double = transportDouble(answer);
  return { store: new RedisRestCeilingStore({ url: STORE_URL, token: TOKEN, transport: double.transport }), calls: double.calls };
}

void describe("RedisRestCeilingStore", () => {
  void it("increments the window's key in one round trip, and gives that key a life past its own hour", async () => {
    const { store, calls } = storeAnswering(pipelineAnswer(1));
    await store.increment(WINDOW);
    const [call] = calls;
    assert.ok(call !== undefined, "the store must make its one request");
    assert.equal(call.url, `${STORE_URL}/pipeline`);
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(call.init.headers["content-type"], "application/json");
    assert.equal(
      call.init.body,
      JSON.stringify([["INCR", WINDOW], ["EXPIRE", WINDOW, "7200"]]),
      "the increment and the key's expiry are one conversation: a second call is a window that can half-exist",
    );
    assert.equal(calls.length, 1);
  });

  void it("answers with the count the store's own increment returned", async () => {
    const { store } = storeAnswering(pipelineAnswer(42));
    assert.equal(await store.increment(WINDOW), 42);
  });

  void it("sends the token in the authorization header and nowhere else", async () => {
    const { store, calls } = storeAnswering(pipelineAnswer(1));
    await store.increment(WINDOW);
    const [call] = calls;
    assert.ok(call !== undefined);
    assert.equal(call.init.headers.authorization, `Bearer ${TOKEN}`);
    assert.ok(!call.url.includes(TOKEN), "the token must not ride in the URL, where a log would keep it");
    assert.ok(!call.init.body.includes(TOKEN), "the token must not ride in the body either");
  });

  void it("tells the transport to refuse a redirect rather than carry the token through one", async () => {
    const { store, calls } = storeAnswering(pipelineAnswer(1));
    await store.increment(WINDOW);
    assert.equal(calls[0]?.init.redirect, "error");
  });
});

/**
 * Every way a store can fail to answer is a rejection the ceiling turns into a
 * refusal. None of them may read as a count, and none may be swallowed: a
 * store whose failures were tolerated is a ceiling that is not enforced.
 */
void describe("an answer the store cannot give is a refusal", () => {
  void it("refuses the provider's own rejection of the credential", async () => {
    const { store } = storeAnswering({ status: 401, body: '{"error":"Unauthorized"}' });
    await assert.rejects(store.increment(WINDOW), Error, "a 401 must not read as a count");
  });

  void it("refuses a provider fault", async () => {
    const { store } = storeAnswering({ status: 500, body: "upstream connect error" });
    await assert.rejects(store.increment(WINDOW), Error, "a 5xx must not read as a count");
  });

  void it("refuses an error inside the increment's own result", async () => {
    const { store } = storeAnswering({ status: 200, body: JSON.stringify([{ error: "ERR value is not an integer" }]) });
    await assert.rejects(store.increment(WINDOW), Error, "an error element must not read as a count");
  });

  void it("refuses an empty pipeline answer", async () => {
    const { store } = storeAnswering({ status: 200, body: "[]" });
    await assert.rejects(store.increment(WINDOW), Error, "no result is not a count of zero");
  });

  void it("refuses a single-command answer where a pipeline answer was asked for", async () => {
    const { store } = storeAnswering({ status: 200, body: '{"result":1}' });
    await assert.rejects(store.increment(WINDOW), Error, "the shape asked for is the shape that must arrive");
  });

  void it("refuses a result that is not a number", async () => {
    const { store } = storeAnswering({ status: 200, body: JSON.stringify([{ result: "one" }]) });
    await assert.rejects(store.increment(WINDOW), Error, "a count that is not a number is not a count");
  });

  void it("refuses a body that is not JSON at all", async () => {
    const { store } = storeAnswering({ status: 200, body: "<html>gateway timeout</html>" });
    await assert.rejects(store.increment(WINDOW), Error, "an unreadable body must not read as a count");
  });

  void it("refuses when the store cannot be reached at all", async () => {
    const transport: StoreTransport = () => Promise.reject(new Error("connect ECONNREFUSED"));
    const store = new RedisRestCeilingStore({ url: STORE_URL, token: TOKEN, transport });
    await assert.rejects(store.increment(WINDOW), Error, "an unreachable store must reject, not answer zero");
  });
});

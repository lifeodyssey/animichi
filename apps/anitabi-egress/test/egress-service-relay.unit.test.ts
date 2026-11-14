import crypto from "node:crypto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleEgressRequest, type EgressDeps, type UpstreamFetch } from "../src/egress-service.ts";

/**
 * SUT: the relay half of `handleEgressRequest`, for upstream answers a Web
 * `Response` cannot carry as they arrived. A status outside 200-599, or a body
 * on a status that has none, makes the `Response` constructor throw. The relay
 * answers those with its own upstream-failure answer, the marked 504
 * `upstream-timeout`, and still relays verbatim everything it can carry.
 */

const KEY = crypto.randomBytes(48).toString("base64");
const NOW_SECONDS = 1_700_000_000;
const PATH = "/anitabi/lite/2461";
const MIB = 1024 * 1024;

function signedRequest(): Request {
  const signature = crypto.createHmac("sha256", KEY).update(`${String(NOW_SECONDS)}\n${PATH}`).digest("hex");
  return new Request(`https://egress.test${PATH}`, {
    headers: { "x-egress-timestamp": String(NOW_SECONDS), "x-egress-signature": signature },
  });
}

/** An upstream answering `status` with the body `chunks` make up: the shape the relay reads, which no `Response` gates. */
function upstreamAnswering(status: number, chunks: Uint8Array[]): UpstreamFetch {
  return () => Promise.resolve({ status, headers: new Headers(), body: ReadableStream.from(chunks) });
}

function deps(upstreamFetch: UpstreamFetch): EgressDeps {
  return {
    config: { currentKey: KEY, previousKey: null, ceilingPerHour: 100 },
    ceiling: { tryAcquire: () => Promise.resolve("granted") },
    upstreamFetch,
    nowSeconds: () => NOW_SECONDS,
  };
}

/** What a caller reads off the answer: the status, whose answer it is, why it was refused, and how many body bytes came with it. */
async function answerTo(upstreamFetch: UpstreamFetch): Promise<{
  status: number;
  marker: string | null;
  refusal: string | null;
  bodyBytes: number;
}> {
  const res = await handleEgressRequest(signedRequest(), deps(upstreamFetch));
  const body = await res.arrayBuffer();
  return {
    status: res.status,
    marker: res.headers.get("x-egress-response"),
    refusal: res.headers.get("x-egress-refusal"),
    bodyBytes: body.byteLength,
  };
}

/** What a caller classifies a refusal by, and the body that carries its detail. */
async function refusalTo(upstreamFetch: UpstreamFetch): Promise<{
  head: { status: number; marker: string | null; refusal: string | null };
  body: string;
}> {
  const res = await handleEgressRequest(signedRequest(), deps(upstreamFetch));
  const head = { status: res.status, marker: res.headers.get("x-egress-response"), refusal: res.headers.get("x-egress-refusal") };
  return { head, body: await res.text() };
}

/** The relay's own failure, as the caller classifies it. */
const RELAY_FAILURE = { status: 504, marker: "refused-here", refusal: "upstream-timeout" };

/** The `detail` a refusal body names, if any. */
function detailIn(body: string): string | undefined {
  return (JSON.parse(body) as { detail?: string }).detail;
}

const SOME_BYTES = [new TextEncoder().encode('{"points":[]}')];

/** Statuses no response can carry with a body: three that carry none at all, and two outside 200-599. */
const UNCARRIABLE = [
  { status: 204, why: "204, which has no body, arrives with one" },
  { status: 205, why: "205, which has no body, arrives with one" },
  { status: 304, why: "304, which has no body, arrives with one" },
  { status: 600, why: "the status is 600" },
  { status: 999, why: "the status is 999" },
];

void describe("an upstream answer the relay cannot carry", () => {
  for (const { status, why } of UNCARRIABLE) {
    void it(`is refused as the relay's failure, naming the status, when ${why}`, async () => {
      const answer = await refusalTo(upstreamAnswering(status, SOME_BYTES));
      assert.deepEqual(answer.head, RELAY_FAILURE);
      assert.equal(detailIn(answer.body), "upstream-status-not-relayable");
    });
  }

  void it("is refused as the relay's failure, naming the limit, when the body is one byte past 8 MiB", async () => {
    const answer = await refusalTo(upstreamAnswering(200, [new Uint8Array(8 * MIB), new Uint8Array(1)]));
    assert.deepEqual(answer.head, RELAY_FAILURE);
    assert.equal(detailIn(answer.body), "upstream-body-over-limit");
  });

  void it("is refused as the relay's failure with no detail when the request fails outright", async () => {
    const answer = await refusalTo(() => Promise.reject(new Error("connection reset")));
    assert.deepEqual(answer.head, RELAY_FAILURE);
    assert.equal(detailIn(answer.body), undefined);
  });
});

void describe("an upstream answer the relay can carry", () => {
  void it("relays a 204 with no body verbatim", async () => {
    const answer = await answerTo(upstreamAnswering(204, []));
    assert.deepEqual(answer, { status: 204, marker: "relayed-upstream", refusal: null, bodyBytes: 0 });
  });

  void it("relays a body of exactly 8 MiB whole", async () => {
    const answer = await answerTo(upstreamAnswering(200, [new Uint8Array(8 * MIB)]));
    assert.deepEqual(answer, { status: 200, marker: "relayed-upstream", refusal: null, bodyBytes: 8 * MIB });
  });
});

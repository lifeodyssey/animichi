/**
 * E-1 (#1380): the one thing a caller past the staging perimeter can make
 * arbitrarily expensive, and where it is stopped.
 *
 * The seeding path carries no rate-limit cell — it is deliberately absent from
 * `AGENT_PATHS`, so `classifyRatePolicy` has nothing to classify — which leaves
 * `PREFIX_MAX_BYTES` as the whole of the defence. The cases below are about
 * WHEN it is applied: a bound that admits the body first and weighs it
 * afterwards has already paid for everything it then refuses, and a
 * `Content-Length` is the caller's claim about the caller's own body, absent
 * entirely from a chunked request.
 *
 * test-type: api (request surface of the deployed route).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { PREFIX_MAX_BYTES } from "@animichi/contract/staging-prefix-path";
import { AUTHED, makeStagingPrefixHarness, SEED_PATH } from "./doubles/make-staging-prefix-harness.ts";
import { makePrefixBody } from "./doubles/make-trajectory-prefix.ts";

const encoder = new TextEncoder();

/** A body over `PREFIX_MAX_BYTES`, padded inside the seeded user text. */
function makeOversizedBody(): string {
  const prefix = { ...(makePrefixBody() as Record<string, unknown>), user_text: "あ".repeat(PREFIX_MAX_BYTES) };
  return JSON.stringify(prefix);
}

/** A body padded to exactly the bound — the largest one still admitted. */
function makeBodyAtTheBound(): string {
  const empty = JSON.stringify({ ...(makePrefixBody() as Record<string, unknown>), user_text: "" });
  const room = PREFIX_MAX_BYTES - encoder.encode(empty).length;
  return JSON.stringify({ ...(makePrefixBody() as Record<string, unknown>), user_text: "a".repeat(room) });
}

void test("a seeding body over the cap is refused before any session sees it", async () => {
  const harness = makeStagingPrefixHarness("staging", AUTHED);

  const response = await harness.post(SEED_PATH, makeOversizedBody());

  assert.equal(response.status, 413);
  assert.deepEqual(harness.seeded, []);
});

void test("the cap counts bytes, so a body under it in characters can still be refused", async () => {
  const harness = makeStagingPrefixHarness("staging", AUTHED);
  const body = makeOversizedBody();

  await harness.post(SEED_PATH, body);

  assert.ok(body.length < PREFIX_MAX_BYTES * 2, "the body is well under the cap in characters");
  assert.ok(encoder.encode(body).length > PREFIX_MAX_BYTES, "and over it in bytes");
});

void test("a body weighing exactly the bound is still seeded", async () => {
  const harness = makeStagingPrefixHarness("staging", AUTHED);
  const body = makeBodyAtTheBound();

  const response = await harness.post(SEED_PATH, body);

  assert.equal(encoder.encode(body).length, PREFIX_MAX_BYTES);
  assert.equal(response.status, 200);
  assert.equal(harness.seeded.length, 1);
});

const CHUNK_BYTES = 4096;
/** Four times the bound, so a reader that stops at it stops well short. */
const OFFERED_CHUNKS = (PREFIX_MAX_BYTES / CHUNK_BYTES) * 4;

/** One seeding whose body arrives in chunks and carries no `Content-Length`,
 * with what the Worker actually pulled off it readable afterwards. */
interface ChunkedSeeding {
  readonly request: Request;
  readonly pulled: () => number;
  readonly cancelled: () => boolean;
}

function makeChunkedSeeding(): ChunkedSeeding {
  let pulled = 0;
  let cancelled = false;
  const chunk = encoder.encode("a".repeat(CHUNK_BYTES));
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled += 1;
      if (pulled > OFFERED_CHUNKS) controller.close();
      else controller.enqueue(chunk);
    },
    cancel() { cancelled = true; },
  });
  // Node requires `duplex` for a streamed request body and the workers lib does
  // not declare it; workerd requires nothing. This is the one place it is spelt.
  const init: RequestInit & { duplex: "half" } = { method: "POST", body, duplex: "half" };
  return {
    request: new Request(`https://edge.test${SEED_PATH}`, init),
    pulled: () => pulled,
    cancelled: () => cancelled,
  };
}

void test("a chunked body over the cap is refused with no content-length to judge it by", async () => {
  const harness = makeStagingPrefixHarness("staging", AUTHED);
  const chunked = makeChunkedSeeding();

  const response = await harness.send(chunked.request);

  assert.equal(chunked.request.headers.get("content-length"), null);
  assert.equal(response.status, 413);
  assert.deepEqual(harness.seeded, []);
});

void test("the read stops on the chunk that crosses the bound and the rest is never pulled", async () => {
  const harness = makeStagingPrefixHarness("staging", AUTHED);
  const chunked = makeChunkedSeeding();

  await harness.send(chunked.request);

  // 16 chunks reach the bound; the first `+1` is the chunk that CROSSES it and
  // the second is the app's own pull-ahead (measured 17 reading the stream
  // directly, 18 through `send`). A count past this is the bound regressing; a
  // count of 19 after a runtime upgrade is that pull-ahead, not this module.
  const bounded = PREFIX_MAX_BYTES / CHUNK_BYTES + 2;
  assert.ok(chunked.pulled() <= bounded, "it read the bound and the chunk that crossed it, not more");
  assert.ok(chunked.pulled() < OFFERED_CHUNKS, "and well short of what the caller offered");
  assert.equal(chunked.cancelled(), true);
});

/** A character UTF-8 spells in three bytes, so a chunk boundary can fall
 * inside it — which on a real wire it eventually does. */
const SPLIT_CHARACTER = "あ";

function makeMultibyteBody(): string {
  const seeded = { ...(makePrefixBody() as Record<string, unknown>), user_text: `${SPLIT_CHARACTER}の聖地` };
  return JSON.stringify(seeded);
}

/** That body in two chunks, split one byte INTO the multi-byte character. */
function makeSplitCharacterSeeding(text: string): Request {
  const whole = encoder.encode(text);
  const through = encoder.encode(text.slice(0, text.indexOf(SPLIT_CHARACTER) + 1)).byteLength;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(whole.slice(0, through - 1));
      controller.enqueue(whole.slice(through - 1));
      controller.close();
    },
  });
  const init: RequestInit & { duplex: "half" } = { method: "POST", body, duplex: "half" };
  return new Request(`https://edge.test${SEED_PATH}`, init);
}

void test("a character split across two chunks reaches the session whole", async () => {
  const harness = makeStagingPrefixHarness("staging", AUTHED);
  const body = makeMultibyteBody();

  const response = await harness.send(makeSplitCharacterSeeding(body));

  assert.equal(response.status, 200);
  const seeding = harness.seeded.at(0);
  assert.ok(seeding !== undefined, "the session was handed one request");
  assert.equal(await seeding.text(), body);
});

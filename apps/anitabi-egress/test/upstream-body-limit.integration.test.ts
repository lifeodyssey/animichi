import crypto from "node:crypto";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createServer, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import type { UpstreamFetch } from "../src/upstream-relay.ts";
import { startEgressServer } from "../src/start-egress-server.ts";
import type { CeilingStore } from "../src/upstream-ceiling.ts";

/**
 * SUT: how much of an upstream body the running service holds, over real
 * loopback HTTP. The relay reads the upstream's body as it arrives and stops
 * once it passes 8 MiB: that answer is refused with the relay's own failure
 * answer, the marked 504 `upstream-timeout`, instead of being buffered whole.
 *
 * Two upstreams stand in for the real one. A stream that counts what it is
 * asked for says how far the relay read before it stopped. A loopback server
 * answering a gzip body says the limit counts the bytes the body decodes to,
 * not the bytes on the wire.
 */

const KEY = crypto.randomBytes(48).toString("base64");
const NOW_SECONDS = 1_700_000_000;
const PATH = "/anitabi/points/2461";
const MIB = 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;

/** The most chunks a relay that stops at 8 MiB pulls: the 128 that reach it, and the one that passes it. */
const CHUNKS_TO_PASS_THE_LIMIT = 129;

/** One answer: what the caller classifies it by, and the body that carries a refusal's detail. */
interface Answered {
  head: { status: number; marker: string | null; refusal: string | null };
  body: string;
}

/** The relay's own failure, as the caller classifies it. */
const RELAY_FAILURE = { status: 504, marker: "refused-here", refusal: "upstream-timeout" };

/** The `detail` a refusal body names, if any. */
function detailIn(body: string): string | undefined {
  return (JSON.parse(body) as { detail?: string }).detail;
}

async function ask(port: number): Promise<Answered> {
  const signature = crypto.createHmac("sha256", KEY).update(`${String(NOW_SECONDS)}\n${PATH}`).digest("hex");
  const headers = { "x-egress-timestamp": String(NOW_SECONDS), "x-egress-signature": signature };
  const res = await fetch(`http://127.0.0.1:${String(port)}${PATH}`, { headers });
  const head = { status: res.status, marker: res.headers.get("x-egress-response"), refusal: res.headers.get("x-egress-refusal") };
  return { head, body: await res.text() };
}

function grantingStore(): CeilingStore {
  return { increment: () => Promise.resolve(1) };
}

function startService(upstreamFetch: UpstreamFetch): Promise<{ server: Server; port: number }> {
  return startEgressServer({
    env: { INGEST_SIGNING_KEY: KEY, UPSTREAM_REQUEST_CEILING_PER_HOUR: "100" },
    port: 0,
    nowSeconds: () => NOW_SECONDS,
    upstreamFetch,
    ceilingStore: grantingStore(),
  });
}

/** A 32 MiB body served one reused chunk per read, counting the reads and whether the stream was closed. */
interface CountedBody {
  stream: ReadableStream<Uint8Array>;
  pulled(): number;
  closed(): boolean;
}

/** What reading a counted body has done so far: the chunks handed out, and whether the stream has closed. */
interface Reads {
  pulled: number;
  closed: boolean;
}

/**
 * Each of `chunks` in turn, counted as it is handed out. `finally` runs once
 * the stream closes, whether the reader gave the rest up or the chunks ran out.
 */
function* countedChunks(chunks: Uint8Array[], reads: Reads): Generator<Uint8Array> {
  try {
    for (const chunk of chunks) {
      reads.pulled += 1;
      yield chunk;
    }
  } finally {
    reads.closed = true;
  }
}

function countedBody(): CountedBody {
  const chunk = new Uint8Array(CHUNK_BYTES);
  const reads: Reads = { pulled: 0, closed: false };
  const stream = ReadableStream.from(countedChunks(Array.from({ length: (32 * MIB) / CHUNK_BYTES }, () => chunk), reads));
  return { stream, pulled: () => reads.pulled, closed: () => reads.closed };
}

void describe("an upstream body past the limit, read as it arrives", () => {
  const body = countedBody();
  let service: { server: Server; port: number };

  before(async () => {
    service = await startService(() => Promise.resolve({ status: 200, headers: new Headers(), body: body.stream }));
  });

  after(() => {
    service.server.close();
  });

  void it("is refused as the relay's failure, read no further than the chunk that passed the limit", async () => {
    const answer = await ask(service.port);
    assert.deepEqual(answer.head, RELAY_FAILURE);
    assert.equal(detailIn(answer.body), "upstream-body-over-limit");
    assert.ok(body.pulled() <= CHUNKS_TO_PASS_THE_LIMIT, `the relay pulled ${String(body.pulled())} chunks`);
    assert.equal(body.closed(), true, "the relay must close the body it stopped reading, not leave it streaming");
  });
});

void describe("a gzip upstream body that decodes past the limit", () => {
  const compressed = gzipSync(new Uint8Array(16 * MIB));
  let upstream: Server;
  let service: { server: Server; port: number };

  before(async () => {
    upstream = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
      response.end(compressed);
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    assert.ok(address !== null && typeof address === "object");
    service = await startService((_url, init) => fetch(`http://127.0.0.1:${String(address.port)}/`, init));
  });

  after(() => {
    upstream.close();
    service.server.close();
  });

  void it("is refused although far fewer bytes than the limit crossed the wire", async () => {
    assert.ok(compressed.byteLength < MIB, "the fixture must be small on the wire for this test to mean anything");
    const answer = await ask(service.port);
    assert.deepEqual(answer.head, RELAY_FAILURE);
    assert.equal(detailIn(answer.body), "upstream-body-over-limit");
  });
});

import crypto from "node:crypto";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createServer as createHttpServer, type Server } from "node:http";
import { RedisRestCeilingStore } from "../src/redis-rest-ceiling-store.ts";
import { startEgressServer } from "../src/start-egress-server.ts";

/**
 * The ceiling's store, over real HTTP (#1810).
 *
 * The unit tests below this one decide what the adapter sends and how every
 * unreadable answer is refused; this suite proves the two things only a real
 * connection can: that the service's count reaches a store carrying its
 * credential on the hour's own key, and that a store which stops answering
 * refuses the request HERE — before the upstream, marked as our refusal —
 * rather than being counted in the memory of the process that is failing.
 *
 * The store is a stub on 127.0.0.1 that this test owns; nothing leaves the
 * loopback, and no store is provisioned anywhere.
 */

const KEY = crypto.randomBytes(48).toString("base64");

/** The store's bearer token: a value this test owns, never one from the tree. */
const STORE_TOKEN = "a-store-token-the-test-owns";

/** A moment inside the hour that starts at 1699999200, which is the key the store must be asked for. */
const NOW_SECONDS = 1_700_000_000;
const HOUR_KEY = "anitabi-egress:upstream-requests:1699999200";

const PATH = "/anitabi/lite/2461";

/** Signed request headers for the one path this suite asks for. */
function signedHeaders(): Record<string, string> {
  const signature = crypto.createHmac("sha256", KEY).update(`${String(NOW_SECONDS)}\n${PATH}`).digest("hex");
  return { "x-egress-timestamp": String(NOW_SECONDS), "x-egress-signature": signature };
}

/** Ask the running service over real loopback HTTP. */
async function ask(port: number): Promise<{ status: number; body: string; marker: string | null; refusal: string | null }> {
  const res = await fetch(`http://127.0.0.1:${String(port)}${PATH}`, { headers: signedHeaders() });
  return {
    status: res.status,
    body: await res.text(),
    marker: res.headers.get("x-egress-response"),
    refusal: res.headers.get("x-egress-refusal"),
  };
}

/** The upstream, reduced to the one thing this suite reads: whether it was asked for anything. */
function recordingUpstream(): { shim: typeof fetch; requests: string[] } {
  const requests: string[] = [];
  return {
    requests,
    shim: (input) => {
      requests.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return Promise.resolve(new Response('{"points":[]}', { status: 200 }));
    },
  };
}

/** The loopback store: the one endpoint the adapter speaks, what it was sent, and how it answers. */
interface StubStore {
  server: Server;
  store: RedisRestCeilingStore;
  sent: { body: string; authorization: string | null }[];
  /** Answer every later request with this status instead of a count; 0 restores the count. */
  answer(status: number): void;
}

async function startStubStore(): Promise<StubStore> {
  const sent: StubStore["sent"] = [];
  let count = 0;
  let failing = 0;
  const server = createHttpServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => { body += chunk.toString("utf8"); });
    request.on("end", () => {
      sent.push({ body, authorization: request.headers.authorization ?? null });
      count += 1;
      response.writeHead(failing === 0 ? 200 : failing, { "content-type": "application/json" });
      response.end(failing === 0 ? JSON.stringify([{ result: count }, { result: 1 }]) : "{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  const url = `http://127.0.0.1:${String(address.port)}`;
  return {
    server,
    sent,
    answer: (status) => { failing = status; },
    store: new RedisRestCeilingStore({ url, token: STORE_TOKEN, transport: fetch }),
  };
}

void describe("the store the ceiling counts in, over real HTTP", () => {
  let service: { server: Server; port: number };
  let store: StubStore;
  const upstream = recordingUpstream();

  before(async () => {
    store = await startStubStore();
    service = await startEgressServer({
      env: { INGEST_SIGNING_KEY: KEY, UPSTREAM_REQUEST_CEILING_PER_HOUR: "100" },
      port: 0,
      nowSeconds: () => NOW_SECONDS,
      upstreamFetch: upstream.shim,
      ceilingStore: store.store,
    });
  });

  after(() => {
    service.server.close();
    store.server.close();
  });

  void it("counts the request in the store, on the hour's own key, before relaying", async () => {
    const answer = await ask(service.port);
    assert.equal(answer.status, 200);
    assert.equal(answer.marker, "relayed-upstream");
    const [counted] = store.sent;
    assert.ok(counted !== undefined, "the service must count a request before relaying it");
    assert.equal(counted.authorization, `Bearer ${STORE_TOKEN}`, "the credential is the store's one header");
    assert.equal(
      counted.body,
      JSON.stringify([["INCR", HOUR_KEY], ["EXPIRE", HOUR_KEY, "7200"]]),
      "the window is the clock hour the request falls in, and the hour is the whole key",
    );
  });

  void it("refuses when the store stops answering, and never reaches the upstream", async () => {
    const relayed = upstream.requests.length;
    store.answer(503);
    try {
      const answer = await ask(service.port);
      assert.equal(answer.status, 429);
      assert.equal(answer.marker, "refused-here");
      assert.equal(answer.refusal, "ceiling");
      assert.match(answer.body, /ceiling-store-unavailable/);
      assert.equal(
        upstream.requests.length,
        relayed,
        "the service relayed a request its store never counted — failing closed means refusing here",
      );
    } finally {
      store.answer(0);
    }
  });
});

/**
 * A service with no store in its environment. It has no ceiling — a ceiling it
 * cannot count is not one — so the composition root gives the handler null and
 * every request is refused with `configuration`, before the route is even
 * signed for. Running uncounted, which is what an optional store would mean, is
 * the one outcome #1810 rules out.
 */
void describe("a service whose environment names no store", () => {
  let service: { server: Server; port: number };
  const upstream = recordingUpstream();

  before(async () => {
    service = await startEgressServer({
      env: { INGEST_SIGNING_KEY: KEY, UPSTREAM_REQUEST_CEILING_PER_HOUR: "100" },
      port: 0,
      nowSeconds: () => NOW_SECONDS,
      upstreamFetch: upstream.shim,
    });
  });

  after(() => {
    service.server.close();
  });

  void it("refuses every request as configuration, and never relays", async () => {
    const answer = await ask(service.port);
    assert.equal(answer.status, 503);
    assert.equal(answer.marker, "refused-here");
    assert.equal(answer.refusal, "configuration");
    assert.deepEqual(upstream.requests, [], "a service that cannot count must not relay");
  });
});

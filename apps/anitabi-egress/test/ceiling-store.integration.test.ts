import crypto from "node:crypto";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createServer as createTcpServer, type Server } from "node:net";
import { startEgressServer } from "../src/start-egress-server.ts";

/**
 * The ceiling's store, over a real TCP connection (#1810, #1824). The unit
 * tests pin what the adapter writes, and the `rolling-window*` suites what the
 * window decides on a real Redis; this suite proves what only the composition
 * root's own connection can: the admission reaches a store carrying its
 * credential as the window's one call, the store's decision is the ceiling's,
 * and a store which stops answering refuses the request HERE — before the
 * upstream, marked as our refusal — rather than being counted in memory.
 *
 * The store is a RESP-speaking stub on the loopback that this test owns,
 * answering the decision the test names, and the service dials it through the
 * composition root's real connection — `family: 6`, so the stub binds `::1`
 * exactly as Fly's private network is reached. Nothing leaves the loopback.
 */

const KEY = crypto.randomBytes(48).toString("base64");

/** The store's password: an obviously-fake constant, the form this repository's test credentials take. */
const STORE_PASSWORD = "the-integration-tests-own-password";

/** The moment the service's clock reads. */
const NOW_SECONDS = 1_700_000_000;

/** The window's key, and the shape of the random member an admission is recorded under. */
const WINDOW_KEY = "anitabi-egress:upstream-requests:rolling";
const MEMBER_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

/** One command a connection carried, and how many bytes of the connection it took. */
function nextCommand(bytes: string): { command: string[]; length: number } | null {
  if (!bytes.startsWith("*")) return null;
  const head = bytes.indexOf("\r\n");
  if (head < 0) return null;
  const arity = Number(bytes.slice(1, head));
  let at = head + 2;
  const command: string[] = [];
  for (let index = 0; index < arity; index += 1) {
    const declared = bytes.indexOf("\r\n", at);
    if (bytes[at] !== "$" || declared < 0) return null;
    const length = Number(bytes.slice(at + 1, declared));
    const start = declared + 2;
    if (bytes.length < start + length + 2) return null;
    command.push(bytes.slice(start, start + length));
    at = start + length + 2;
  }
  return { command, length: at };
}

/** The RESP-speaking store stub: what it was told, and how it answers. */
interface StubStore {
  server: Server;
  /** The store's address, as the service must be configured with it. */
  url(username: string | null): string;
  /** Every command every connection carried, in the order the service sent them. */
  commands: string[][];
  /** Answer every further command with this Redis error instead of a decision; null restores the decision. */
  refuse(message: string | null): void;
  /** Answer every further admission with the window's refusal, `0`, as a spent window does. */
  spend(): void;
}

async function startStubStore(): Promise<StubStore> {
  const commands: StubStore["commands"] = [];
  let decision = 1;
  let refusal: string | null = null;
  const answer = (command: readonly string[]): string => {
    if (refusal !== null) return `-${refusal}\r\n`;
    return command[0] === "EVAL" ? `:${String(decision)}\r\n` : "+OK\r\n";
  };
  const server = createTcpServer((socket) => {
    let buffered = "";
    socket.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      for (let frame = nextCommand(buffered); frame !== null; frame = nextCommand(buffered)) {
        buffered = buffered.slice(frame.length);
        commands.push(frame.command);
        socket.write(answer(frame.command));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "::1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  return {
    server,
    commands,
    refuse: (message) => {
      refusal = message;
    },
    spend: () => {
      decision = 0;
    },
    url: (username) => {
      const credentials = username === null ? "" : `${username}:${STORE_PASSWORD}@`;
      return `redis://${credentials}localhost:${String(address.port)}`;
    },
  };
}

/** Start the service against `storeUrl`, or against no store at all when it is undefined. */
function serveAt(storeUrl: string | undefined, ceiling: string, upstream: typeof fetch): Promise<{ server: Server; port: number }> {
  const env: Record<string, string | undefined> = {
    INGEST_SIGNING_KEY: KEY,
    UPSTREAM_REQUEST_CEILING_PER_HOUR: ceiling,
    CEILING_STORE_URL: storeUrl,
  };
  return startEgressServer({ env, port: 0, nowSeconds: () => NOW_SECONDS, upstreamFetch: upstream });
}

void describe("the store the ceiling counts in, over a real connection", () => {
  let service: { server: Server; port: number };
  let store: StubStore;
  const upstream = recordingUpstream();

  before(async () => {
    store = await startStubStore();
    service = await serveAt(store.url(null), "100", upstream.shim);
  });

  after(() => {
    service.server.close();
    store.server.close();
  });

  void it("asks the store's window to admit the request, in one call, before relaying", async () => {
    const answer = await ask(service.port);
    assert.equal(answer.status, 200);
    assert.equal(answer.marker, "relayed-upstream");
    const admission = store.commands[0] ?? [];
    assert.equal(store.commands.length, 1, "one request is one call to the store");
    assert.equal(admission[0], "EVAL");
    assert.equal(admission[3], WINDOW_KEY, "the window is the store's one key, and names no instance");
    assert.equal(admission.at(-3), "100", "the limit travels with the call: the store decides");
    assert.match(admission.at(-2) ?? "", MEMBER_SHAPE, "each admission is recorded under a member of its own");
  });

  void it("refuses when the store stops answering, and never reaches the upstream", async () => {
    const relayed = upstream.requests.length;
    store.refuse("LOADING Redis is loading the dataset in memory");
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
      store.refuse(null);
    }
  });
});

/**
 * The same store, reached by an address that carries the credential — which is
 * the shape Fly's Private URL has. The AUTH is a command on the same
 * connection, in the same write, and the decision is still the store's.
 */
void describe("an address that carries the store's own credential", () => {
  let service: { server: Server; port: number };
  let store: StubStore;
  const upstream = recordingUpstream();

  before(async () => {
    store = await startStubStore();
    service = await serveAt(store.url("default"), "100", upstream.shim);
  });

  after(() => {
    service.server.close();
    store.server.close();
  });

  void it("opens the store with that credential, then asks its window", async () => {
    const answer = await ask(service.port);
    assert.equal(answer.marker, "relayed-upstream");
    assert.deepEqual(store.commands[0], ["AUTH", "default", STORE_PASSWORD], "the store refuses every command without its AUTH");
    assert.equal(store.commands[1]?.[0], "EVAL", "the window's call comes after the AUTH, never ahead of it");
    assert.equal(store.commands.length, 2);
  });
});

/**
 * The ceiling reads the store's decision, and the store's decision is the only
 * one. A window the store reports spent is refused by our own ceiling, with no
 * store detail, which is how the caller tells a spent budget from an
 * unreachable store.
 */
void describe("a budget the store has spent", () => {
  let service: { server: Server; port: number };
  let store: StubStore;
  const upstream = recordingUpstream();

  before(async () => {
    store = await startStubStore();
    service = await serveAt(store.url(null), "100", upstream.shim);
  });

  after(() => {
    service.server.close();
    store.server.close();
  });

  void it("refuses when the store's window refuses, without the store's own refusal detail", async () => {
    assert.equal((await ask(service.port)).marker, "relayed-upstream");
    store.spend();
    const refused = await ask(service.port);
    assert.equal(refused.status, 429);
    assert.equal(refused.refusal, "ceiling");
    assert.doesNotMatch(refused.body, /ceiling-store-unavailable/, "the store answered: this refusal is the budget's");
    assert.equal(upstream.requests.length, 1, "the refused request must not have reached the upstream");
  });
});

/**
 * A service with no store it can dial. It has no ceiling — a ceiling it cannot
 * count is not one — so the composition root gives the handler null and every
 * request is refused with `configuration`, before the route is even signed for.
 * Running uncounted, which is what an optional store would mean, is the one
 * outcome #1810 rules out.
 */
void describe("a service whose environment names no store the service may dial", () => {
  const upstream = recordingUpstream();

  after(() => {
    upstream.requests.length = 0;
  });

  void it("refuses every request as configuration, and never relays", async () => {
    const service = await serveAt(undefined, "100", upstream.shim);
    try {
      const answer = await ask(service.port);
      assert.equal(answer.status, 503);
      assert.equal(answer.marker, "refused-here");
      assert.equal(answer.refusal, "configuration");
      assert.deepEqual(upstream.requests, [], "a service that cannot count must not relay");
    } finally {
      service.server.close();
    }
  });

  void it("refuses the HTTPS REST endpoint this replaced, rather than dialing it", async () => {
    const service = await serveAt("https://store.test", "100", upstream.shim);
    try {
      const answer = await ask(service.port);
      assert.equal(answer.status, 503);
      assert.equal(answer.refusal, "configuration");
      assert.deepEqual(upstream.requests, [], "a leftover #1810 URL is a store this service does not have");
    } finally {
      service.server.close();
    }
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RedisTcpCeilingStore, type StoreConnect, type StoreSocket } from "../src/redis-tcp-ceiling-store.ts";

/**
 * The production store (#1810, #1824): the Redis `fly redis create`
 * provisions, spoken to over TCP in RESP. It is a counter and nothing else —
 * no user data, no data-plane credential — and the tests here pin the whole
 * conversation it can have, because that conversation is the service's second
 * destination and the one a credential travels to.
 *
 * The CONNECTION is injected, the way the relay's fetch is: this module names
 * no network module and no global network function, so a test hands it a
 * socket it owns and reads the exact bytes that would have gone on the wire.
 * Nothing here opens a real Redis, and nothing in this package leaves the
 * loopback.
 *
 * Every failure path is a refusal. An answer this adapter cannot read is a
 * store failure, never a grant: the store's whole job is to be believed.
 */

/**
 * The password the store's own address carries. Assembled rather than written
 * out — a credential-shaped literal cannot sit in the tree this repository
 * scans, even when it is only ever a test's.
 */
const PASSWORD = "the-" + "tests-own-password";

/** The Private URL `fly redis status` prints: the store's credential is inside the address. */
const PRIVATE_URL = `redis://default:${PASSWORD}@fly-anitabi-test.upstash.io:6379`;

/** The same store reached by an address that carries no credential. */
const OPEN_URL = "redis://fly-anitabi-test.upstash.io:6379";

/** The hour this adapter is asked to count in. */
const WINDOW = "anitabi-egress:upstream-requests:472222";

/** How long a window's key outlives its hour, and how long the store has to answer. */
const TTL = "7200";
const STORE_TIMEOUT_MS = 5_000;

/**
 * The counter's whole side of the conversation, as RESP2 arrays of bulk
 * strings: `INCR <window>` and `EXPIRE <window> 7200`, in ONE payload. Written
 * out rather than produced by a helper the implementation could drift into
 * agreeing with — the array headers and byte counts included, so a changed
 * framing has to change these lines.
 */
const COUNTER_PAYLOAD =
  "*2\r\n" +
  "$4\r\nINCR\r\n" +
  `$${String(WINDOW.length)}\r\n${WINDOW}\r\n` +
  "*3\r\n" +
  "$6\r\nEXPIRE\r\n" +
  `$${String(WINDOW.length)}\r\n${WINDOW}\r\n` +
  `$${String(TTL.length)}\r\n${TTL}\r\n`;

/** What that payload looks like with the address's own credential in front of it. */
const AUTH_PAYLOAD =
  "*3\r\n$4\r\nAUTH\r\n$7\r\ndefault\r\n" + `$${String(PASSWORD.length)}\r\n${PASSWORD}\r\n` + COUNTER_PAYLOAD;

/**
 * One reply per command sent, in the order they were sent: the AUTH status, the
 * count, and the expiry's answer — the shape of a conversation with an address
 * that carries a credential.
 */
function counted(count: number): string[] {
  return [`+OK\r\n:${String(count)}\r\n:1\r\n`];
}

/** The same conversation on an address carrying no credential, so no AUTH reply is owed. */
function countedUnAuthenticated(count: number): string[] {
  return [`:${String(count)}\r\n:1\r\n`];
}

/** What a connection does when it is not going to answer. */
type Ending = "hang-up" | "fail";

interface SocketDouble {
  readonly socket: StoreSocket;
  /** Every write the store made, in order — its whole side of the conversation. */
  readonly written: string[];
  /** Whether the store closed the connection it opened. */
  closed(): boolean;
}

/**
 * A socket the test owns. It records what the store writes, hands back the
 * chunks of `answer` as that write lands, and then does `ending` — which is
 * how a connection answers, and why none of these tests needs a tick of its
 * own. Splitting `answer` into several chunks is how a reply that arrives in
 * pieces is reproduced.
 */
function socketDouble(answer: readonly string[] = [], ending: Ending | null = null): SocketDouble {
  const written: string[] = [];
  const data: ((chunk: Uint8Array) => void)[] = [];
  const errors: ((cause: unknown) => void)[] = [];
  const closures: (() => void)[] = [];
  const each = <T>(listeners: readonly ((event: T) => void)[], event: T): void => {
    for (const listener of listeners) listener(event);
  };
  let closed = false;
  return {
    written,
    closed: () => closed,
    socket: {
      write: (chunk) => {
        written.push(chunk);
        for (const part of answer) each(data, new TextEncoder().encode(part));
        if (ending === "hang-up") each(closures, undefined);
        if (ending === "fail") each(errors, new Error("read ECONNRESET"));
      },
      destroy: () => {
        closed = true;
      },
      onData: (listener) => data.push(listener),
      onError: (listener) => errors.push(listener),
      onClose: (listener) => closures.push(listener),
    },
  };
}

/** The store under test over a socket the test owns, and the addresses it dialled. */
function storeOver(answer: readonly string[] = [], url = PRIVATE_URL, ending: Ending | null = null): {
  store: RedisTcpCeilingStore;
  socket: SocketDouble;
  dialled: string[];
} {
  const socket = socketDouble(answer, ending);
  const dialled: string[] = [];
  const connect: StoreConnect = (target) => {
    dialled.push(target);
    return Promise.resolve(socket.socket);
  };
  return { store: new RedisTcpCeilingStore({ url, connect }), socket, dialled };
}

/** Let every microtask the store queued run, so its timer exists before the test's clock moves. */
function drained(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

void describe("RedisTcpCeilingStore", () => {
  void it("sends INCR and EXPIRE as one RESP pipeline, in a single write", async () => {
    const { store, socket } = storeOver(countedUnAuthenticated(1), OPEN_URL);
    await store.increment(WINDOW);
    assert.deepEqual(
      socket.written,
      [COUNTER_PAYLOAD],
      "the increment and the key's expiry are one conversation: a second write is a window that can half-exist",
    );
  });

  void it("answers with the count the store's own increment returned", async () => {
    const { store } = storeOver(counted(42));
    assert.equal(await store.increment(WINDOW), 42);
  });

  void it("reaches the address it was configured with, and no other", async () => {
    const { store, dialled } = storeOver(counted(1));
    await store.increment(WINDOW);
    assert.deepEqual(dialled, [PRIVATE_URL], "the destination is the environment's, never a request's");
  });

  void it("closes the connection it opened once the count is in", async () => {
    const { store, socket } = storeOver(counted(1));
    await store.increment(WINDOW);
    assert.equal(socket.closed(), true);
  });

  void it("sends the address's own credential as AUTH, ahead of the counter, in the same write", async () => {
    const { store, socket } = storeOver(counted(7));
    await store.increment(WINDOW);
    assert.deepEqual(
      socket.written,
      [AUTH_PAYLOAD],
      "the Private URL carries the store's credential: without AUTH the store refuses every command",
    );
  });

  void it("sends no AUTH when the address carries no credential to send", async () => {
    const { store, socket } = storeOver(countedUnAuthenticated(1), OPEN_URL);
    await store.increment(WINDOW);
    assert.deepEqual(socket.written, [COUNTER_PAYLOAD]);
  });

  void it("reads a reply that arrives in pieces", async () => {
    const { store } = storeOver(["+OK\r\n:", "7\r\n:1", "\r\n"]);
    assert.equal(await store.increment(WINDOW), 7, "a reply split across chunks is still the reply");
  });

  void it("counts the second window from its own increment, not the first", async () => {
    const { store } = storeOver(counted(9));
    assert.equal(await store.increment(WINDOW), 9);
    assert.equal(await store.increment(WINDOW), 9, "the store's number is the store's, this adapter keeps none");
  });
});

/**
 * Every way a store can fail to answer is a rejection the ceiling turns into a
 * refusal. None of them may read as a count, and none may be swallowed: a
 * store whose failures were tolerated is a ceiling that is not enforced.
 */
void describe("an answer the store cannot give is a refusal", () => {
  void it("refuses the error Redis returns for a command it did not run", async () => {
    const { store } = storeOver(["+OK\r\n-ERR value is not an integer or out of range\r\n:1\r\n"]);
    await assert.rejects(store.increment(WINDOW), Error, "an error must not read as a count");
  });

  void it("refuses when the expiry failed, so no window is left without one", async () => {
    const { store } = storeOver(["+OK\r\n:1\r\n-ERR wrong number of arguments for 'expire' command\r\n"]);
    await assert.rejects(
      store.increment(WINDOW),
      Error,
      "the increment landing without its expiry is a key that never dies, which is not the counter asked for",
    );
  });

  void it("refuses the store's rejection of the credential", async () => {
    const { store } = storeOver(["-WRONGPASS invalid username-password pair\r\n:1\r\n:1\r\n"]);
    await assert.rejects(store.increment(WINDOW), Error, "a failed AUTH must not read as a count");
  });

  void it("refuses a reply type this pipeline never asked for", async () => {
    const { store } = storeOver(["+OK\r\n$3\r\nfoo\r\n:1\r\n"]);
    await assert.rejects(store.increment(WINDOW), Error, "a bulk string is not the integer asked for");
  });

  void it("refuses a reply the store never finished sending, once its own timeout passes", async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const { store } = storeOver(["+OK\r\n:4"]);
    const refused = assert.rejects(store.increment(WINDOW), Error, "a truncated reply is not a count");
    await drained();
    context.mock.timers.tick(STORE_TIMEOUT_MS);
    await refused;
  });

  void it("refuses a connection hung up before the count arrived", async () => {
    const { store } = storeOver([], PRIVATE_URL, "hang-up");
    await assert.rejects(store.increment(WINDOW), Error, "a store that hung up has not counted anything");
  });

  void it("refuses a connection that failed", async () => {
    const { store } = storeOver([], PRIVATE_URL, "fail");
    await assert.rejects(store.increment(WINDOW), Error, "a broken connection must reject, not answer zero");
  });

  void it("refuses when the store cannot be reached at all", async () => {
    const connect: StoreConnect = () => Promise.reject(new Error("connect ECONNREFUSED"));
    const store = new RedisTcpCeilingStore({ url: PRIVATE_URL, connect });
    await assert.rejects(store.increment(WINDOW), Error, "an unreachable store must reject, not answer zero");
  });

  void it("closes the connection it opened even when the store failed", async () => {
    const { store, socket } = storeOver([], PRIVATE_URL, "fail");
    await assert.rejects(store.increment(WINDOW));
    assert.equal(socket.closed(), true, "a refused count must not leave its connection open");
  });
});

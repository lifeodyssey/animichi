import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RedisTcpCeilingStore, type StoreConnect } from "../src/redis-tcp-ceiling-store.ts";
import { OPEN_URL, PASSWORD, PRIVATE_URL, storeOverSocket, WINDOW } from "./store-over-socket.ts";

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

/** Let every microtask the store queued run, so its timer exists before the test's clock moves. */
function drained(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

void describe("RedisTcpCeilingStore", () => {
  void it("sends INCR and EXPIRE as one RESP pipeline, in a single write", async () => {
    const { store, socket } = storeOverSocket(countedUnAuthenticated(1), OPEN_URL);
    await store.increment(WINDOW);
    assert.deepEqual(
      socket.written,
      [COUNTER_PAYLOAD],
      "the increment and the key's expiry are one conversation: a second write is a window that can half-exist",
    );
  });

  void it("answers with the count the store's own increment returned", async () => {
    const { store } = storeOverSocket(counted(42));
    assert.equal(await store.increment(WINDOW), 42);
  });

  void it("reaches the address it was configured with, and no other", async () => {
    const { store, dialled } = storeOverSocket(counted(1));
    await store.increment(WINDOW);
    assert.deepEqual(dialled, [PRIVATE_URL], "the destination is the environment's, never a request's");
  });

  void it("closes the connection it opened once the count is in", async () => {
    const { store, socket } = storeOverSocket(counted(1));
    await store.increment(WINDOW);
    assert.equal(socket.closed(), true);
  });

  void it("sends the address's own credential as AUTH, ahead of the counter, in the same write", async () => {
    const { store, socket } = storeOverSocket(counted(7));
    await store.increment(WINDOW);
    assert.deepEqual(
      socket.written,
      [AUTH_PAYLOAD],
      "the Private URL carries the store's credential: without AUTH the store refuses every command",
    );
  });

  void it("sends no AUTH when the address carries no credential to send", async () => {
    const { store, socket } = storeOverSocket(countedUnAuthenticated(1), OPEN_URL);
    await store.increment(WINDOW);
    assert.deepEqual(socket.written, [COUNTER_PAYLOAD]);
  });

  void it("reads a reply that arrives in pieces", async () => {
    const { store } = storeOverSocket(["+OK\r\n:", "7\r\n:1", "\r\n"]);
    assert.equal(await store.increment(WINDOW), 7, "a reply split across chunks is still the reply");
  });

  void it("counts the second window from its own increment, not the first", async () => {
    const { store } = storeOverSocket(counted(9));
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
    const { store } = storeOverSocket(["+OK\r\n-ERR value is not an integer or out of range\r\n:1\r\n"]);
    await assert.rejects(store.increment(WINDOW), Error, "an error must not read as a count");
  });

  void it("refuses when the expiry failed, so no window is left without one", async () => {
    const { store } = storeOverSocket(["+OK\r\n:1\r\n-ERR wrong number of arguments for 'expire' command\r\n"]);
    await assert.rejects(
      store.increment(WINDOW),
      Error,
      "the increment landing without its expiry is a key that never dies, which is not the counter asked for",
    );
  });

  void it("refuses the store's rejection of the credential", async () => {
    const { store } = storeOverSocket(["-WRONGPASS invalid username-password pair\r\n:1\r\n:1\r\n"]);
    await assert.rejects(store.increment(WINDOW), Error, "a failed AUTH must not read as a count");
  });

  void it("refuses a reply type this pipeline never asked for", async () => {
    const { store } = storeOverSocket(["+OK\r\n$3\r\nfoo\r\n:1\r\n"]);
    await assert.rejects(store.increment(WINDOW), Error, "a bulk string is not the integer asked for");
  });

  void it("refuses a reply the store never finished sending, once its own timeout passes", async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const { store } = storeOverSocket(["+OK\r\n:4"]);
    const refused = assert.rejects(store.increment(WINDOW), Error, "a truncated reply is not a count");
    await drained();
    context.mock.timers.tick(STORE_TIMEOUT_MS);
    await refused;
  });

  void it("refuses a connection hung up before the count arrived", async () => {
    const { store } = storeOverSocket([], PRIVATE_URL, "hang-up");
    await assert.rejects(store.increment(WINDOW), Error, "a store that hung up has not counted anything");
  });

  void it("refuses a connection that failed", async () => {
    const { store } = storeOverSocket([], PRIVATE_URL, "fail");
    await assert.rejects(store.increment(WINDOW), Error, "a broken connection must reject, not answer zero");
  });

  void it("refuses when the store cannot be reached at all", async () => {
    const connect: StoreConnect = () => Promise.reject(new Error("connect ECONNREFUSED"));
    const store = new RedisTcpCeilingStore({ url: PRIVATE_URL, connect });
    await assert.rejects(store.increment(WINDOW), Error, "an unreachable store must reject, not answer zero");
  });

  void it("closes the connection it opened even when the store failed", async () => {
    const { store, socket } = storeOverSocket([], PRIVATE_URL, "fail");
    await assert.rejects(store.increment(WINDOW));
    assert.equal(socket.closed(), true, "a refused count must not leave its connection open");
  });
});

/**
 * The bound on what this pipeline will read (#1824). The store's whole
 * conversation is three small replies, so a header longer than any of them is
 * bytes that cannot be an answer — and the buffer holding them must not be left
 * to grow until the endpoint decides to end a line, which is what an endpoint
 * that never does would make it do.
 */
void describe("a header longer than any reply the store owes", () => {
  void it("is refused having run past the bound, before its terminator arrives", async () => {
    const { store } = storeOverSocket(["A".repeat(4_096)], PRIVATE_URL, "hang-up");
    await assert.rejects(
      store.increment(WINDOW),
      /longer than any answer it owes/,
      "an endpoint that never ends its header is refused as one, not buffered without end",
    );
  });

  void it("is refused when it does end, having run past the bound", async () => {
    const { store } = storeOverSocket([`+${"A".repeat(4_096)}\r\n`]);
    await assert.rejects(
      store.increment(WINDOW),
      /longer than any answer it owes/,
      "the bound is on the header, not on how it arrives: a decode is bounded only if the bytes are",
    );
  });
});

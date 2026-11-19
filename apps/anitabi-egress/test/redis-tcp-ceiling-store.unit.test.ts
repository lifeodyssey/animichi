import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RedisTcpCeilingStore, type StoreConnect } from "../src/redis-tcp-ceiling-store.ts";
import { STORE_CLOCK, WINDOW_BODY } from "../src/rolling-window-script.ts";
import { MEMBER, OPEN_URL, PASSWORD, PRIVATE_URL, REQUEST, socketDouble, storeOverSocket } from "./store-over-socket.ts";

/**
 * SUT: the production store's conversation (#1810, #1824): the Redis
 * `fly redis create` provisions, spoken to over TCP in RESP. It keeps the
 * ceiling's window and nothing else — no user data, no data-plane credential —
 * and the tests here pin the whole conversation it can have, because that
 * conversation is the service's second destination and the one a credential
 * travels to. What the window's script DECIDES is proven on a real Redis
 * (`rolling-window*.integration.test.ts`); this file pins what goes on the wire
 * and how every answer is read.
 *
 * The CONNECTION is injected, the way the relay's fetch is, so a test hands
 * the store a socket it owns and reads the exact bytes that would have gone on
 * the wire. Nothing here opens a real Redis.
 */

const STORE_TIMEOUT_MS = 5_000;

/** The script the service runs: the store's own clock, then the window. */
const SCRIPT = STORE_CLOCK.prologue + WINDOW_BODY;

/** One RESP2 bulk string, framed by hand: its length is the bytes that follow, not the characters. */
function bulk(argument: string): string {
  return `$${String(Buffer.byteLength(argument, "utf8"))}\r\n${argument}\r\n`;
}

/**
 * The fixed-hour counters the service before the window left, for the clock
 * hour `REQUEST` falls in (it started at 1699999200) and the hour before it.
 */
const COUNTERS = ["anitabi-egress:upstream-requests:1699999200", "anitabi-egress:upstream-requests:1699995600"];

/**
 * The store's whole side of an admission: ONE EVAL of the window's script, with
 * its keys — the window, then the two counters — the limit, the member and the
 * key's life, as a RESP2 array of bulk strings. The array header is written
 * out, so a changed shape has to change this line.
 */
const WINDOW_PAYLOAD = `*9\r\n${["EVAL", SCRIPT, "3", "anitabi-egress:upstream-requests:rolling", ...COUNTERS, "100", MEMBER, "7200"].map(bulk).join("")}`;

/** The same admission with the address's own credential in front of it. */
const AUTH_PAYLOAD = `*3\r\n${["AUTH", "default", PASSWORD].map(bulk).join("")}${WINDOW_PAYLOAD}`;

/** Let every microtask the store queued run, so its timer exists before the test's clock moves. */
function drained(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

void describe("RedisTcpCeilingStore", () => {
  void it("sends the window as one EVAL, in a single write", async () => {
    const { store, socket } = storeOverSocket([":1\r\n"], OPEN_URL);
    await store.admit(REQUEST);
    assert.deepEqual(socket.written, [WINDOW_PAYLOAD], "one request is one call to the store, and one write");
  });

  void it("answers with the window's decision: 1 admitted, 0 refused", async () => {
    assert.equal(await storeOverSocket(["+OK\r\n:1\r\n"]).store.admit(REQUEST), "admitted");
    assert.equal(await storeOverSocket(["+OK\r\n:0\r\n"]).store.admit(REQUEST), "refused");
  });

  void it("reaches the address it was configured with, and no other", async () => {
    const { store, dialled } = storeOverSocket(["+OK\r\n:1\r\n"]);
    await store.admit(REQUEST);
    assert.deepEqual(dialled, [PRIVATE_URL], "the destination is the environment's, never a request's");
  });

  void it("closes the connection it opened once the answer is in", async () => {
    const { store, socket } = storeOverSocket(["+OK\r\n:1\r\n"]);
    await store.admit(REQUEST);
    assert.equal(socket.closed(), true);
  });

  void it("sends the address's own credential as AUTH, ahead of the window, in the same write", async () => {
    const { store, socket } = storeOverSocket(["+OK\r\n:1\r\n"]);
    await store.admit(REQUEST);
    assert.deepEqual(
      socket.written,
      [AUTH_PAYLOAD],
      "the Private URL carries the store's credential: without AUTH the store refuses every command",
    );
  });

  void it("reads a reply that arrives in pieces", async () => {
    const { store } = storeOverSocket(["+OK\r\n:", "1", "\r\n"]);
    assert.equal(await store.admit(REQUEST), "admitted", "a reply split across chunks is still the reply");
  });
});

/** Which clock, which keys and which member each admission's call carries. */
void describe("what each admission names", () => {
  void it("keeps the egress's clock out of the window: the script reads the store's TIME, and no clock is sent", async () => {
    const { store, socket } = storeOverSocket([":1\r\n"], OPEN_URL);
    await store.admit(REQUEST);
    const written = socket.written.join("");
    assert.match(written, /local now = tonumber\(redis\.call\('TIME'\)\[1\]\)/);
    assert.equal(written.includes(String(REQUEST.nowSeconds)), false, "the window must not move with this machine's clock");
  });

  void it("names the fixed-hour counters by the egress's own clock, the clock that named them", async () => {
    const { store, socket } = storeOverSocket([":1\r\n"], OPEN_URL);
    await store.admit({ nowSeconds: 1_699_999_200 + 3599, limit: 100 });
    await store.admit({ nowSeconds: 1_699_999_200 + 3600, limit: 100 });
    const named = socket.written.map((payload) => payload.match(/anitabi-egress:upstream-requests:\d+/g));
    assert.deepEqual(named, [COUNTERS, ["anitabi-egress:upstream-requests:1700002800", COUNTERS[0]]]);
  });

  void it("records every admission under a member of its own", async () => {
    const socket = socketDouble([":1\r\n"]);
    const store = new RedisTcpCeilingStore({ url: OPEN_URL, connect: () => Promise.resolve(socket.socket) });
    await store.admit(REQUEST);
    await store.admit(REQUEST);
    const members = socket.written.map((payload) => /\$36\r\n([0-9a-f-]{36})\r\n/.exec(payload)?.[1]);
    assert.equal(new Set(members).size, 2, "two admissions under one member would count as one");
  });
});

/**
 * Every way a store can fail to answer is a rejection the ceiling turns into a
 * refusal. None of them may read as an admission, and none may be swallowed: a
 * store whose failures were tolerated is a ceiling that is not enforced.
 */
void describe("an answer the store cannot give is a refusal", () => {
  void it("refuses the error Redis returns for a script it could not run", async () => {
    const wrongType = "-WRONGTYPE Operation against a key holding the wrong kind of value script: 0, on @user_script:3.\r\n";
    const { store } = storeOverSocket([`+OK\r\n${wrongType}`]);
    await assert.rejects(store.admit(REQUEST), Error, "an error must not read as an admission");
  });

  void it("refuses a reply type the window never answers", async () => {
    const { store } = storeOverSocket(["+OK\r\n$1\r\n1\r\n"]);
    await assert.rejects(store.admit(REQUEST), Error, "a bulk string is not the integer the script returns");
  });

  void it("refuses a reply the store never finished sending, once its own timeout passes", async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const { store } = storeOverSocket(["+OK\r\n:"]);
    const refused = assert.rejects(store.admit(REQUEST), Error, "a truncated reply is not an admission");
    await drained();
    context.mock.timers.tick(STORE_TIMEOUT_MS);
    await refused;
  });

  void it("refuses a connection hung up before the answer arrived", async () => {
    const { store } = storeOverSocket([], PRIVATE_URL, "hang-up");
    await assert.rejects(store.admit(REQUEST), Error, "a store that hung up has decided nothing");
  });

  void it("refuses a connection that failed", async () => {
    const { store } = storeOverSocket([], PRIVATE_URL, "fail");
    await assert.rejects(store.admit(REQUEST), Error, "a broken connection must reject, not admit");
  });

  void it("refuses when the store cannot be reached at all", async () => {
    const connect: StoreConnect = () => Promise.reject(new Error("connect ECONNREFUSED"));
    const store = new RedisTcpCeilingStore({ url: PRIVATE_URL, connect });
    await assert.rejects(store.admit(REQUEST), Error, "an unreachable store must reject, not admit");
  });

  void it("closes the connection it opened even when the store failed", async () => {
    const { store, socket } = storeOverSocket([], PRIVATE_URL, "fail");
    await assert.rejects(store.admit(REQUEST));
    assert.equal(socket.closed(), true, "a refused admission must not leave its connection open");
  });
});

/**
 * The bound on what this pipeline will read (#1824). The store's whole
 * conversation is two small replies, so a header longer than any of them is
 * bytes that cannot be an answer — and the buffer holding them must not be left
 * to grow until the endpoint decides to end a line.
 */
void describe("a header longer than any reply the store owes", () => {
  void it("is refused having run past the bound, before its terminator arrives", async () => {
    const { store } = storeOverSocket(["A".repeat(4_096)], PRIVATE_URL, "hang-up");
    await assert.rejects(
      store.admit(REQUEST),
      /longer than any answer it owes/,
      "an endpoint that never ends its header is refused as one, not buffered without end",
    );
  });

  void it("is refused when it does end, having run past the bound", async () => {
    const { store } = storeOverSocket([`+${"A".repeat(4_096)}\r\n`]);
    await assert.rejects(
      store.admit(REQUEST),
      /longer than any answer it owes/,
      "the bound is on the header, not on how it arrives: a decode is bounded only if the bytes are",
    );
  });
});

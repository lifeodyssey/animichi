import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RedisTcpCeilingStore, type StoreConnect, type StoreSocket } from "../src/redis-tcp-ceiling-store.ts";

/**
 * The reply SET the ceiling's store must answer with (#1825), as distinct from
 * any one reply. The adapter reads the increment's count by the POSITION it was
 * sent at, so the one reply set it may read as a count is the conversation its
 * pipeline asked for: one answer per command sent, each AUTH accepted, a
 * positive count, and an expiry the store actually set.
 *
 * Each of the four below WOULD otherwise read as a count. Redis answers `0` to
 * an `EXPIRE` it did not perform, and the window is then a key that outlives
 * the hour it counts. `INCR` answers `0` or less on a key holding a number this
 * service never wrote, and the ceiling reads any number as a total. A reply
 * beyond the last command leaves the positions alone and is read anyway. Any
 * status at all passes where the AUTH's `+OK` belongs. So each is a refusal
 * here instead of a count.
 *
 * The connection is injected exactly as it is in the store's own unit test, and
 * nothing here opens a socket: the store module names no network module. What
 * the adapter WRITES, how it frames a reply, and how a connection that never
 * answers is refused are all pinned in `redis-tcp-ceiling-store.unit.test.ts`;
 * this file holds the reply-set refusals alone.
 */

/** The Private URL `fly redis status` prints, whose credential the store must send as AUTH. */
const PRIVATE_URL = "redis://default:the-tests-own-password@fly-anitabi-test.upstash.io:6379";

/** The same store reached by an address carrying no credential, so no AUTH reply is owed. */
const OPEN_URL = "redis://fly-anitabi-test.upstash.io:6379";

/** The hour this adapter is asked to count in. */
const WINDOW = "anitabi-egress:upstream-requests:472222";

/**
 * A socket that answers the store's one write with the pieces of `answer`, in
 * order — every reply whole, as the pipeline asked for them. It does nothing
 * else, because this file's subject is the reply set the store is handed rather
 * than how it arrives.
 */
function socketAnswering(answer: readonly string[]): StoreSocket {
  const listeners: ((chunk: Uint8Array) => void)[] = [];
  return {
    write: () => {
      for (const piece of answer) for (const listener of listeners) listener(new TextEncoder().encode(piece));
    },
    destroy: () => undefined,
    onData: (listener) => listeners.push(listener),
    onError: () => undefined,
    onClose: () => undefined,
  };
}

/** The store under test, over a socket that answers with `answer` and nothing else. */
function storeAnswering(answer: readonly string[], url = PRIVATE_URL): RedisTcpCeilingStore {
  const socket = socketAnswering(answer);
  const connect: StoreConnect = () => Promise.resolve(socket);
  return new RedisTcpCeilingStore({ url, connect });
}

void describe("a reply set that is not the conversation asked for", () => {
  void it("refuses more answers than the pipeline sent commands", async () => {
    const store = storeAnswering([":7\r\n:1\r\n:1\r\n"], OPEN_URL);
    await assert.rejects(store.increment(WINDOW), Error, "an answer to a command never sent is not this conversation");
  });

  void it("refuses an AUTH the store did not accept, however readable the count behind it", async () => {
    const store = storeAnswering(["+PONG\r\n:7\r\n:1\r\n"]);
    await assert.rejects(store.increment(WINDOW), Error, "`+OK` is Redis accepting the credential, and nothing else is");
  });

  void it("refuses a window the store left without its expiry", async () => {
    const store = storeAnswering(["+OK\r\n:7\r\n:0\r\n"]);
    await assert.rejects(store.increment(WINDOW), Error, "`0` is Redis not setting the timeout: the key would never die");
  });

  void it("refuses an increment that answered no count this service ever wrote", async () => {
    await assert.rejects(storeAnswering(["+OK\r\n:0\r\n:1\r\n"]).increment(WINDOW), Error, "the store never answers zero");
    await assert.rejects(storeAnswering(["+OK\r\n:-4\r\n:1\r\n"]).increment(WINDOW), Error, "nor a lower number");
  });
});

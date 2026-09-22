import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OPEN_URL, storeOverSocket, WINDOW } from "./store-over-socket.ts";

/**
 * The reply SET the ceiling's store must answer with (#1825), as distinct from
 * any one reply. The adapter reads the increment's count by the POSITION it was
 * sent at, so the one reply set it may read as a count is the conversation its
 * pipeline asked for: one answer per command sent, the AUTH — at most one,
 * since a URL carries one credential — answered `+OK`, a positive count, and an
 * expiry the store actually set.
 *
 * Each of the four below WOULD otherwise read as a count. Redis answers `0` to
 * an `EXPIRE` it did not perform, and the window is then a key that outlives
 * the hour it counts. `INCR` answers `0` or less on a key holding a number this
 * service never wrote, and the ceiling reads any number as a total. A reply
 * beyond the last command leaves the positions alone and is read anyway. Any
 * status at all passes where the AUTH's `+OK` belongs. So each is a refusal
 * here instead of a count.
 *
 * Each refusal is asserted as the message its OWN guard writes (#1834), so a
 * green test says which of the four refused, not merely that one did.
 *
 * The store, the socket it runs over and the address it dials come from
 * `store-over-socket.ts`, the one builder this file and the store's own unit
 * test share. What the adapter WRITES, how it frames a reply, and how a
 * connection that never answers is refused are all pinned in
 * `redis-tcp-ceiling-store.unit.test.ts`; this file holds the reply-set
 * refusals alone.
 */

void describe("a reply set that is not the conversation asked for", () => {
  void it("refuses more answers than the pipeline sent commands", async () => {
    const { store } = storeOverSocket([":7\r\n", ":1\r\n", ":1\r\n"], OPEN_URL);
    await assert.rejects(
      store.increment(WINDOW),
      /answered \d+ commands for a pipeline of \d+/,
      "an answer to a command never sent is not this conversation",
    );
  });

  void it("refuses an AUTH the store did not accept, however readable the count behind it", async () => {
    const { store } = storeOverSocket(["+PONG\r\n", ":7\r\n", ":1\r\n"]);
    await assert.rejects(
      store.increment(WINDOW),
      /did not accept the credential/,
      "`+OK` is Redis accepting the credential, and nothing else is",
    );
  });

  void it("refuses a window the store left without its expiry", async () => {
    const { store } = storeOverSocket(["+OK\r\n", ":7\r\n", ":0\r\n"]);
    await assert.rejects(
      store.increment(WINDOW),
      /did not give the window an expiry/,
      "`0` is Redis not setting the timeout: the key would never die",
    );
  });

  void it("refuses an increment that answered no count this service ever wrote", async () => {
    await assert.rejects(
      storeOverSocket(["+OK\r\n", ":0\r\n", ":1\r\n"]).store.increment(WINDOW),
      /increment answered with no positive count/,
      "the store never answers zero",
    );
    await assert.rejects(
      storeOverSocket(["+OK\r\n", ":-4\r\n", ":1\r\n"]).store.increment(WINDOW),
      /increment answered with no positive count/,
      "nor a negative reply, which is no count at all",
    );
  });
});

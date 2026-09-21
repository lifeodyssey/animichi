import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STORE_TIMEOUT_MS } from "../src/redis-tcp-ceiling-store.ts";
import { connectedWithin, type DialingSocket } from "../src/start-egress-server.ts";

/**
 * The composition root's dial (#1824), and the one thing only its deadline can
 * say: an address that answers no SYN at all is a store this service cannot
 * reach, and "cannot reach" has to refuse inside the store's own timeout rather
 * than hold the request until the operating system abandons the connection.
 *
 * The socket is a double the test owns, because the only alternative is a real
 * black-holed address — the network this package's tests never touch.
 */

interface DialingDouble extends DialingSocket {
  /** Whether the deadline closed the socket it was given. */
  closed(): boolean;
}

/** A socket that connects and fails exactly as often as it is told to: never. */
function silentSocket(): DialingDouble {
  let closed = false;
  return {
    closed: () => closed,
    destroy: () => {
      closed = true;
    },
    once: () => undefined,
  };
}

void describe("connectedWithin — the dial is held to the store's own timeout", () => {
  void it("closes the socket and refuses when it has not connected by the deadline", async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const socket = silentSocket();
    const dialled = connectedWithin(socket);
    context.mock.timers.tick(STORE_TIMEOUT_MS);
    assert.equal(socket.closed(), true, "a dial past its deadline must be closed, not left pending");
    await assert.rejects(dialled, Error, "a store that answers no SYN is unreachable, not slow");
  });
});

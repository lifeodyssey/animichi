import crypto from "node:crypto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CEILING_VAR, CURRENT_KEY_VAR, readEgressConfig } from "../src/egress-config.ts";
import { STORE_TIMEOUT_MS } from "../src/redis-tcp-ceiling-store.ts";
import { ceilingFor, connectedWithin, type DialingSocket } from "../src/start-egress-server.ts";
import { CeilingStoreError, type CeilingStore } from "../src/upstream-ceiling.ts";

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

/**
 * The composition root's other seam (#1833). The ceiling it builds is the one
 * that has to report a store failure, and a reporter dropped here is a line
 * this service writes for nobody — which is the whole defect, one level up. So
 * the wiring is driven through the exported function rather than assumed from
 * the constructor's type: the type requires SOME reporter, not this one.
 */
void describe("ceilingFor — a store failure leaves by the operator's sink", () => {
  void it("hands the ceiling a reporter that writes to the sink the caller named", async () => {
    const lines: string[] = [];
    const config = readEgressConfig({
      [CURRENT_KEY_VAR]: crypto.randomBytes(48).toString("base64"),
      [CEILING_VAR]: "100",
    });
    const store: CeilingStore = {
      increment: () =>
        Promise.reject(new CeilingStoreError("expiry", "the ceiling store did not give the window an expiry")),
    };
    const ceiling = ceilingFor(
      config,
      { env: {}, ceilingStore: store, logSink: (line) => { lines.push(line); } },
      () => 0,
    );
    assert.equal(await ceiling?.tryAcquire(), "store-unavailable", "the caller still reads the ceiling's refusal");
    assert.equal(lines.length, 1, "a store failure this service cannot write is the defect #1833 closes");
    assert.match(
      lines[0] ?? "",
      /did not give the window an expiry/,
      "the store's own message, not a paraphrase, is what has to reach the sink",
    );
  });
});

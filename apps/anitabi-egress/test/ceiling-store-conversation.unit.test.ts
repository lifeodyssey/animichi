import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OPEN_URL, REQUEST, storeOverSocket } from "./store-over-socket.ts";

/**
 * SUT: the reply SET the ceiling's store must answer with (#1825), as distinct
 * from any one reply. The adapter reads the window's answer by the POSITION its
 * EVAL was sent at, so the one reply set it may read as a decision is the
 * conversation its pipeline asked for: one answer per command sent, the AUTH —
 * at most one, since a URL carries one credential — answered `+OK`, and the
 * script's `1` or `0`.
 *
 * Each case below WOULD otherwise read as a decision. A reply beyond the last
 * command leaves the positions alone and is read anyway; any status at all
 * passes where the AUTH's `+OK` belongs; the script's own expiry guard is an
 * error that names the window's missing expiry; and any other answer — another
 * number, another error — is no decision at all. So each is a refusal here.
 *
 * Each refusal is asserted as the message its OWN guard writes (#1834), so a
 * green test says which guard refused, not merely that one did. What the
 * adapter WRITES, how it frames a reply, and how a connection that never
 * answers is refused are pinned in `redis-tcp-ceiling-store.unit.test.ts`.
 */

/** Answers in the decision's slot that are no decision, each as a store could send it. */
const NO_DECISION = [
  { what: "a count, as the old increment answered", reply: ":2\r\n" },
  { what: "a negative number", reply: ":-1\r\n" },
  { what: "the script's guard on a member it had already counted", reply: "-MEMBER the admission was already counted\r\n" },
  { what: "an error Redis raised while running the script", reply: "-ERR user_script:1: Script attempted to access nonexistent global variable 'now'\r\n" },
];

void describe("a reply set that is not the conversation asked for", () => {
  void it("refuses more answers than the pipeline sent commands", async () => {
    const { store } = storeOverSocket([":1\r\n", ":1\r\n"], OPEN_URL);
    await assert.rejects(
      store.admit(REQUEST),
      /answered 2 commands for a pipeline of 1/,
      "an answer to a command never sent is not this conversation",
    );
  });

  void it("refuses an AUTH the store did not accept, however readable the decision behind it", async () => {
    const { store } = storeOverSocket(["+PONG\r\n", ":1\r\n"]);
    await assert.rejects(
      store.admit(REQUEST),
      /did not accept the credential/,
      "`+OK` is Redis accepting the credential, and nothing else is",
    );
  });

  void it("refuses a window the script could not give an expiry", async () => {
    const { store } = storeOverSocket(["+OK\r\n", "-EXPIRY the window was left without an expiry\r\n"]);
    await assert.rejects(
      store.admit(REQUEST),
      /did not give the window an expiry/,
      "a window without an expiry is a key that never dies",
    );
  });

  for (const { what, reply } of NO_DECISION) {
    void it(`refuses ${what} where the decision belongs`, async () => {
      const { store } = storeOverSocket(["+OK\r\n", reply]);
      await assert.rejects(store.admit(REQUEST), /answered no decision/, "only 1 and 0 are the window's answers");
    });
  }
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ceilingStoreFailureLogger, type LogSink } from "../src/ceiling-store-log.ts";
import {
  RedisTcpCeilingStore,
  STORE_TIMEOUT_MS,
  type StoreConnect,
  type StoreSocket,
} from "../src/redis-tcp-ceiling-store.ts";
import {
  UpstreamRequestCeiling,
  type CeilingDecision,
  type CeilingStore,
  type CeilingStoreFailureCode,
} from "../src/upstream-ceiling.ts";

/**
 * Where a store failure goes so an operator can read it (#1833) — the other
 * half of what `CeilingDecision` is not. The caller reads three outcomes; the
 * operator reads WHICH of the store's failures it was, and this file drives the
 * real store over a socket the test owns so both are asserted at once.
 *
 * The store's Private URL carries a password, so no failure path may write any
 * part of the address. `PASSWORD` is zero-entropy on purpose — neither the
 * repository's disclosure scan (a secret NAME beside a value) nor gitleaks (a
 * key-shaped run) reads it — and the positive control at the end proves the
 * absence check fires on a line that DID interpolate the URL.
 */

/** The store's password: zero entropy, in the shape the Private URL carries it. */
const PASSWORD = "aaaaaaaaaaaaaaaa";

/** The Private URL `fly redis status` prints: the store's credential is inside the address. */
const PRIVATE_URL = `redis://default:${PASSWORD}@fly-anitabi-test.upstash.io:6379`;

/** The same store reached by an address carrying no credential, so no AUTH reply is owed. */
const OPEN_URL = "redis://fly-anitabi-test.upstash.io:6379";

/** A moment inside the hour this ceiling counts in. */
const NOW_SECONDS = 1_700_000_100;

/** What a connection does when it is not going to answer. */
type Ending = "hang-up" | "fail";

/** A socket the test owns: it answers the store's one write with `answer`, then does `ending`. */
function socketAnswering(answer: readonly string[] = [], ending: Ending | null = null): StoreSocket {
  const data: ((chunk: Uint8Array) => void)[] = [];
  const errors: ((cause: unknown) => void)[] = [];
  const closures: (() => void)[] = [];
  return {
    write: () => {
      for (const piece of answer) for (const tell of data) tell(new TextEncoder().encode(piece));
      if (ending === "hang-up") for (const tell of closures) tell();
      if (ending === "fail") for (const tell of errors) tell(new Error("read ECONNRESET"));
    },
    destroy: () => undefined,
    onData: (tell) => { data.push(tell); },
    onError: (tell) => { errors.push(tell); },
    onClose: (tell) => { closures.push(tell); },
  };
}

/** A store over a socket the test owns, reached at `url`. */
function storeOver(answer: readonly string[] = [], url = PRIVATE_URL, ending: Ending | null = null): RedisTcpCeilingStore {
  const connect: StoreConnect = () => Promise.resolve(socketAnswering(answer, ending));
  return new RedisTcpCeilingStore({ url, connect });
}

/** A store whose dial never opens: the connect seam rejects, as an address answering no SYN does. */
function storeUnreachable(): RedisTcpCeilingStore {
  const connect: StoreConnect = () => Promise.reject(new Error("connect ECONNREFUSED ::1:6379"));
  return new RedisTcpCeilingStore({ url: PRIVATE_URL, connect });
}

/** A store that fails without naming a code: a second implementation that does not speak the vocabulary. */
function storeThatNamesNoCode(): CeilingStore {
  return { increment: () => Promise.reject(new Error("the ceiling store did not answer")) };
}

/** A ceiling over `store`, whose store failures land in `lines` — the operator's surface, as the service writes it. */
function ceilingOver(store: CeilingStore, lines: string[], limit = 100): UpstreamRequestCeiling {
  const sink: LogSink = (line) => { lines.push(line); };
  return new UpstreamRequestCeiling(limit, store, ceilingStoreFailureLogger(sink), () => NOW_SECONDS);
}

/** The one line an operator reads, and the assertion that there was one: a failure that writes nothing is #1833. */
function failureLine(lines: readonly string[]): { code: string; message: string } {
  assert.equal(lines.length, 1, "a store failure must reach the operator as exactly one line");
  const line = lines[0];
  assert.ok(line !== undefined, "the store's own message reached nobody: the ceiling's catch bound nothing (#1833)");
  return JSON.parse(line) as { code: string; message: string };
}

/** Whether a line carries any part of the store's address that is a credential. */
function carriesStoreCredential(line: string): boolean {
  return line.includes(PRIVATE_URL) || line.includes(PASSWORD);
}

/** Let every microtask the store queued run, so its timer exists before the test's clock moves. */
function drained(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** The count a store answers with, as the reply set of an address that carries a credential. */
function counted(count: number): string[] {
  return [`+OK\r\n:${String(count)}\r\n:1\r\n`];
}

/** One way the store fails: how it is driven, and what the operator must read. */
interface StoreFailure {
  readonly what: string;
  readonly code: CeilingStoreFailureCode;
  readonly message: RegExp;
  readonly store: () => CeilingStore;
}

/** The four reply-set guards of #1825, each of which would otherwise read as a count. */
const GUARDS: readonly StoreFailure[] = [
  { what: "an answer the pipeline never asked for", code: "reply-count", message: /answered 3 of 2 commands/,
    store: () => storeOver([":7\r\n:1\r\n:1\r\n"], OPEN_URL) },
  { what: "a credential the store refused", code: "credential", message: /did not accept the credential/,
    store: () => storeOver(["+PONG\r\n:7\r\n:1\r\n"]) },
  { what: "a window the store left without an expiry", code: "expiry", message: /did not give the window an expiry/,
    store: () => storeOver(["+OK\r\n:7\r\n:0\r\n"]) },
  { what: "an increment that answered no count", code: "count", message: /increment answered with no positive count/,
    store: () => storeOver(["+OK\r\n:0\r\n:1\r\n"]) },
];
/** The other ways the real store fails, each with the address in its scope — the no-secret table below. */
const TRANSPORT_FAILURES: readonly StoreFailure[] = [
  { what: "a reply header past any bound", code: "oversized-reply", message: /longer than any answer it owes/,
    store: () => storeOver(["A".repeat(4_096)], PRIVATE_URL, "hang-up") },
  { what: "a connection that failed", code: "connection", message: /connection failed/,
    store: () => storeOver([], PRIVATE_URL, "fail") },
  { what: "a connection hung up before answering", code: "hang-up", message: /closed the connection before answering/,
    store: () => storeOver([], PRIVATE_URL, "hang-up") },
  { what: "a dial that never opened", code: "unreachable", message: /ECONNREFUSED/, store: storeUnreachable },
];

/** Every way the real store fails: the four guards, then the four ways the connection itself ends. */
const STORE_FAILURES: readonly StoreFailure[] = [...GUARDS, ...TRANSPORT_FAILURES];

void describe("a store failure reaches the operator", () => {
  void it("reports each of the four #1825 guards as its own finding", async () => {
    const observed: CeilingStoreFailureCode[] = [];
    for (const guard of GUARDS) {
      const lines: string[] = [];
      const decision = await ceilingOver(guard.store(), lines).tryAcquire();
      assert.equal(decision, "store-unavailable", "the caller still reads one of exactly three outcomes");
      const line = failureLine(lines);
      assert.equal(line.code, guard.code, `${guard.what} must arrive as ${guard.code}`);
      assert.match(line.message, guard.message, `${guard.what} must keep the store's own words`);
      observed.push(line.code);
    }
    assert.deepEqual(
      observed,
      ["reply-count", "credential", "expiry", "count"],
      "the four guards must be four findings: a refused credential that reads like a missing expiry is the store's " +
        "diagnostics unreachable again, one level up (#1833)",
    );
  });

  void it("still reports a store that failed without naming a code of its own", async () => {
    const lines: string[] = [];
    await ceilingOver(storeThatNamesNoCode(), lines).tryAcquire();
    const line = failureLine(lines);
    assert.equal(line.code, "unreachable", "a store that does not speak the vocabulary must not be silent");
    assert.match(line.message, /did not answer/, "the message it did give must still reach the operator");
  });

  void it("reports a store that never answers, once its own timeout passes", async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const lines: string[] = [];
    const refused = ceilingOver(storeOver(["+OK\r\n:4"]), lines).tryAcquire();
    await drained();
    context.mock.timers.tick(STORE_TIMEOUT_MS);
    assert.equal(await refused, "store-unavailable");
    const line = failureLine(lines);
    assert.equal(line.code, "timeout", "a store that says nothing is not a store that refused");
    assert.match(line.message, /did not answer within its timeout/);
    assert.ok(!carriesStoreCredential(lines.join("")), "the timeout line must carry no part of the store's address");
  });
});

/**
 * The caller's surface, and the compile-time half of pinning it: a union
 * widened past these three leaves a key missing here and `tsc --noEmit` fails,
 * so the mutation the card names is red before any test runs.
 */
const CALLER_OUTCOMES: Record<CeilingDecision, true> = {
  granted: true,
  exhausted: true,
  "store-unavailable": true,
};

void describe("the caller still reads exactly three outcomes", () => {
  void it("reaches all three, and reports no fourth", async () => {
    const observed = [
      await ceilingOver(storeOver(counted(1)), []).tryAcquire(),
      await ceilingOver(storeOver(counted(2)), [], 1).tryAcquire(),
      await ceilingOver(storeOver([], PRIVATE_URL, "fail"), []).tryAcquire(),
    ];
    assert.deepEqual(
      observed,
      ["granted", "exhausted", "store-unavailable"],
      "a store failure must still reach the caller as `store-unavailable`, never as an outcome of its own",
    );
    assert.deepEqual(
      [...observed].sort(),
      Object.keys(CALLER_OUTCOMES).sort(),
      "the outcomes this ceiling returns must be exactly the three the caller knows",
    );
  });
});

void describe("no secret reaches the operator's line", () => {
  void it("carries neither the address nor its password on any failure path", async () => {
    for (const failure of STORE_FAILURES) {
      const lines: string[] = [];
      await ceilingOver(failure.store(), lines).tryAcquire();
      assert.equal(failureLine(lines).code, failure.code, `${failure.what} must arrive as ${failure.code}`);
      assert.ok(
        !carriesStoreCredential(lines.join("")),
        `${failure.what}: the line an operator reads must carry no part of the store's address`,
      );
    }
  });

  void it("would catch a line that did interpolate the address, so the check above is not merely present", () => {
    assert.ok(PRIVATE_URL.includes(PASSWORD), "the fixture must carry a password, or absence would prove nothing");
    assert.ok(
      carriesStoreCredential(`the ceiling store could not be reached at ${PRIVATE_URL}`),
      "a line interpolating the raw URL must be caught by the very predicate the table above asserts with",
    );
  });
});

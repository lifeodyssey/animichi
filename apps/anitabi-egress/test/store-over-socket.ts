import { RedisTcpCeilingStore, type StoreConnect, type StoreSocket } from "../src/redis-tcp-ceiling-store.ts";

/**
 * The store under test, over a socket the test owns (#1834): one builder and
 * one set of fixture addresses for every ceiling-store test that needs to drive
 * the real adapter through its injected connection.
 *
 * It is extracted rather than copied because the reply-set cases and the
 * store's own conversation cases are the same three things — a socket that
 * answers with the chunks a test names, the store dialled over it, and the
 * address that socket stands behind — and the second copy had already drifted
 * (it dropped the PASSWORD rationale below). It is named for what it builds,
 * not for the tests that use it.
 *
 * The CONNECTION is injected, the way the relay's fetch is: the store module
 * names no network module and no global network function, so a test hands it a
 * socket it owns and reads the exact bytes that would have gone on the wire.
 * Nothing here opens a real Redis, and nothing in this package leaves the
 * loopback.
 */

/**
 * The password the store's own address carries: an obviously-fake constant, the
 * form this repository's test credentials take. Neither scan reads it — the
 * disclosure scan wants one of the service's secret names on the line, and
 * gitleaks wants a key-shaped run — so it is written out as the words it is.
 */
export const PASSWORD = "the-tests-own-password";

/** The Private URL `fly redis status` prints: the store's credential is inside the address. */
export const PRIVATE_URL = `redis://default:${PASSWORD}@fly-anitabi-test.upstash.io:6379`;

/** The same store reached by an address that carries no credential, so no AUTH reply is owed. */
export const OPEN_URL = "redis://fly-anitabi-test.upstash.io:6379";

/** The hour this adapter is asked to count in. */
export const WINDOW = "anitabi-egress:upstream-requests:472222";

/** What a connection does when it is not going to answer. */
export type Ending = "hang-up" | "fail";

/** The socket a test owns, and the two things it reads back off the store's side of the conversation. */
export interface SocketDouble {
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
  const chunks = answer.map((piece) => new TextEncoder().encode(piece));
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
        for (const arrived of chunks) each(data, arrived);
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

/** What the store under test was built over, and the addresses it dialled. */
export interface StoreOverSocket {
  readonly store: RedisTcpCeilingStore;
  readonly socket: SocketDouble;
  readonly dialled: string[];
}

/** The store under test over a socket the test owns, reached at `url` and answered with `answer`. */
export function storeOverSocket(answer: readonly string[] = [], url = PRIVATE_URL, ending: Ending | null = null): StoreOverSocket {
  const socket = socketDouble(answer, ending);
  const dialled: string[] = [];
  const connect: StoreConnect = (target) => {
    dialled.push(target);
    return Promise.resolve(socket.socket);
  };
  return { store: new RedisTcpCeilingStore({ url, connect }), socket, dialled };
}

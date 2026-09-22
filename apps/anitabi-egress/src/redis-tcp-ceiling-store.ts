/**
 * The ceiling's counter, in the Redis `fly redis create` provisions (#1810,
 * #1824) — the adapter for the one thing this service keeps outside itself.
 *
 * WHY TCP. #1810's store was an HTTPS REST endpoint addressed by a second
 * secret. Fly's Redis extension is not that: it hands out one Private URL
 * (`redis://…`), it has no REST API, and `fly redis status` prints nothing an
 * HTTPS adapter could be filled from. So the store is spoken to the way Redis
 * is spoken to — RESP over a TCP connection — and the URL is the whole
 * configuration.
 *
 * The store holds ONE INTEGER PER HOUR and the service does exactly two things
 * to it: `INCR` the hour's key, and give that key a life past its own hour.
 * Both travel in ONE write, so a window cannot be incremented here and left
 * without an expiry; the increment's own answer is the count, and Redis'
 * `INCR` is atomic, so two requests racing in one instance (or in two) cannot
 * both be told they are the hundredth. The address's own password, when it
 * carries one, is `AUTH` in front of them — pipelined into the same write,
 * because Redis runs a pipeline's commands in order and the increment must not
 * arrive unauthenticated.
 *
 * What the commands MEAN is here; the bytes of their replies are framed in
 * `resp-replies.ts`, and this module is what turns the reply into the count — or
 * into a refusal, in every other way the exchange can end.
 *
 * THE REPLY SET IS READ WHOLE (#1825): one reply per command sent, each AUTH
 * answered `+OK`, the increment a POSITIVE count, the expiry `1`. A set that is
 * not that one is a refusal — each of the four is a reply that would otherwise
 * read as a count, and each says below what it would have read as.
 *
 * The counter is MONOTONE within its hour: it counts admissions the service
 * attempted, including the ones the ceiling then refused, so a refusal never
 * frees a slot. Over-counting is the safe direction for a promise, and it is
 * what makes the store's number the only number.
 *
 * The CONNECTION is INJECTED, exactly as the relay's fetch is: this module
 * names no network module and no global network function, so the service's
 * whole outbound surface stays the composition root's one reviewed value. The
 * destination is the environment's (`CEILING_STORE_URL`), never a request's,
 * and the credential rides inside that address and nowhere else.
 *
 * Every failure is a rejection — an unreachable store, a refused AUTH, a
 * connection that drops, a reply that is not the answer asked for. None of
 * them may read as a count: a store whose failures were tolerated is a ceiling
 * that is not enforced. Each rejection carries the failure code an operator
 * reads (#1833), so the four reply-set guards below are four findings.
 */
import { ReplyBuffer, type Reply } from "./resp-replies.ts";
import { CeilingStoreError, type CeilingStore, type CeilingStoreFailureCode } from "./upstream-ceiling.ts";

/**
 * How long a window's key outlives its hour. Comfortably past the hour it
 * counts, so a late request still finds its own window, and finite, so a store
 * accumulates one key per hour rather than one per hour forever.
 */
const WINDOW_TTL_SECONDS = 2 * 60 * 60;

/**
 * How long the store has to answer, and how long its connection has to open. It
 * is one atomic increment on a counter this service owns: a store that cannot
 * manage it inside this is not slow, and the caller is better served by a
 * refusal than by a held connection. The composition root holds the dial to the
 * same number (#1824), so reaching the store is inside a deadline too — an
 * address that answers no SYN refuses here rather than at the operating
 * system's own TCP timeout.
 */
export const STORE_TIMEOUT_MS = 5_000;

/** RESP2's terminator: every header and every bulk string ends with these two bytes. */
const CRLF = "\r\n";

/**
 * The refusal for a header longer than the longest one `resp-replies.ts` will
 * read: bytes that are not an answer to anything, however the endpoint ends
 * them.
 */
const OVERSIZED_REPLY_HEADER = "the ceiling store sent a reply header longer than any answer it owes";

/** One command, as its argument vector. */
type Command = readonly string[];

/**
 * A connected socket, reduced to the four things this adapter uses. The
 * composition root adapts the real one; nothing here knows what it is.
 */
export interface StoreSocket {
  /** Put bytes on the wire. */
  write(data: string): void;
  /** Close it, once the conversation is over — answered or not. */
  destroy(): void;
  onData(listener: (chunk: Uint8Array) => void): void;
  onError(listener: (cause: unknown) => void): void;
  onClose(listener: () => void): void;
}

/**
 * The network function the composition root injects; see the module header.
 * One call, one connection: a socket is opened, used, and closed.
 */
export type StoreConnect = (url: string) => Promise<StoreSocket>;

export interface RedisTcpCeilingStoreOptions {
  /** The store's Private URL, as `readCeilingStoreConfig` accepted it. */
  readonly url: string;
  readonly connect: StoreConnect;
}

export class RedisTcpCeilingStore implements CeilingStore {
  constructor(private readonly options: RedisTcpCeilingStoreOptions) {}

  /** Count one request against `window`, and answer with that window's new total. */
  async increment(window: string): Promise<number> {
    const auth = authCommands(this.options.url);
    const commands = [...auth, ...counterCommands(window)];
    const socket = await this.options.connect(this.options.url);
    try {
      const replies = await exchange(socket, commands);
      return countFrom(replies, auth.length, commands.length);
    } finally {
      socket.destroy();
    }
  }
}

/** The window's own count, and the life it is given, in the order Redis must run them. */
function counterCommands(window: string): Command[] {
  return [
    ["INCR", window],
    ["EXPIRE", window, String(WINDOW_TTL_SECONDS)],
  ];
}

/**
 * The AUTH the address itself carries — the Private URL's password and the
 * user it names, if any — or nothing when the address holds no credential.
 * Redis 6's two-argument form is what a URL naming a user asks for.
 */
function authCommands(url: string): Command[] {
  const address = new URL(url);
  if (address.password === "") return [];
  const password = decodeURIComponent(address.password);
  return address.username === ""
    ? [["AUTH", password]]
    : [["AUTH", decodeURIComponent(address.username), password]];
}

/** Write every command in one payload, and collect the one reply each command is owed. */
function exchange(socket: StoreSocket, commands: readonly Command[]): Promise<Reply[]> {
  return new Promise((resolve, reject) => {
    const reader = new ReplyReader(commands.length, resolve, reject);
    socket.onData((chunk) => { reader.arrived(chunk); });
    socket.onError((cause) => { reader.failed(cause); });
    socket.onClose(() => { reader.hungUp(); });
    socket.write(encodeCommands(commands));
  });
}

/**
 * One exchange, in flight: the bytes that have arrived, the replies still owed,
 * and the single outcome it settles on. A connection that fails, hangs up, or
 * says nothing before the timeout ends as a refusal — the store's whole job is
 * to be believed, so no other ending is allowed to look like an answer.
 */
class ReplyReader {
  private readonly buffered = new ReplyBuffer();
  private readonly replies: Reply[] = [];
  private readonly timer: ReturnType<typeof setTimeout>;
  private settled = false;

  constructor(
    private readonly owed: number,
    private readonly resolve: (replies: Reply[]) => void,
    private readonly reject: (cause: Error) => void,
  ) {
    this.timer = setTimeout(() => {
      this.fail("timeout", "the ceiling store did not answer within its timeout");
    }, STORE_TIMEOUT_MS);
  }

  /** Bytes off the wire, in whatever pieces they arrive: whole replies are counted, the last one grants. */
  arrived(chunk: Uint8Array): void {
    this.buffered.push(chunk);
    if (this.buffered.overlong()) {
      this.fail("oversized-reply", OVERSIZED_REPLY_HEADER);
      return;
    }
    for (let reply = this.buffered.next(); reply !== undefined; reply = this.buffered.next()) {
      this.replies.push(reply);
    }
    if (this.replies.length >= this.owed) this.grant();
  }

  failed(cause: unknown): void {
    this.fail("connection", `the ceiling store's connection failed (${String(cause)})`);
  }

  hungUp(): void {
    this.fail("hang-up", "the ceiling store closed the connection before answering");
  }

  private grant(): void {
    this.settle(() => {
      this.resolve(this.replies);
    });
  }

  private fail(code: CeilingStoreFailureCode, message: string): void {
    this.settle(() => {
      this.reject(new CeilingStoreError(code, message));
    });
  }

  private settle(outcome: () => void): void {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.timer);
    outcome();
  }
}

/**
 * The count in a WHOLE conversation, or a refusal: `replies` answers the `owed`
 * commands that went out, of which the first `authCount` were the address's
 * AUTH. Every slot has one answer and one shape, so a set that is not the one
 * asked for is refused here rather than read as a count, and each guard names
 * the code an operator reads (#1833) so the refusal says WHICH of them fired.
 */
function countFrom(replies: readonly Reply[], authCount: number, owed: number): number {
  requireEveryCommandAnswered(replies, owed);
  requireCredentialAccepted(replies, authCount);
  requireExpirySet(replies[authCount + 1]);
  return countIn(replies, authCount);
}

/**
 * One reply per command sent, and no more: `countIn` reads the increment's
 * answer by the POSITION it was sent at, which is only that answer while the
 * store answered the pipeline it was given. A reply beyond the last command is
 * a peer answering something else, however readable its elements are.
 */
function requireEveryCommandAnswered(replies: readonly Reply[], owed: number): void {
  if (replies.length === owed) return;
  const answered = `the ceiling store answered ${String(replies.length)} of ${String(owed)} commands`;
  throw new CeilingStoreError("reply-count", answered);
}

/**
 * The credential the address carries was ACCEPTED — which Redis says with
 * `+OK` and with no other status: anything else in an AUTH slot is not this
 * store's answer to the AUTH, however well the rest of the pipeline reads.
 */
function requireCredentialAccepted(replies: readonly Reply[], authCount: number): void {
  const accepted = replies.slice(0, authCount).every((reply) => reply.kind === "status" && reply.value === "OK");
  if (accepted) return;
  throw new CeilingStoreError("credential", "the ceiling store did not accept the credential its address carries");
}

/**
 * The expiry was SET, which Redis answers `1` for and `0` when it did not — and
 * a window the increment created without one is a key that never dies, which is
 * not the counter this service asked for. The increment has just made the key,
 * so `1` is the only answer to this EXPIRE that leaves the store as promised.
 */
function requireExpirySet(reply: Reply | undefined): void {
  if (reply?.kind !== "integer" || reply.value !== 1) {
    throw new CeilingStoreError("expiry", "the ceiling store did not give the window an expiry");
  }
}

/**
 * The replies owed after the AUTH ones: the increment's count, which is the
 * whole answer — and a COUNT, so positive. `upstream-ceiling.ts` promises the
 * store "never answers a lower number and never answers zero"; this is where
 * that promise is kept, because the ceiling reads any number here as a total.
 */
function countIn(replies: readonly Reply[], authCount: number): number {
  const increment = replies[authCount];
  if (increment?.kind !== "integer" || increment.value <= 0) {
    throw new CeilingStoreError("count", "the ceiling store's increment answered with no positive count");
  }
  return increment.value;
}

/** RESP2's array of bulk strings — the only request shape this adapter writes. */
function encodeCommands(commands: readonly Command[]): string {
  return commands.map(encodeCommand).join("");
}

function encodeCommand(command: Command): string {
  return `*${String(command.length)}${CRLF}${command.map(bulk).join("")}`;
}

/** A bulk string's own framing: its length is the bytes that follow, not the characters. */
function bulk(argument: string): string {
  return `$${String(Buffer.byteLength(argument, "utf8"))}${CRLF}${argument}${CRLF}`;
}

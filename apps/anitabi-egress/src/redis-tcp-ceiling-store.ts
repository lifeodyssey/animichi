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
 * that is not enforced.
 */
import type { CeilingStore } from "./upstream-ceiling.ts";

/**
 * How long a window's key outlives its hour. Comfortably past the hour it
 * counts, so a late request still finds its own window, and finite, so a store
 * accumulates one key per hour rather than one per hour forever.
 */
const WINDOW_TTL_SECONDS = 2 * 60 * 60;

/**
 * How long the store has to answer. It is one atomic increment on a counter
 * this service owns: a store that cannot manage it inside this is not slow,
 * and the caller is better served by a refusal than by a held connection.
 */
const STORE_TIMEOUT_MS = 5_000;

/** RESP2's terminator: every header and every bulk string ends with these two bytes. */
const CRLF = "\r\n";

/** A RESP reply, as far as this pipeline can read one — the types it is owed, and no other. */
type Reply =
  | { readonly kind: "status"; readonly value: string }
  | { readonly kind: "integer"; readonly value: number }
  | { readonly kind: "error"; readonly value: string };

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

/** A store that could not answer. The ceiling turns it into its own refusal. */
class CeilingStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CeilingStoreError";
  }
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
      refuseErrors(replies);
      return countIn(replies, auth.length);
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
      this.fail("the ceiling store did not answer within its timeout");
    }, STORE_TIMEOUT_MS);
  }

  /** Bytes off the wire, in whatever pieces they arrive: whole replies are counted, the last one grants. */
  arrived(chunk: Uint8Array): void {
    this.buffered.push(chunk);
    for (let reply = this.buffered.next(); reply !== undefined; reply = this.buffered.next()) {
      this.replies.push(reply);
    }
    if (this.replies.length >= this.owed) this.grant();
  }

  failed(cause: unknown): void {
    this.fail(`the ceiling store's connection failed (${String(cause)})`);
  }

  hungUp(): void {
    this.fail("the ceiling store closed the connection before answering");
  }

  private grant(): void {
    this.settle(() => {
      this.resolve(this.replies);
    });
  }

  private fail(message: string): void {
    this.settle(() => {
      this.reject(new CeilingStoreError(message));
    });
  }

  private settle(outcome: () => void): void {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.timer);
    outcome();
  }
}

/** The replies owed after the AUTH ones: the increment's count, which is the whole answer. */
function countIn(replies: readonly Reply[], authCount: number): number {
  const increment = replies[authCount];
  if (increment?.kind !== "integer") {
    throw new CeilingStoreError("the ceiling store's increment answered with no integer count");
  }
  return increment.value;
}

/**
 * Any error reply is a refusal. Redis runs a pipeline's commands in order and
 * answers each one, so an error element means the window was not counted as
 * asked — an increment that landed without its expiry is a key that never
 * dies, which is not the counter this service asked for.
 */
function refuseErrors(replies: readonly Reply[]): void {
  for (const reply of replies) {
    if (reply.kind === "error") throw new CeilingStoreError(`the ceiling store refused a command (${reply.value})`);
  }
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

/** The store's bytes, held until a whole reply has arrived — RESP frames them, so a part is not one. */
class ReplyBuffer {
  private readonly bytes: number[] = [];

  push(chunk: Uint8Array): void {
    for (const byte of chunk) this.bytes.push(byte);
  }

  /** The next whole reply, or undefined while the rest is still in flight. */
  next(): Reply | undefined {
    const parsed = parseReply(this.bytes);
    if (parsed === null) return undefined;
    this.bytes.splice(0, parsed.consumed);
    return parsed.reply;
  }
}

/**
 * One reply and the bytes it took, or null while it is incomplete. A reply type
 * this pipeline never asked for — a bulk string, an array, the inline form —
 * is read as the error it is rather than guessed at: this conversation has
 * exactly two answers, and an answer that is neither is a store failure.
 */
function parseReply(bytes: readonly number[]): { reply: Reply; consumed: number } | null {
  const end = lineEnd(bytes);
  if (end < 0) return null;
  const header = String.fromCharCode(...bytes.slice(1, end));
  const consumed = end + 2;
  if (bytes[0] === 43) return { reply: { kind: "status", value: header }, consumed };
  if (bytes[0] === 45) return { reply: { kind: "error", value: header }, consumed };
  if (bytes[0] === 58) return { reply: integerReply(header), consumed };
  return { reply: { kind: "error", value: `an unsupported reply type (${header})` }, consumed };
}

/** `:123` is a count only when it is digits and nothing else, and one Number can hold exactly. */
function integerReply(header: string): Reply {
  if (!/^-?\d+$/.test(header)) return { kind: "error", value: `an integer reply that is not one (${header})` };
  const value = Number(header);
  return Number.isSafeInteger(value)
    ? { kind: "integer", value }
    : { kind: "error", value: `a count too large to hold (${header})` };
}

/** Where the header's own CRLF starts, or -1 while it has not arrived. */
function lineEnd(bytes: readonly number[]): number {
  for (let index = 1; index < bytes.length; index += 1) {
    if (bytes[index] === 13 && bytes[index + 1] === 10) return index;
  }
  return -1;
}

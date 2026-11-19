/**
 * The ceiling's window, in the Redis `fly redis create` provisions (#1810,
 * #1824) — the adapter for the one thing this service keeps outside itself.
 *
 * WHY TCP. #1810's store was an HTTPS REST endpoint addressed by a second
 * secret. Fly's Redis extension is not that: it hands out one Private URL
 * (`redis://…`), it has no REST API, and `fly redis status` prints nothing an
 * HTTPS adapter could be filled from. So the store is spoken to the way Redis
 * is spoken to — RESP over a TCP connection — and the URL is the whole
 * configuration.
 *
 * ONE CALL PER REQUEST. Each admission is one EVAL of the window's script
 * (`rolling-window-script.ts`), which the store runs whole, so two requests
 * racing in one instance (or in two) cannot both be told there was room. The
 * address's own password, when it carries one, is `AUTH` in front of it, in the
 * same write: Redis runs a pipeline's commands in order, and the script must
 * not arrive unauthenticated. What the script DECIDES is there; the replies are
 * framed in `resp-replies.ts`; this module turns the reply into an admission —
 * or into a refusal, in every other way the exchange can end.
 *
 * THE REPLY SET IS READ WHOLE (#1825): one reply per command sent, the AUTH the
 * address may owe (at most one: a URL carries one credential) answered `+OK`,
 * and the script's `1` or `0`. A set that is not that one is a refusal, and
 * each guard below says what its reply would otherwise read as.
 *
 * The CONNECTION is INJECTED, exactly as the relay's fetch is: this module
 * names no network module and no global network function, so the service's
 * whole outbound surface stays the composition root's one reviewed value. The
 * destination is the environment's (`CEILING_STORE_URL`), never a request's,
 * and the credential rides inside that address and nowhere else.
 *
 * Every failure is a rejection — an unreachable store, a refused AUTH, a
 * connection that drops, a reply that is not the answer asked for. None of
 * them may read as an admission: a store whose failures were tolerated is a
 * ceiling that is not enforced. Each rejection carries the failure code an
 * operator reads (#1833), so the four reply-set guards below are four findings.
 * A timeout can fall after the store has already run the script: that
 * admission is then recorded and refused here, which over-counts, the safe
 * direction for a promise.
 */
import { randomUUID } from "node:crypto";
import { ReplyBuffer, type Reply } from "./resp-replies.ts";
import { STORE_CLOCK, windowCommand, type ScriptClock } from "./rolling-window-script.ts";
import {
  CeilingStoreError,
  type Admission,
  type AdmissionRequest,
  type CeilingStore,
  type CeilingStoreFailureCode,
} from "./upstream-ceiling.ts";

/**
 * How long the store has to answer, and how long its connection has to open. It
 * is one short script over a window this service owns: a store that cannot
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
  /** Where the window's `now` comes from: the store's own clock, unless a test hands it another. */
  readonly clock?: ScriptClock;
  /** A fresh member for each admission: random, unless a test pins the bytes. */
  readonly newMember?: () => string;
}

export class RedisTcpCeilingStore implements CeilingStore {
  constructor(private readonly options: RedisTcpCeilingStoreOptions) {}

  /** Ask the window to admit one request, and answer with what it decided. */
  async admit(request: AdmissionRequest): Promise<Admission> {
    const auth = authCommands(this.options.url);
    const commands = [...auth, this.windowCommandFor(request)];
    const socket = await this.options.connect(this.options.url);
    try {
      return admissionFrom(await exchange(socket, commands), auth.length, commands.length);
    } finally {
      socket.destroy();
    }
  }

  /** The window's one call for `request`, on this store's clock, under a member of its own. */
  private windowCommandFor(request: AdmissionRequest): Command {
    const member = (this.options.newMember ?? randomUUID)();
    return windowCommand(this.options.clock ?? STORE_CLOCK, request, member);
  }
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
 * The window's decision in a WHOLE conversation, or a refusal: `replies`
 * answers the `owed` commands that went out, of which the first `authCount`
 * were the address's AUTH. Every slot has one answer and one shape, so a set
 * that is not the one asked for is refused here rather than read as a decision,
 * and each guard names the code an operator reads (#1833) so the refusal says
 * WHICH of them fired.
 */
function admissionFrom(replies: readonly Reply[], authCount: number, owed: number): Admission {
  requireEveryCommandAnswered(replies, owed);
  requireCredentialAccepted(replies, authCount);
  return admissionIn(replies[authCount]);
}

/**
 * One reply per command sent, and no more: `admissionIn` reads the window's
 * answer by the POSITION its EVAL was sent at, which is only that answer while
 * the store answered the pipeline it was given. The reader grants as soon as it
 * holds `owed` replies and hands that array over, so the extra refused here is
 * one that arrived WITH them: a later one lands after the decision is read and
 * never reaches this guard, and no grant is ever short.
 */
function requireEveryCommandAnswered(replies: readonly Reply[], owed: number): void {
  if (replies.length === owed) return;
  const answered = `the ceiling store answered ${String(replies.length)} commands for a pipeline of ${String(owed)}`;
  throw new CeilingStoreError("reply-count", answered);
}

/**
 * The credential the address carries was ACCEPTED — which Redis says with
 * `+OK` and with no other status: anything else in the one AUTH slot a URL can
 * owe is not this store's answer to the AUTH, however well the rest reads.
 */
function requireCredentialAccepted(replies: readonly Reply[], authCount: number): void {
  const accepted = replies.slice(0, authCount).every((reply) => reply.kind === "status" && reply.value === "OK");
  if (accepted) return;
  throw new CeilingStoreError("credential", "the ceiling store did not accept the credential its address carries");
}

/** The window's two answers, and the decision each one is. */
const DECISIONS = new Map<number, Admission>([
  [1, "admitted"],
  [0, "refused"],
]);

/**
 * The reply owed after the AUTH ones: the script's `1` or `0`, which is the
 * whole answer. Anything else is refused here rather than read as a decision.
 */
function admissionIn(reply: Reply | undefined): Admission {
  const decision = reply?.kind === "integer" ? DECISIONS.get(reply.value) : undefined;
  if (decision !== undefined) return decision;
  throw refusalFor(reply);
}

/**
 * The refusal an answer that is no decision gets. The script's own guard on the
 * window's expiry answers an error whose first word is `EXPIRY`: an admission
 * left without one is a key that never dies, which is not the window this
 * service asked for. Every other answer — another error, another number,
 * another type — is no decision, and carries what the store did say.
 */
function refusalFor(reply: Reply | undefined): CeilingStoreError {
  if (reply?.kind === "error" && reply.value.startsWith("EXPIRY ")) {
    return new CeilingStoreError("expiry", "the ceiling store did not give the window an expiry");
  }
  const said = reply === undefined ? "nothing" : `${reply.kind} ${String(reply.value)}`;
  return new CeilingStoreError("decision", `the ceiling store's window answered no decision (${said})`);
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

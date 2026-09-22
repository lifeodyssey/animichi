/**
 * The replies of ONE RESP pipeline, as this service reads them off the bytes
 * (#1824): one reply per command the store was sent, in the order they were
 * sent, and no other shape — a bulk string, an array and the inline form are
 * read as the errors they are rather than guessed at, because this conversation
 * has exactly two answers and an answer that is neither is a store failure.
 *
 * WHY IT IS ITS OWN MODULE. What these functions read is BYTES; what the store
 * reads is REPLIES. The framing — the terminator, the length of a header, the
 * three reply types — is a thing the counter's conversation happens to need and
 * not a thing it is made of. The bound on a header also belongs beside the
 * decode it bounds: the buffer that grows, the limit that stops it growing, and
 * the read that has to stay inside that limit are one subject, and one file is
 * where a reader can check that the three agree.
 *
 * Nothing here touches a socket, a timer, or a policy: bytes come in, a reply
 * comes out, and a header too long to be a reply is something the caller is
 * TOLD rather than something this module decides the meaning of.
 */

/** A RESP reply, as far as this pipeline can read one — the types it is owed, and no other. */
export type Reply =
  | { readonly kind: "status"; readonly value: string }
  | { readonly kind: "integer"; readonly value: number }
  | { readonly kind: "error"; readonly value: string };

/**
 * The longest reply header this pipeline will read. Its whole conversation is
 * three small replies — `+OK`, the count, the expiry's answer — and Redis' own
 * longest error is far shorter than this, so a header that runs past it is bytes
 * that cannot be an answer. The bound is what stops an endpoint that never sends
 * a CRLF from growing the buffer without end, and it is what makes the decode
 * below a bounded read rather than one function argument per byte received.
 */
const MAX_REPLY_HEADER_BYTES = 512;

/** The store's bytes, held until a whole reply has arrived — RESP frames them, so a part is not one. */
export class ReplyBuffer {
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

  /**
   * Whether the first header has already run past the longest one this pipeline
   * reads — ended or not, because a header this long has stopped being a reply
   * whether or not the endpoint ever terminates it.
   */
  overlong(): boolean {
    const end = lineEnd(this.bytes);
    return (end < 0 ? this.bytes.length : end + 2) > MAX_REPLY_HEADER_BYTES;
  }
}

/**
 * One reply and the bytes it took, or null while it is incomplete.
 *
 * The header is decoded as the bytes it is — `latin1`, one code unit each, which
 * is what `fromCharCode` over a byte array meant — and never spread into one
 * function argument per byte: a spread builds a throw inside the socket's own
 * callback, where no rejection is left to carry it.
 */
function parseReply(bytes: readonly number[]): { reply: Reply; consumed: number } | null {
  const end = lineEnd(bytes);
  if (end < 0) return null;
  const header = Buffer.from(bytes.slice(1, end)).toString("latin1");
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

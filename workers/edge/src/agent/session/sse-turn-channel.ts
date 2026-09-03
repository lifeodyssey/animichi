/**
 * One connected client's live view of a running turn (card #1252), ported from
 * the W0-S4 spike's channel.
 *
 * The turn runs in the Durable Object's `alarm()` handler, not in the client's
 * `fetch` (spec `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §二), so this
 * deliberately survives its reader going away: a write to a client that hung up
 * is recorded and swallowed, and the alarm keeps driving the turn to completion.
 * `clientGone` is the evidence for "the client disconnected and the turn still
 * finished".
 *
 * The framing is `data:`-only, which is the SD-9 protocol's own (see
 * `turn-frames.ts`): the discriminator lives inside the JSON.
 */
import { DONE_FRAME, type TurnFrame } from "./turn-frames.ts";

export class SseTurnChannel {
  readonly #writer: WritableStreamDefaultWriter<Uint8Array>;
  readonly #encoder = new TextEncoder();
  #disconnected = false;
  readonly body: ReadableStream<Uint8Array>;

  constructor() {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    this.body = readable;
    this.#writer = writable.getWriter();
  }

  get clientGone(): boolean {
    return this.#disconnected;
  }

  async send(frame: TurnFrame): Promise<void> {
    await this.#write(`data: ${JSON.stringify(frame)}\n\n`);
  }

  /** The stream terminator: a bare token, not a JSON frame. */
  async finish(): Promise<void> {
    await this.#write(`data: ${DONE_FRAME}\n\n`);
    await this.close();
  }

  async close(): Promise<void> {
    if (this.#disconnected) return;
    try {
      await this.#writer.close();
    } catch {
      this.#disconnected = true;
    }
  }

  async #write(frame: string): Promise<void> {
    if (this.#disconnected) return;
    try {
      await this.#writer.write(this.#encoder.encode(frame));
    } catch {
      this.#disconnected = true;
    }
  }
}

/** The response one subscriber reads its stream from. */
export function sseResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" },
  });
}

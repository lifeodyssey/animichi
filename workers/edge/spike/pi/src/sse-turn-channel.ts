// W0-S1 spike (#1244): the SSE side of a turn.
//
// The turn runs in the Durable Object's alarm handler, not in the client's
// fetch (spec §二), so the channel deliberately survives its reader going
// away: a write to a disconnected client is recorded and swallowed, and the
// alarm keeps driving the turn to completion. `clientGone` is the evidence
// for "the client disconnected and the turn still finished".

export class SseTurnChannel {
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private readonly encoder = new TextEncoder();
  private disconnected = false;
  readonly body: ReadableStream<Uint8Array>;

  constructor() {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    this.body = readable;
    this.writer = writable.getWriter();
  }

  get clientGone(): boolean {
    return this.disconnected;
  }

  async send(event: string, data: unknown): Promise<void> {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    await this.write(this.encoder.encode(frame));
  }

  async close(): Promise<void> {
    if (this.disconnected) return;
    try {
      await this.writer.close();
    } catch {
      this.disconnected = true;
    }
  }

  private async write(chunk: Uint8Array): Promise<void> {
    if (this.disconnected) return;
    try {
      await this.writer.write(chunk);
    } catch {
      this.disconnected = true;
    }
  }
}

export function sseResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

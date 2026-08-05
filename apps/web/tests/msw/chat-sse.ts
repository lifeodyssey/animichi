import { HttpResponse } from "msw";

export const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "x-vercel-ai-ui-message-stream": "v1",
};

function sseBody(text: string, close: boolean): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      if (close) controller.close();
    },
  });
}

export function sseResponse(
  text: string,
  { close = true }: Readonly<{ close?: boolean }> = {},
): HttpResponse<ReadableStream<Uint8Array>> {
  return new HttpResponse(sseBody(text, close), { headers: SSE_HEADERS });
}

export function flushTail(controller: ReadableStreamDefaultController<Uint8Array>, tail: string): void {
  try {
    controller.enqueue(new TextEncoder().encode(tail));
    controller.close();
  } catch {
    // The consumer aborted the stream first: the late frame has nowhere to go.
  }
}

export interface HeldSse {
  readonly stream: ReadableStream<Uint8Array>;
  /** Flush the held-back tail (and close), if the stream is still open. */
  readonly flush: () => void;
}

/** The tail-flusher the stream hands out on `start`, so no block nests past 2. */
function heldTailFlush(controller: ReadableStreamDefaultController<Uint8Array>, tail: string): () => void {
  return () => {
    flushTail(controller, tail);
  };
}

/** An SSE body whose head streams immediately; the tail flushes on `flush`. */
export function heldSse(head: string, tail: string): HeldSse {
  let flush: () => void = () => undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(head));
      flush = heldTailFlush(controller, tail);
    },
  });
  return { stream, flush };
}

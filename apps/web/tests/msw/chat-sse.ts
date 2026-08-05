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

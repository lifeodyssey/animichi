import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { webSearch } from "@animichi/agent/tools";
import { executeTool, fixture } from "./native-tool-fixture.ts";

/**
 * A body's source that serves `chunks` one per pull and tallies the bytes served and whether it was
 * cancelled. A cancel ends as `cancelOutcome` says: cleanly unless told otherwise.
 */
class ServedChunks implements UnderlyingDefaultSource<Uint8Array> {
  served = 0;
  cancelled = false;
  readonly #pending: Iterator<Uint8Array>;
  readonly #cancelOutcome: () => Promise<void>;

  constructor(chunks: readonly Uint8Array[], cancelOutcome = () => Promise.resolve()) {
    this.#pending = chunks.values();
    this.#cancelOutcome = cancelOutcome;
  }

  pull(controller: ReadableStreamDefaultController<Uint8Array>) {
    const next = this.#pending.next();
    if (next.done) { controller.close(); return; }
    this.served += next.value.byteLength;
    controller.enqueue(next.value);
  }

  cancel() {
    this.cancelled = true;
    return this.#cancelOutcome();
  }
}

/** The response a source serves: one chunk per read, and only when read. */
function servedFrom(source: ServedChunks, init: ResponseInit) {
  return new Response(new ReadableStream(source, { highWaterMark: 0 }), init);
}

/**
 * A search backend response whose body is served one chunk per read, and only when read, with no
 * Content-Length unless `headers` declares one. The bytes it served, and whether its reader
 * cancelled it, stay observable.
 */
export function servedResponse(chunks: readonly Uint8Array[], headers?: HeadersInit) {
  const source = new ServedChunks(chunks);
  return { response: servedFrom(source, { headers }), served: () => source.served, cancelled: () => source.cancelled };
}

/**
 * A response with `status` whose body serves `chunks` the same way but whose cancel fails, as the
 * body of a broken connection may. The body still ends when its chunks run out, so a reader that
 * never cancels finishes rather than waiting forever.
 */
export function uncancellableResponse(chunks: readonly Uint8Array[], status: number) {
  const source = new ServedChunks(chunks, () => Promise.reject(new Error("The body cannot be cancelled")));
  return { response: servedFrom(source, { status }), cancelAttempted: () => source.cancelled };
}

/** `bytes` cut into chunks of `size` bytes; the last may be shorter. */
export function chunksOf(bytes: Uint8Array, size: number): Uint8Array[] {
  return Array.from({ length: Math.ceil(bytes.length / size) }, (_unused, index) => bytes.subarray(index * size, (index + 1) * size));
}

/** The result `web_search` records for the query "title" when the search backend answers with `response`. */
export async function searchedWith(response: Response) {
  const { repo, toolContext } = await fixture(() => Promise.reject(new Error("Catalog must not run")));
  toolContext.webFetch = () => Promise.resolve(response);
  const { message } = await executeTool(toolContext, "web_search", { query: "title" }, [webSearch]);
  await repo.close(BACKGROUND_CONTEXT);
  return message;
}

/** How a call ends when the backend refuses it: the native tool error every upstream fault gives. */
export async function refusal() {
  const { isError, content } = await searchedWith(new Response("Anti-bot", { status: 202 }));
  return { isError, content };
}

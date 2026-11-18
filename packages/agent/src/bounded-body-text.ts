/**
 * A response body read as a stream and decoded as UTF-8 the way `Response.text()` decodes it, but
 * only while it stays within a byte limit. The limit counts the bytes the stream delivers, so a
 * missing or understated Content-Length cannot stretch it, and a character split across chunks
 * decodes whole. A chunk that would take the body past the limit is neither decoded nor kept:
 * reading stops, the rest of the body is cancelled, and the caller gets no text rather than part of
 * a body. The runtime has still handed that whole chunk over; only a BYOB reader could bound what
 * one read delivers, and this module reads with the default reader.
 */

/** The body's text, or `undefined` once it would pass `maxBytes`, with its unread rest cancelled. */
export async function bodyTextWithin(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<string | undefined> {
  if (!body) return "";
  const reader = body.getReader();
  try {
    return await readWithin(reader, maxBytes);
  } finally {
    reader.releaseLock();
  }
}

async function readWithin(reader: ReadableStreamDefaultReader<Uint8Array>, maxBytes: number): Promise<string | undefined> {
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    if (bytes + chunk.value.byteLength > maxBytes) return cancelled(reader);
    bytes += chunk.value.byteLength;
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * Releases the unread rest, so the connection stops receiving a body nobody will read. Best effort:
 * a cancel that fails changes nothing for the caller, which gets no text either way.
 */
async function cancelled(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<undefined> {
  await reader.cancel().catch(() => undefined);
  return undefined;
}

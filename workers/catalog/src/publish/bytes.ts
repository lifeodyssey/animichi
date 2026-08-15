/**
 * Shared byte/text helpers for the immutable snapshot layer (issue #1012).
 *
 * Workerd and strict TypeScript treat TextEncoder#encode().buffer as
 * ArrayBufferLike, which cannot be assigned to the ArrayBuffer the ObjectStore
 * seam requires. These helpers always produce a fresh, exactly-sized
 * ArrayBuffer so hashing and storage typing are unambiguous.
 */

/** Encode a string to a fresh, exactly-sized ArrayBuffer. */
export function textToArrayBuffer(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  return out.buffer;
}

/** JSON-encode any value to a fresh ArrayBuffer. */
export function jsonToArrayBuffer(value: unknown): ArrayBuffer {
  return textToArrayBuffer(JSON.stringify(value));
}

/** Decode an ArrayBuffer to text. */
export function arrayBufferToText(body: ArrayBuffer): string {
  return new TextDecoder().decode(body);
}

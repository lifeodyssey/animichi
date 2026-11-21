/**
 * The collaborators the `/img` cases run against: the `DOCS_ASSETS` binding,
 * the object it answers with, and an image origin the case owns.
 *
 * The binding is a double rather than a bucket, so every "never reaches the
 * bucket" claim in those cases is a count of actual reads. `node:test`'s own
 * mock installs and restores `globalThis.fetch`, so an origin cannot leak into
 * a neighbouring case.
 */
import type { TestContext } from "node:test";
import type { R2Object, R2ObjectBucket } from "../../src/proxy/private-r2-object.ts";

export const DOCS_ASSET_BYTES = "asset-bytes";

export function docsAssetObject(body = DOCS_ASSET_BYTES): R2Object {
  return { body: new Response(body).body, etag: "etag-docs", size: body.length };
}

/** A `DOCS_ASSETS` binding that records the keys it was asked for. */
export function docsAssetBinding(reads: string[]): { DOCS_ASSETS: R2ObjectBucket } {
  return {
    DOCS_ASSETS: {
      get: (key) => { reads.push(key); return Promise.resolve(docsAssetObject()); },
    },
  };
}

/** An origin that is unreachable by construction: a fall-through to
 * `image.anitabi.cn` rejects, so it surfaces as a 500 instead of the status the
 * case asserts. */
export const unreachableOrigin: typeof fetch = () =>
  Promise.reject(new TypeError("the image origin must not be reached"));

/** Runs one case against an image origin the case owns. */
export function withImageOrigin(t: TestContext, origin: typeof fetch, run: () => Promise<Response>): Promise<Response> {
  t.mock.method(globalThis, "fetch", origin);
  return run();
}

/** The same, with the unreachable origin. */
export function withoutImageOrigin(t: TestContext, run: () => Promise<Response>): Promise<Response> {
  return withImageOrigin(t, unreachableOrigin, run);
}

/** The URL a `fetch` call asked for. The arm calls the origin with a string; the
 * `Request` and `URL` branches are the signature's, not a case's. */
const requestedUrl = (input: RequestInfo | URL): string => (input instanceof Request ? input.url : String(input));

/** Runs one case against an origin that records every path it was asked for. */
export function withRecordingOrigin(t: TestContext, requested: string[], run: () => Promise<Response>): Promise<Response> {
  const origin: typeof fetch = (input) => {
    requested.push(requestedUrl(input));
    return Promise.resolve(new Response("jpeg-bytes", { status: 200 }));
  };
  return withImageOrigin(t, origin, run);
}

/**
 * The two collaborators `serveImage` takes besides the database: an R2 bucket
 * and a fetch. Both integration files that drive the media path build them, so
 * they are named here once — for what they construct, not for the files that
 * use them (`.claude/rules/naming-ownership.md`).
 */
import type { ImageFetchLike } from "../src/media/img";

/** What the stub bucket holds for one key. */
interface StoredObject {
  body: ArrayBuffer;
  contentType: string;
}

/** An in-memory R2Bucket: only the get/put surface `serveImage` exercises. */
export function makeImageBucketStub(): { bucket: R2Bucket; store: Map<string, StoredObject> } {
  const store = new Map<string, StoredObject>();
  const bucket = { put: putAsset(store), get: getAsset(store) };
  return { bucket: bucket as unknown as R2Bucket, store };
}

function putAsset(store: Map<string, StoredObject>) {
  return (key: string, body: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }): Promise<R2Object> => {
    store.set(key, { body, contentType: opts?.httpMetadata?.contentType ?? "image/jpeg" });
    return Promise.resolve(undefined as unknown as R2Object);
  };
}

function getAsset(store: Map<string, StoredObject>) {
  return (key: string) => {
    const hit = store.get(key);
    if (!hit) return Promise.resolve(null);
    return Promise.resolve({
      httpMetadata: { contentType: hit.contentType },
      arrayBuffer: () => Promise.resolve(hit.body),
    });
  };
}

/** What a counting fetch records about the requests it answered. */
export interface CountingImageFetch {
  fetchImpl: ImageFetchLike;
  calls: () => number;
  urls: string[];
  agents: (string | undefined)[];
}

/** A fetch that always answers `status` with `bytes`, counting every call. */
export function makeCountingImageFetch(status: number, bytes: Uint8Array): CountingImageFetch {
  let count = 0;
  const urls: string[] = [];
  const agents: (string | undefined)[] = [];
  const fetchImpl: ImageFetchLike = (input, init) => {
    count += 1;
    urls.push(input);
    agents.push(init?.headers?.["User-Agent"]);
    return Promise.resolve(imageFetchResponse(status, bytes));
  };
  return { fetchImpl, calls: () => count, urls, agents };
}

/** The response shape `ImageFetchLike` resolves to. */
function imageFetchResponse(status: number, bytes: Uint8Array) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "image/png" : null) },
    arrayBuffer: () => Promise.resolve(bytes.buffer.slice(0) as ArrayBuffer),
  };
}

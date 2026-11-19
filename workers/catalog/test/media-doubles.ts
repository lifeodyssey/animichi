/**
 * The two collaborators `serveImage` takes besides the database: an R2 bucket
 * and a fetch. Both integration files that drive the media path build them, so
 * they are named here once — for what they construct, not for the files that
 * use them (`.claude/rules/naming-ownership.md`).
 */
import type { ImageFetchLike } from "../src/media/img";
import { unanswered } from "./fakes/unanswered-request";

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

/** What a counting fetch records about the requests it answered: URL, user agent and redirect mode. */
export interface CountingImageFetch {
  fetchImpl: ImageFetchLike;
  calls: () => number;
  urls: string[];
  agents: (string | undefined)[];
  redirects: (string | undefined)[];
}

/** A fetch that always answers `status` with `bytes`, counting every call. */
export function makeCountingImageFetch(status: number, bytes: Uint8Array): CountingImageFetch {
  let count = 0;
  const urls: string[] = [];
  const agents: (string | undefined)[] = [];
  const redirects: (string | undefined)[] = [];
  const fetchImpl: ImageFetchLike = (input, init) => {
    count += 1;
    urls.push(input);
    agents.push(init?.headers?.["User-Agent"]);
    redirects.push(init?.redirect);
    return Promise.resolve(imageFetchResponse(status, bytes));
  };
  return { fetchImpl, calls: () => count, urls, agents, redirects };
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

/** An origin that cannot be reached: its fetch, and the URL of every pull that tried it. */
interface FailingImageFetch {
  fetchImpl: ImageFetchLike;
  urls: string[];
}

/** An origin that cannot be reached: every pull rejects with `failure`, as `fetch` does on a transport error. */
export function makeFailingImageFetch(failure: Error): FailingImageFetch {
  const urls: string[] = [];
  const fetchImpl: ImageFetchLike = (input) => {
    urls.push(input);
    return Promise.reject(failure);
  };
  return { fetchImpl, urls };
}

/** An origin a test holds open: its fetch, the signal of the pull that reached it, and every pull's URL. */
export interface HeldImageFetch {
  fetchImpl: ImageFetchLike;
  reached: Promise<AbortSignal>;
  urls: string[];
}

/** An origin that never answers: each pull hands over its signal and rejects only when that signal aborts. */
export function makeUnansweredImageFetch(): HeldImageFetch {
  return heldOrigin((signal) => unanswered(signal));
}

/** An origin that answers 200 and never finishes the body: the read rejects only when the pull's signal aborts. */
export function makeStalledBodyImageFetch(): HeldImageFetch {
  return heldOrigin((signal) => Promise.resolve({
    ...imageFetchResponse(200, new Uint8Array()),
    arrayBuffer: () => unanswered<ArrayBuffer>(signal),
  }));
}

/** A fetch that hands each pull's signal over through `reached`, then answers the pull with `answer`. */
function heldOrigin(answer: (signal: AbortSignal) => ReturnType<ImageFetchLike>): HeldImageFetch {
  let arrived: (signal: AbortSignal) => void = () => undefined;
  const reached = new Promise<AbortSignal>((resolve) => { arrived = resolve; });
  const urls: string[] = [];
  const fetchImpl: ImageFetchLike = (input, init) => {
    urls.push(input);
    const signal = init?.signal ?? AbortSignal.abort(new Error("the origin pull carried no signal"));
    arrived(signal);
    return answer(signal);
  };
  return { fetchImpl, reached, urls };
}

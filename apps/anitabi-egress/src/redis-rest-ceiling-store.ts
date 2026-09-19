/**
 * The ceiling's counter, in a Redis-compatible REST store (#1810) — the
 * adapter for the one thing this service keeps outside itself.
 *
 * The store holds ONE INTEGER PER HOUR and the service does exactly two things
 * to it: `INCR` the hour's key, and give that key a life past its own hour.
 * Both travel in one pipeline request, so a window cannot be incremented here
 * and left without an expiry; the increment's own answer is the count, and
 * Redis' `INCR` is atomic, so two requests racing in one instance (or in two)
 * cannot both be told they are the hundredth.
 *
 * The counter is MONOTONE within its hour: it counts admissions the service
 * attempted, including the ones the ceiling then refused, so a refusal never
 * frees a slot. Over-counting is the safe direction for a promise, and it is
 * what makes the store's number the only number.
 *
 * The transport is INJECTED, exactly as the relay's is: this module names no
 * network module and no global function, so the service's whole outbound
 * surface stays the composition root's one injected value. The destination is
 * the environment's (`CEILING_STORE_URL`), never a request's, and the token
 * rides in one header on one connection.
 *
 * Every failure is a rejection — an unreachable store, a provider fault, a
 * body that is not the pipeline answer asked for. None of them may read as a
 * count: a store whose failures were tolerated is a ceiling that is not
 * enforced.
 */
import type { CeilingStore } from "./upstream-ceiling.ts";

/** The one endpoint Upstash-style REST stores answer pipelines on. */
const PIPELINE_PATH = "/pipeline";

/**
 * How long a window's key outlives its hour. Comfortably past the hour it
 * counts, so a late request still finds its own window, and finite, so a store
 * accumulates one key per hour rather than one per hour forever.
 */
const WINDOW_TTL_SECONDS = 2 * 60 * 60;

/**
 * How long the store has to answer. It is one atomic increment on a counter
 * this service owns: a store that cannot manage it inside this is not slow,
 * and the caller is better served by a refusal than by a held connection.
 */
const STORE_TIMEOUT_MS = 5_000;

/** The one request this adapter makes, as the transport receives it. */
export interface StoreRequest {
  readonly method: "POST";
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly signal: AbortSignal;
  /**
   * Required, and only ever `"error"`. A redirect is a second destination the
   * bearer token would travel to, and this service redirects nowhere.
   */
  readonly redirect: "error";
}

/** The part of the store's answer the adapter reads. */
export interface StoreAnswer {
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** The network function the composition root injects; see the module header. */
export type StoreTransport = (url: string, init: StoreRequest) => Promise<StoreAnswer>;

export interface RedisRestCeilingStoreOptions {
  /** The store's base URL, https and without a trailing slash (see `readCeilingStoreConfig`). */
  readonly url: string;
  /** The store's bearer token: a `fly secrets` value, never in this tree. */
  readonly token: string;
  readonly transport: StoreTransport;
}

/** A store that could not answer. The ceiling turns it into its own refusal. */
export class CeilingStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CeilingStoreError";
  }
}

export class RedisRestCeilingStore implements CeilingStore {
  constructor(private readonly options: RedisRestCeilingStoreOptions) {}

  /** Count one request against `window`, and answer with that window's new total. */
  async increment(window: string): Promise<number> {
    const answer = await this.options.transport(`${this.options.url}${PIPELINE_PATH}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.options.token}`, "content-type": "application/json" },
      body: JSON.stringify([
        ["INCR", window],
        ["EXPIRE", window, String(WINDOW_TTL_SECONDS)],
      ]),
      signal: AbortSignal.timeout(STORE_TIMEOUT_MS),
      redirect: "error",
    });
    if (answer.status < 200 || answer.status >= 300) {
      throw new CeilingStoreError(`the ceiling store answered ${String(answer.status)}`);
    }
    return countOf(await bodyText(answer));
  }
}

async function bodyText(answer: StoreAnswer): Promise<string> {
  return new TextDecoder().decode(await answer.arrayBuffer());
}

/** The count the increment returned, or a refusal: an answer that cannot be read is not a grant. */
function countOf(body: string): number {
  const count = firstResult(body);
  if (typeof count !== "number" || !Number.isSafeInteger(count)) {
    throw new CeilingStoreError("the ceiling store's answer carried no integer count");
  }
  return count;
}

/** Upstash answers a pipeline with one `{ "result": … }` per command, in the order they were sent. */
function firstResult(body: string): unknown {
  const parsed: unknown = JSON.parse(body);
  if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
  const first: unknown = parsed[0];
  if (typeof first !== "object" || first === null || !("result" in first)) return undefined;
  return first.result;
}

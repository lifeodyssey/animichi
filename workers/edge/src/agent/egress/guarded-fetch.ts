// BYOK egress red lines (#1248, W0-S5): the only sanctioned way to make a BYOK
// provider call.
//
// pi's `ProviderRequestOptions.fetch`
// (`node_modules/@earendil-works/pi-ai/dist/types.d.ts`) is the seam the guard
// hangs on: the openai-completions and anthropic-messages adapters pass it
// straight to their SDK client, so every provider HTTP request — including the
// ones the SDK makes on its own initiative — goes through this object.
//
// What it adds over a bare `fetch`:
//   - the policy runs on the URL of EVERY hop, not just the first. A one-shot
//     pre-flight check is not enough: a provider host answering `302 Location:
//     http://169.254.169.254/` would otherwise be followed by the runtime with
//     no second opinion.
//   - `redirect: "manual"`. Without it the runtime follows redirects itself and
//     the guard never sees the target at all.
//   - a bounded hop count, so a redirect cycle cannot be spun forever.
//
// The request body is buffered once up front. A followed redirect has to be
// able to replay it, and a stream can only be read once; provider requests are
// small JSON documents, so the memory cost is a few kilobytes per turn.

import { EgressDeniedError } from "./egress-decision.ts";
import { BYOK_EGRESS_POLICY, EgressPolicy } from "./egress-policy.ts";
import type { ByokProvider } from "./provider-allowlist.ts";

export type EgressFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface GuardedFetchInput {
  provider: ByokProvider;
  key: string;
  policy?: EgressPolicy;
  inner?: EgressFetch;
  maxHops?: number;
}

interface GuardedHop {
  url: string;
  method: string;
  headers: Headers;
  body: ArrayBuffer | null;
}

const DEFAULT_MAX_HOPS = 3;

async function firstHopOf(input: RequestInfo | URL, init?: RequestInit): Promise<GuardedHop> {
  const request = new Request(input, init);
  const bodiless = request.method === "GET" || request.method === "HEAD";
  const body = bodiless ? null : await request.arrayBuffer();
  return { url: request.url, method: request.method, headers: new Headers(request.headers), body };
}

/**
 * Headers that carry the caller's BYOK credential. A redirect that changes
 * origin must not take them along: the target is still inside the provider's
 * allowlist, but "the allowlist has two hosts" is not consent to send host A's
 * key to host B. This is the same rule the fetch spec applies to
 * `Authorization` on a cross-origin redirect.
 */
const CREDENTIAL_HEADERS = ["authorization", "x-api-key", "api-key", "cookie"];

function headersForHop(hop: GuardedHop, url: string): Headers {
  if (new URL(url).origin === new URL(hop.url).origin) return hop.headers;
  const stripped = new Headers(hop.headers);
  for (const name of CREDENTIAL_HEADERS) stripped.delete(name);
  return stripped;
}

/** 307/308 keep method and body; 301/302/303 continue as a bodiless GET. */
function nextHopOf(hop: GuardedHop, status: number, location: string): GuardedHop {
  const url = new URL(location, hop.url).toString();
  const headers = headersForHop(hop, url);
  if (status === 307 || status === 308) return { ...hop, url, headers };
  return { url, method: "GET", headers, body: null };
}

function requestInitOf(hop: GuardedHop): RequestInit {
  return { method: hop.method, headers: hop.headers, body: hop.body, redirect: "manual" };
}

function redirectOf(response: Response): { status: number; location: string } | null {
  if (response.status < 300 || response.status >= 400) return null;
  const location = response.headers.get("location");
  if (location === null) throw new EgressDeniedError("redirect_without_location");
  return { status: response.status, location };
}

export class GuardedFetch {
  private readonly provider: ByokProvider;
  private readonly key: string;
  private readonly policy: EgressPolicy;
  private readonly inner: EgressFetch;
  private readonly maxHops: number;
  private followed = 0;

  constructor(input: GuardedFetchInput) {
    this.provider = input.provider;
    this.key = input.key;
    this.policy = input.policy ?? BYOK_EGRESS_POLICY;
    this.inner = input.inner ?? ((target, init) => fetch(target, init));
    this.maxHops = input.maxHops ?? DEFAULT_MAX_HOPS;
  }

  /** The redirect depth the most recent call reached. */
  get hops(): number {
    return this.followed;
  }

  /** Shaped for pi's `ProviderRequestOptions.fetch`; bound, so it can be passed by value. */
  readonly fetch: EgressFetch = async (input, init) => this.send(await firstHopOf(input, init));

  private async send(start: GuardedHop): Promise<Response> {
    let hop = start;
    for (let followed = 0; followed <= this.maxHops; followed += 1) {
      this.followed = followed;
      this.requireAllowed(hop.url);
      const response = await this.inner(hop.url, requestInitOf(hop));
      const redirect = redirectOf(response);
      if (redirect === null) return response;
      hop = nextHopOf(hop, redirect.status, redirect.location);
    }
    throw new EgressDeniedError("redirect_hop_limit");
  }

  private requireAllowed(url: string): void {
    const decision = this.policy.decide({ provider: this.provider, baseUrl: url, key: this.key });
    if (!decision.allowed) throw new EgressDeniedError(decision.reason);
  }
}

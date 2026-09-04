// The web search backend's way out of this Worker (#1287, W2-1).
//
// Spec Appendix D: `src/agent/egress/` is the ONLY path to the public internet,
// so `web_search` does not get a `fetch` — it gets this one. Everything the
// BYOK guard already decides is reused verbatim: the URL shape checks, the
// address classification in `host-address.ts`, the exact-host allowlist, and
// `GuardedFetch`'s `redirect: "manual"` re-validation of every hop. Nothing is
// re-implemented here, because a second implementation of a red line is a red
// line that can drift.
//
// A SEPARATE allowlist instance is the whole point. `BYOK_PROVIDER_ALLOWLIST`
// names the model providers a caller's own key may be spent at; the search
// backend must not be reachable from that policy and the model providers must
// not be reachable from this one. Two instances of one class, each with one
// job.
//
// Two of `EgressPolicy`'s inputs do not fit a keyless, non-BYOK destination,
// and both are pinned here rather than relaxed there:
//
//   - `provider`. The allowlist is keyed by BYOK model-provider family
//     (`ByokProvider`), and a search engine is not one. Widening that union
//     would be the harmful fix: it would put a search host in the same
//     vocabulary a BYOK key is validated against. Instead this allowlist maps
//     EVERY family to the SAME single host, so the family token cannot widen
//     anything — whichever one is passed, `html.duckduckgo.com` is the only
//     destination that passes. `SEARCH_FAMILY` exists solely because the shared
//     type demands a member, and is named once so no caller invents a second.
//   - `key`. `EgressPolicy` refuses a blank key first of all, because a BYOK
//     provider SDK handed a falsy key silently falls back to an ambient server
//     credential (`egress-policy.ts`'s header). A public search endpoint takes
//     no credential, so there is no such fallback to guard; the hop declares
//     the non-secret sentinel below rather than the red line being weakened for
//     it. Nothing in this file is a secret, and none of it is ever logged.

import { GuardedFetch, type EgressFetch } from "./guarded-fetch.ts";
import { EgressPolicy } from "./egress-policy.ts";
import { ProviderAllowlist, type ByokProvider } from "./provider-allowlist.ts";

/** The one host the search backend answers on. Adding a second is a review. */
export const WEB_SEARCH_HOST = "html.duckduckgo.com";

/** Every BYOK family, deliberately collapsed onto the single search host. */
const WEB_SEARCH_HOSTS: Readonly<Record<ByokProvider, readonly string[]>> = {
  openai: [WEB_SEARCH_HOST],
  anthropic: [WEB_SEARCH_HOST],
  google: [WEB_SEARCH_HOST],
};

/** The family token the search hop declares; it cannot widen the destination. */
const SEARCH_FAMILY: ByokProvider = "openai";

/** Not a credential, and named so: the endpoint is public and takes none. */
const NO_CREDENTIAL = "public-search-endpoint-takes-no-credential";

/** The search backend's own allowlist — one host, and no model provider. */
export const WEB_SEARCH_ALLOWLIST = new ProviderAllowlist(WEB_SEARCH_HOSTS);

/** The same red lines as BYOK egress, decided against that allowlist. */
export const WEB_SEARCH_EGRESS_POLICY = new EgressPolicy(WEB_SEARCH_ALLOWLIST);

/**
 * The only fetch `web_search` may use.
 *
 * `inner` exists so a unit test can answer with a fixture page instead of
 * reaching the real backend; production passes nothing and gets `globalThis
 * .fetch` under the guard.
 */
export function webSearchFetch(inner?: EgressFetch): EgressFetch {
  return new GuardedFetch({
    provider: SEARCH_FAMILY,
    key: NO_CREDENTIAL,
    policy: WEB_SEARCH_EGRESS_POLICY,
    inner,
  }).fetch;
}

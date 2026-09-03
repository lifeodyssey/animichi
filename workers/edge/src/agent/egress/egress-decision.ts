// BYOK egress red lines (#1248, W0-S5): the decision vocabulary.
//
// Every rejection carries a machine-readable reason so the deployed red-line
// matrix (`scripts/spike/pi-s5-egress.sh`) can assert *why* a destination was
// refused, not merely that it was. Callers match on `.reason`, never on a
// message string — the same contract `EgressBlockReason` keeps on the Python
// side (`apps/agent/src/animichi/infrastructure/egress_errors.py`), which this
// module ports semantically for workerd.

import type { ByokProvider } from "./provider-allowlist.ts";

const EGRESS_DENY_REASONS = [
  "empty_key",
  "unknown_provider",
  "invalid_url",
  "scheme_not_https",
  "userinfo_present",
  "port_not_443",
  "loopback_address",
  "private_address",
  "link_local_address",
  "cgnat_address",
  "metadata_address",
  "unroutable_address",
  "ip_literal_host",
  "own_infrastructure",
  "host_not_allowlisted",
  "redirect_without_location",
  "redirect_hop_limit",
] as const;

export type EgressDenyReason = (typeof EGRESS_DENY_REASONS)[number];

/**
 * The destination passed every red line. `url` is its WHATWG-normalised form
 * and `provider` is the validated family — carrying it here is what lets a
 * caller act on an allow decision without re-narrowing the raw request field.
 */
interface EgressAllowed {
  allowed: true;
  provider: ByokProvider;
  url: string;
  host: string;
}

export interface EgressRefused {
  allowed: false;
  reason: EgressDenyReason;
}

export type EgressDecision = EgressAllowed | EgressRefused;

export function allowEgress(provider: ByokProvider, url: string, host: string): EgressAllowed {
  return { allowed: true, provider, url, host };
}

export function refuseEgress(reason: EgressDenyReason): EgressRefused {
  return { allowed: false, reason };
}

/**
 * Thrown by the guarded fetch when a request — or a redirect target it was
 * asked to follow — fails the policy. Carries the reason, never the URL, the
 * resolved address or the key: an internal-network error oracle is still an
 * oracle (`EgressBlocked`'s docstring on the Python side says the same).
 */
export class EgressDeniedError extends Error {
  readonly reason: EgressDenyReason;

  constructor(reason: EgressDenyReason) {
    super(`egress denied: ${reason}`);
    this.name = "EgressDeniedError";
    this.reason = reason;
  }
}

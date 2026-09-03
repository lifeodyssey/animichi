// BYOK egress red lines (#1248, W0-S5): which hosts each provider family may
// be pointed at.
//
// Exact hosts, never suffixes. A suffix rule (`endsWith(".openai.com")`) is
// the classic way an allowlist stops being one — `api.openai.com.evil.test`
// passes a naive suffix test written without the leading dot, and even the
// careful form still hands every future subdomain a free pass. The set is
// small enough to enumerate, so it is enumerated, and adding a host is a
// deliberate reviewed edit rather than a pattern quietly widening.
//
// This is the FIRST of the two independent conditions the policy applies (the
// second is `host-address.ts`'s classification). It is also the reason a
// resolver-less runtime is not a hole: because the host must be one of these
// literal names, a caller cannot steer egress at an address of their choosing,
// so there is nothing for a mixed DNS answer or a rebinding flip to steer.

export const BYOK_PROVIDERS = ["openai", "anthropic", "google"] as const;

export type ByokProvider = (typeof BYOK_PROVIDERS)[number];

const DEFAULT_PROVIDER_HOSTS: Readonly<Record<ByokProvider, readonly string[]>> = {
  openai: ["api.openai.com"],
  anthropic: ["api.anthropic.com"],
  // Google's OpenAI-compatible surface lives on the same host as the native
  // one (`/v1beta/openai` vs `/v1beta`), so one entry covers both dialects.
  google: ["generativelanguage.googleapis.com"],
};

/**
 * Our own public origins are legitimately globally routable, so every address
 * check passes them; without an explicit refusal, BYOK egress becomes a
 * confused-deputy path back into our own authenticated surfaces. Matched as
 * the domain itself or a `.`-anchored subdomain — the anchor is what keeps
 * `notanimichi.com` out of it. Ported from `OWN_INFRASTRUCTURE_HOSTNAMES` in
 * `apps/agent/src/animichi/infrastructure/egress_guard.py`, plus the two hosts
 * that only exist on the Workers side.
 */
const DEFAULT_OWN_INFRASTRUCTURE: readonly string[] = [
  "animichi.com",
  "workers.dev",
  "catalog.internal",
  "stack-auth.com",
];

export class ProviderAllowlist {
  private readonly hosts: Readonly<Record<ByokProvider, readonly string[]>>;
  private readonly ownInfrastructure: readonly string[];

  constructor(
    hosts: Readonly<Record<ByokProvider, readonly string[]>> = DEFAULT_PROVIDER_HOSTS,
    ownInfrastructure: readonly string[] = DEFAULT_OWN_INFRASTRUCTURE,
  ) {
    this.hosts = hosts;
    this.ownInfrastructure = ownInfrastructure;
  }

  /** The provider id, or `null` — an unknown id is never defaulted. */
  providerOf(value: unknown): ByokProvider | null {
    return BYOK_PROVIDERS.find((known) => known === value) ?? null;
  }

  allows(provider: ByokProvider, host: string): boolean {
    return this.hosts[provider].includes(host);
  }

  isOwnInfrastructure(host: string): boolean {
    return this.ownInfrastructure.some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    );
  }
}

export const BYOK_PROVIDER_ALLOWLIST = new ProviderAllowlist();

// W0-S5 spike (#1248): one row of the BYOK red-line matrix, measured on a
// deployed Worker.
//
// A denied destination is answered from the policy alone — no provider is
// contacted, which is the point of measuring it. An allowed destination runs a
// REAL pi round trip through the guarded fetch, because the questions that only
// a deployment can answer are downstream of the decision: does the platform's
// own outbound proxy agree, and does the provider's error text carry the key
// back out. The caller supplies a throwaway key, so the expected outcome of an
// allowed row is a 401 whose text is scrubbed.

import type { Api, AssistantMessage, Model, MutableModels } from "@earendil-works/pi-ai";
import { GuardedFetch, type EgressFetch } from "../../../src/agent/egress/guarded-fetch.ts";
import { BYOK_EGRESS_POLICY, EgressPolicy } from "../../../src/agent/egress/egress-policy.ts";
import type { ByokProvider } from "../../../src/agent/egress/provider-allowlist.ts";
import { SecretScrub, thrownMessageOf } from "../../../src/agent/egress/secret-scrub.ts";
import { byokModelOf } from "./byok-provider-models.ts";
import type { EgressProbeCommand } from "./egress-probe-command.ts";

export type RoundTripOutcome = "skipped" | "completed" | "failed";

export interface EgressProbeReport {
  decision: "allow" | "deny";
  reason: string;
  hops: number;
  roundTrip: RoundTripOutcome;
  /** Always scrubbed before it leaves this object. */
  detail: string;
  /** The provider's raw answer carried the key back (pre-scrub observation). */
  providerEchoedKey: boolean;
  /** The emitted `detail` still carries the key. The red line is `false`. */
  keyLeaked: boolean;
}

interface RoundTrip {
  outcome: RoundTripOutcome;
  raw: string;
  hops: number;
}

function textOf(message: AssistantMessage): string {
  const parts = message.content.filter((block) => block.type === "text");
  return message.errorMessage ?? parts.map((block) => block.text).join("");
}

function completionOf(
  models: MutableModels,
  model: Model<Api>,
  command: EgressProbeCommand,
  guarded: GuardedFetch,
): Promise<AssistantMessage> {
  const context = { messages: [{ role: "user" as const, content: command.prompt, timestamp: 0 }] };
  return models.completeSimple(model, context, {
    fetch: guarded.fetch,
    apiKey: command.key,
    maxRetries: 0,
  });
}

export class EgressProbe {
  private readonly policy: EgressPolicy;
  private readonly inner: EgressFetch | undefined;

  constructor(policy: EgressPolicy = BYOK_EGRESS_POLICY, inner?: EgressFetch) {
    this.policy = policy;
    this.inner = inner;
  }

  async run(command: EgressProbeCommand): Promise<EgressProbeReport> {
    const decision = this.policy.decide(command);
    if (!decision.allowed) return reportOf(command, "deny", decision.reason, skipped());
    const trip = await this.roundTrip(decision.provider, command);
    return reportOf(command, "allow", "allowlisted", trip);
  }

  private async roundTrip(provider: ByokProvider, command: EgressProbeCommand): Promise<RoundTrip> {
    const guarded = new GuardedFetch({ provider, key: command.key, policy: this.policy, inner: this.inner });
    const { models, model } = byokModelOf(provider, command.baseUrl, command.key);
    try {
      const message = await completionOf(models, model, command, guarded);
      const outcome = message.stopReason === "error" ? "failed" : "completed";
      return { outcome, raw: textOf(message), hops: guarded.hops };
    } catch (error) {
      return { outcome: "failed", raw: thrownMessageOf(error), hops: guarded.hops };
    }
  }
}

function skipped(): RoundTrip {
  return { outcome: "skipped", raw: "", hops: 0 };
}

/** `false` for a blank key: an empty needle is found in every haystack. */
function carriesKey(text: string, key: string): boolean {
  return key.length > 0 && text.includes(key);
}

function reportOf(
  command: EgressProbeCommand,
  decision: "allow" | "deny",
  reason: string,
  trip: RoundTrip,
): EgressProbeReport {
  const key = command.key.trim();
  const detail = new SecretScrub([key]).text(trip.raw).slice(0, 400);
  return {
    decision,
    reason,
    hops: trip.hops,
    roundTrip: trip.outcome,
    detail,
    providerEchoedKey: carriesKey(trip.raw, key),
    keyLeaked: carriesKey(detail, key),
  };
}

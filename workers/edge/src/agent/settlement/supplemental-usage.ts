/**
 * What a turn spent OUTSIDE its own pi run, and who is charged for it (#1292).
 *
 * The pi Agent's `message_end` events are the only usage `TurnOutput` can see,
 * and one model call in a turn never produces one: `translate_anime_title`'s
 * fallback is a tool-less `streamSimple` on the turn's model, made from inside
 * a tool rather than by the loop (`src/agent/tools/model-title-translation.ts`).
 * Its tokens were metered nowhere at all until this module existed. A sink is
 * how they get out — the same shape Python used, where
 * `_server_title_translator` handed the translation its own `RunUsage` and
 * appended it to `AgentResult.supplemental_usage` afterwards
 * (`interfaces/public_api.py:922`).
 *
 * WHO PAYS is the other half, and it is not the turn's payer in every case.
 * D18 forces that translation onto the SERVER's key during a caller-keyed
 * (BYOK) turn, so the caller pays for the turn they asked for and the platform
 * pays for a translation they did not (`session-turn.ts::translationModel`).
 * `runs.payer = 'byok'` prices the whole run at zero, so folding those tokens
 * into the `byok` day row would meter our own spend at nothing; folding them
 * into the caller's `anon`/`user` row — which is what Python did, because it
 * re-derived the scope from the identity rather than from the run
 * (`application/identity.py::scope_for_identity`) — would report platform spend
 * as the caller's. Hence `platform`, the one `daily_usage` scope no run can be
 * committed on.
 */
import { BYOK_PAYER, PLATFORM_SCOPE, type RunPayer, type UsageScope } from "../../db/schema.ts";
import type { TurnUsage } from "./turn-settlement.ts";

/** A turn that made no model call outside its own run. */
export const NO_SUPPLEMENTAL_USAGE: TurnUsage = {
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
};

/** Where a model call made outside the pi run reports what it spent. */
export type UsageSink = (usage: TurnUsage) => void;

/**
 * The running total those calls add up to over one turn.
 *
 * A turn may translate more than one title, so this accumulates rather than
 * replaces — and it counts a REQUEST per reported call, which is what the day
 * meter's `requests` column means and what Python's `usage.requests > 0` gate
 * read before it appended anything.
 */
export class SupplementalUsage {
  #requests = 0;
  #inputTokens = 0;
  #outputTokens = 0;

  /** What this turn has spent off-run so far. */
  get usage(): TurnUsage {
    return {
      requests: this.#requests,
      inputTokens: this.#inputTokens,
      outputTokens: this.#outputTokens,
    };
  }

  record(usage: TurnUsage): void {
    this.#requests += usage.requests;
    this.#inputTokens += usage.inputTokens;
    this.#outputTokens += usage.outputTokens;
  }
}

/**
 * Which day row this spend lands on, from the run's OWN payer.
 *
 * A caller-keyed turn charges the platform, because that is whose key made the
 * call. Every other turn charges the same scope its own tokens did: the
 * translation ran on the same server key as the rest of the turn, so a second
 * scope would only split one payer's day across two rows.
 */
export function supplementalScope(payer: RunPayer): UsageScope {
  return payer === BYOK_PAYER ? PLATFORM_SCOPE : payer;
}

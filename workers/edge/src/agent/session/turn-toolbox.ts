/**
 * The tools one turn may call (card #1252, spec
 * `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §三).
 *
 * A port, and a deliberately tiny one: card #1253 owns `src/agent/tools/` — the
 * catalog tools, their typebox parameters and the registry that assembles them —
 * and this card owns the loop that calls them. One method is the whole contract
 * between the two, so neither card has to guess at the other's shape and the
 * loop's tests run against the spike's `lookup_spot`-style tool until the real
 * registry lands.
 *
 * `AgentTool` is pi's own tool type (`@earendil-works/pi-agent-core`), not a
 * type of ours: the loop hands whatever this answers straight to the pi Agent,
 * so a second definition here would only be a place for the two to drift.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "@earendil-works/pi-ai";
import type { TSchema } from "typebox";
import { NO_SUPPLEMENTAL_USAGE } from "../settlement/supplemental-usage.ts";
import type { TurnUsage } from "../settlement/turn-settlement.ts";

/**
 * One tool as the pi kernel executes it, with its `details` pinned to JSON.
 *
 * pi leaves that type parameter open (`any`), and the loop cannot: a step's
 * result goes into the `run_steps.result` jsonb column and comes back out of it
 * on the replay, so a tool whose details were not JSON would settle a step that
 * could never be replayed. Pinning it here is the one place that constraint has
 * to hold, and it makes #1253's tools declare it rather than discover it.
 */
export type TurnTool = AgentTool<TSchema, JsonValue>;

export interface Toolbox {
  /** Every tool this turn may call, in registration order. */
  tools(): readonly TurnTool[];
  /**
   * What those tools spent on model calls the pi Agent never made (#1292).
   *
   * The toolbox is asked rather than the loop told, because the toolbox is the
   * only thing that knows such a call happened: `translate_anime_title` falls
   * back to a tool-less completion on the turn's model
   * (`src/agent/tools/model-title-translation.ts`), which emits no
   * `message_end` the loop's `TurnOutput` could observe. The settlement banks
   * it separately — a caller-keyed turn's translation is charged to the
   * platform, not to the caller (`settlement/supplemental-usage.ts`).
   */
  spent(): TurnUsage;
}

/** A turn with no tools at all — the honest default when the deployment has no
 * `CATALOG` binding. It spends nothing off-run because it calls nothing. */
export const EMPTY_TOOLBOX: Toolbox = {
  tools: () => [],
  spent: () => NO_SUPPLEMENTAL_USAGE,
};

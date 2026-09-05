/**
 * The compact discriminated outcomes the catalog tools hand back to the model.
 *
 * A port of `apps/agent/src/animichi/agents/tool_outcomes.py`: the
 * model never sees rows, only an outcome plus the opaque ref it can name in a
 * later call. Keeping the vocabulary identical is what lets the system prompt,
 * the eval trajectories and the web's `intent` frames survive the rewrite.
 *
 * ONE FIELD IS NOT PYTHON'S, and it is named here so the divergence is not
 * discovered later: `ItineraryOk.ordered_point_ids` (#1389). Every other
 * field on every other outcome matches
 * `test_tool_outcome_schemas.py`'s frozen field sets. The argument is below,
 * on the field itself; the seams it could have broken are all additive —
 * `details` is typed `JsonValue`, the SD-9 `tool-output-available` frame
 * carries it whole (`session/turn-frames.ts`), and no evaluator reads a
 * step's details by field.
 */

/**
 * One outcome as a tool's `details`.
 *
 * `TurnTool` pins details to `JsonValue` because a step's result goes into the
 * `run_steps.result` jsonb column and comes back out on the replay
 * (`session/turn-toolbox.ts`). An interface carries no implicit index signature
 * and so does not satisfy that pin; this homomorphic mapped type is the same
 * shape with one, which is what lets the outcomes below stay interfaces and
 * still be checked against the constraint rather than cast past it.
 */
export type ToolDetails<Outcome> = { [Key in keyof Outcome]: Outcome[Key] };

/** Why the turn cannot proceed without asking the user something. */
export type ClarificationReason =
  | "anime_ambiguity"
  | "anime_not_found"
  | "place_ambiguity"
  | "place_too_broad"
  | "unknown_place"
  | "missing_location";

/** `resolve_anime` found exactly one work. */
export interface ResolveResolved {
  outcome: "resolved";
  bangumi_id: string;
  anime_title: string;
}

/** `resolve_anime` found several equally good works. */
export interface ResolveAmbiguous {
  outcome: "needs_disambiguation";
  clarification_reason: "anime_ambiguity";
  candidate_ids: string[];
}

/** `resolve_anime` found nothing that matches the title as written. */
export interface ResolveNotFound {
  outcome: "not_found";
  clarification_reason: "anime_not_found";
}

/** The catalog could not answer at all. */
export interface UpstreamDown {
  outcome: "upstream_unavailable";
}

/** Every outcome `resolve_anime` can produce. */
export type ResolveOutcome = ResolveResolved | ResolveAmbiguous | ResolveNotFound | UpstreamDown;

/** `search_bangumi` stored a non-empty result. */
export interface SearchOk {
  outcome: "ok";
  result_ref: string;
  row_count: number;
  anime_title: string | null;
  partial: boolean;
}

/** `search_bangumi` found the work but no published points. */
export interface SearchEmpty {
  outcome: "empty";
  anime_title: string | null;
  partial: boolean;
}

/** Every outcome `search_bangumi` can produce. */
export type SearchOutcome = SearchOk | SearchEmpty | UpstreamDown;

/** `search_nearby` stored a non-empty result. */
export interface NearbyOk {
  outcome: "ok";
  result_ref: string;
  row_count: number;
}

/** `search_nearby` resolved the place but found no points around it. */
export interface NearbyEmpty {
  outcome: "empty";
}

/** Several places answer to the name the user gave. */
export interface NearbyPlaceAmbiguous {
  outcome: "place_ambiguity";
  clarification_reason: "place_ambiguity";
  place_candidate_ids: string[];
}

/** The place is unknown, or too broad to search around. */
export interface NearbyPlaceUnresolved {
  outcome: "place_unresolved";
  clarification_reason: "place_too_broad" | "unknown_place";
}

/** No place was named and the user shared no coordinates. */
export interface NearbyMissingLocation {
  outcome: "missing_location";
  clarification_reason: "missing_location";
}

/** Every outcome `search_nearby` can produce. */
export type NearbyOutcome =
  | NearbyOk
  | NearbyEmpty
  | NearbyPlaceAmbiguous
  | NearbyPlaceUnresolved
  | NearbyMissingLocation
  | UpstreamDown;

/** `plan_route` stored a route over the named result. */
export interface ItineraryOk {
  status: "ok";
  itinerary_ref: string;
  /**
   * The stops in visit order, by point id — the ORDINAL ANCHOR (#1389).
   *
   * "The second stop" is an ordinal, and an ordinal lands on an ordered list of
   * identities or on nothing. This outcome used to answer a ref and two
   * numbers, and a count is not an identity: a later turn reading it back knew
   * how many stops the route had and not one of them. It is the same loss
   * `ResolveAmbiguous.candidate_ids` already refuses to take, kept on the same
   * terms — verbatim, in order, and copied through the frozen summary by
   * `session/tool-return-summary.ts` rather than paraphrased.
   */
  ordered_point_ids: string[];
  point_count: number;
  total_minutes: number;
}

/** The named result holds nothing worth routing. */
export interface ItineraryEmpty {
  status: "empty";
}

/** The model named a ref this session never minted. */
export interface ItineraryStaleRef {
  status: "stale_ref";
}

/** The named result is an L1 preview; routing it would route a fragment. */
export interface ItineraryPendingSync {
  status: "pending_sync";
}

/** The catalog could not answer the route request. */
export interface ItineraryUpstreamDown {
  status: "upstream_unavailable";
}

/** Every outcome `plan_route` can produce. */
export type ItineraryOutcome =
  | ItineraryOk
  | ItineraryEmpty
  | ItineraryStaleRef
  | ItineraryPendingSync
  | ItineraryUpstreamDown;

/** The single `upstream_unavailable` value every catalog tool degrades into. */
export const UPSTREAM_DOWN: UpstreamDown = { outcome: "upstream_unavailable" };

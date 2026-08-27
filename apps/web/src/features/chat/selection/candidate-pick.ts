import type { ChatTurnRequest } from "@animichi/contract";

/**
 * A structured clarify-candidate pick (W1 #1220): the selection travels as
 * the candidate's identifier plus the pending clarification's revision, so
 * the backend resolves it through the deterministic selection channel — no
 * model round-trip, and no way for a display title to be mistaken for free
 * text. The label exists only for the user bubble; the id is what selects.
 */
export interface CandidatePick {
  readonly candidateId: string;
  /** Display title for the user bubble (already bilingual-composed). */
  readonly label: string;
  /** The pending clarification's revision (`data.clarification_id`). */
  readonly clarificationId: number | undefined;
}

/**
 * The `/v1/chat` body delta of a pick: the two selection fields of the
 * contract's `ChatTurnRequest`, picked directly from its wire type (not
 * hand-mirrored) so this shape cannot silently drift from `/v1/chat`.
 */
export type CandidatePickBody = Required<Pick<ChatTurnRequest, "selected_candidate_ids" | "clarification_id">>;

export function candidatePickBody(pick: CandidatePick): CandidatePickBody {
  return {
    selected_candidate_ids: [pick.candidateId],
    clarification_id: pick.clarificationId ?? null,
  };
}

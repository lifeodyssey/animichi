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

/** The `/v1/chat` body delta of a pick (contract `ChatTurnRequest`). */
export interface CandidatePickBody {
  readonly selected_candidate_ids: readonly string[];
  readonly clarification_id: number | null;
}

export function candidatePickBody(pick: CandidatePick): CandidatePickBody {
  return {
    selected_candidate_ids: [pick.candidateId],
    clarification_id: pick.clarificationId ?? null,
  };
}

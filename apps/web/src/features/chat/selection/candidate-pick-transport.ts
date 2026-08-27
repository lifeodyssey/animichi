import type { UseChatHelpers } from "@ai-sdk/react";
import { useCallback } from "react";
import type { ChatUIMessage } from "../use-chat-session";
import { candidatePickBody } from "./candidate-pick";
import type { CandidatePick } from "./candidate-pick";

/**
 * The `useChat` helpers a candidate pick send/resend needs (W1 #1220): the
 * user bubble renders the pick's display title while the request itself
 * rides `selected_candidate_ids` + `clarification_id` into the deterministic
 * selection channel — no model round-trip.
 */
export type PickHelpers = Pick<UseChatHelpers<ChatUIMessage>, "sendMessage" | "regenerate" | "clearError">;

export function useSendCandidatePick({ sendMessage }: PickHelpers) {
  return useCallback(
    (pick: CandidatePick) => {
      void sendMessage({ text: pick.label }, { body: { ...candidatePickBody(pick) } });
    },
    [sendMessage],
  );
}

/** Retry of a failed pick: re-submit the SAME pick bubble (same message,
 * hence the same derived `x-turn-id`) with the same selection body. */
export function useResendCandidatePick({ regenerate, clearError }: PickHelpers) {
  return useCallback(
    (pick: CandidatePick) => {
      clearError();
      void regenerate({ body: { ...candidatePickBody(pick) } });
    },
    [regenerate, clearError],
  );
}

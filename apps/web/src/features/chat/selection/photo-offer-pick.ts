import type { ChatActions } from "../ChatActions";
import { confirmPhotoSearch } from "../photo-search";
import type { PhotoSearchContext } from "../photo-search";
import type { CandidatePick } from "./candidate-pick";
import type { ClarifyPickTurn } from "./use-clarify-pick";

/**
 * The sessionless candidate offer one photo search produced (AGENT-1 #952):
 * the server-issued `offer_id` plus the request identity its confirmation
 * reuses. An offer is never a Session — it answers no pending clarification.
 */
export interface PhotoOffer {
  readonly baseUrl: string;
  readonly offerId: string;
  readonly context: PhotoSearchContext;
}

/** Taking a photo offer's candidate confirms the offer (AC11) and then asks
 * the conversation about the title the visitor chose. */
function confirmThenAsk(offer: PhotoOffer, send: ChatActions["send"]) {
  return (pick: CandidatePick) => {
    confirmPhotoSearch(offer.baseUrl, offer.offerId, pick.candidateId, offer.context);
    send(pick.label);
  };
}

/**
 * The photo offer's own candidate-pick channel.
 *
 * A photo result renders through the same clarify card as a session
 * clarification, and that card routes every id-carrying candidate through
 * whichever pick channel is in scope (W1 #1220). Inside a photo offer the
 * session channel is the wrong one: the offer is sessionless, so its pick
 * would leave as `selected_candidate_ids` with a null `clarification_id`
 * against a session that never asked, which the agent refuses as
 * `invalid_selection` (400, `error_registry.py`) and returns as a fresh
 * "that choice expired" clarify card — with the offer still unconfirmed.
 * This channel takes the pick instead.
 *
 * It holds no failure state of its own: the continuation is an ordinary turn
 * whose failures the D-strips already own, and the confirmation is the
 * `user_confirmed` signal (SD-26), never a reason to re-arm the card.
 * `sendable` stays the page's, so the quota lock and the in-flight gate keep
 * covering picks made here.
 */
export function photoOfferPick(offer: PhotoOffer, send: ChatActions["send"], sendable: boolean): ClarifyPickTurn {
  return {
    enabled: true,
    sendable,
    status: "idle",
    lastPick: undefined,
    pick: confirmThenAsk(offer, send),
    resend: () => undefined,
  };
}

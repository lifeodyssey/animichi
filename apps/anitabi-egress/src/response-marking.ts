/**
 * The marks that say whose answer a response is, and this service's own
 * refusal, which carries them.
 *
 * Our own refusals are unmistakable: header `x-egress-response: refused-here`
 * plus a `x-egress-refusal` reason. Upstream answers carry
 * `x-egress-response: relayed-upstream` and never a refusal reason. A caller
 * can tell the three failure worlds apart — upstream refused us, upstream
 * failed, this service refused — without parsing prose (#1792).
 */

/** Which answer produced this response: the upstream's, or this service's refusal. */
export const RESPONSE_MARKER_HEADER = "x-egress-response";
export const RELAYED_MARKER = "relayed-upstream";
export const REFUSED_MARKER = "refused-here";
export const REFUSAL_HEADER = "x-egress-refusal";

export type RefusalReason =
  | "no-such-operation"
  | "method-not-allowed"
  | "auth"
  | "ceiling"
  | "configuration"
  | "upstream-timeout";

/** What a caller reads off our refusal without parsing prose: whose it is, why, and the detail when there is one. */
interface RefusalBody {
  readonly refusedBy: "anitabi-egress";
  readonly reason: RefusalReason;
  readonly detail?: string;
}

/** This service's own refusal: marked, reasoned, and never confusable with an upstream answer. */
export function refusal(reason: RefusalReason, status: number, detail?: string): Response {
  const body: RefusalBody = detail === undefined
    ? { refusedBy: "anitabi-egress", reason }
    : { refusedBy: "anitabi-egress", reason, detail };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      [RESPONSE_MARKER_HEADER]: REFUSED_MARKER,
      [REFUSAL_HEADER]: reason,
    },
  });
}

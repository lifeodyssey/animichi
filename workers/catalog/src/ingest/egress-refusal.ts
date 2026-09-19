/**
 * A refusal by OUR OWN anitabi egress service (#1792) — the failure world
 * that must never masquerade as an upstream answer. An upstream 403 means
 * "talk to them"; an egress refusal means "the ceiling clears within the
 * hour, or fix our key/configuration — do not contact the upstream". The
 * caller tells them apart by the service's response marker, and this type is
 * what the marker becomes on the catalog side.
 */

/** Why the egress refused, as its `x-egress-refusal` header names it. */
export type EgressRefusalReason =
  | "auth"
  | "ceiling"
  | "no-such-operation"
  | "method-not-allowed"
  | "configuration"
  | "upstream-timeout"
  /** No marker at all: the answer did not come from the egress service. */
  | "unmarked";

export class EgressRefusedError extends Error {
  constructor(
    readonly reason: EgressRefusalReason,
    readonly url: string,
  ) {
    super(`the anitabi egress refused this request (${reason}): ${url}`);
    this.name = "EgressRefusedError";
  }
}

/** The row facts the ownership decision needs, or `undefined` when the row is absent. */
export interface OwnerLookup {
  readonly userId: string | null;
  readonly savedAt: string | null;
}

/** Outcome of the pure ownership decision. */
export type OwnershipDecision =
  | { readonly kind: "ok"; readonly owner: OwnerLookup }
  | { readonly kind: "not_found" }
  | { readonly kind: "not_owned" };

/** Decide ownership without throwing: an absent row is not-found, a mismatched
 * or unclaimed owner is not-owned, and a match carries the lookup so the caller
 * can act on the row's facts (e.g. its saved_at) without re-reading. */
export function decideOwnership(
  lookup: OwnerLookup | undefined,
  actorUserId: string,
): OwnershipDecision {
  if (lookup === undefined) return { kind: "not_found" };
  return lookup.userId === actorUserId
    ? { kind: "ok", owner: lookup }
    : { kind: "not_owned" };
}

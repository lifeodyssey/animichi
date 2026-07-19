/** Page-level entry states from spec-chat-page-states.md §A (A4 is out of scope). */
export type ChatEntryState = "A1" | "A2" | "A2b" | "A3" | "A5";

export interface RouteReferenceResolved {
  readonly title: string;
}

/** "missing" = the referenced route no longer exists; degrade to A1 (spec A2b). */
export type RouteReference = RouteReferenceResolved | "missing";

export interface EntrySignals {
  readonly healthy: boolean;
  readonly query?: string;
  readonly sessionId?: string;
  readonly routeReference?: RouteReference;
}

export function deriveEntryState(signals: EntrySignals): ChatEntryState {
  if (!signals.healthy) return "A5";
  if (signals.sessionId) return "A3";
  if (typeof signals.routeReference === "object") return "A2b";
  if (signals.query) return "A2";
  return "A1";
}

/**
 * Resolve a `?route=` reference. There is no public route-lookup endpoint yet
 * (arrives with the #275 consumer cards), so every reference resolves to
 * "missing" and the page degrades to the A1 cold start per the A2b AC.
 */
export function resolveRouteReference(routeId: string | undefined): RouteReference | undefined {
  if (!routeId) return undefined;
  return "missing";
}

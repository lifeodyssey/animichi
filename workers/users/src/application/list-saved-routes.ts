import type { ListSavedRoutesResult, SavedRoute } from "@animichi/contract";

/** The one outbound read capability ListSavedRoutes needs from the Neon store. */
export interface SavedRouteReader {
  /** The caller's own saved routes, row-normalized, in store order. */
  listOwned: (userId: string) => Promise<SavedRoute[]>;
}

/** Newest update first — the read journey's single ordering rule. */
function newestFirst(a: SavedRoute, b: SavedRoute): number {
  return b.updated_at.localeCompare(a.updated_at);
}

/** Redacted load observation: outcome, count, duration — never identifiers. */
export interface ListSavedRoutesObservation {
  outcome: "loaded" | "empty";
  count: number;
  duration_ms: number;
}

export interface ListSavedRoutesObserverPort {
  record(observation: ListSavedRoutesObservation): void;
}

/** Injectable clock so duration is deterministic in tests. */
export interface ListSavedRoutesClock {
  now(): number;
}

export interface ListSavedRoutesOptions {
  observer?: ListSavedRoutesObserverPort;
  clock?: ListSavedRoutesClock;
}

/** List the caller's owned saved routes, newest update first. The action owns
 * the ordering policy; the reader owns only the store read and row mapping. */
export async function listSavedRoutes(
  reader: SavedRouteReader,
  userId: string,
  opts: ListSavedRoutesOptions = {},
): Promise<ListSavedRoutesResult> {
  const clock = opts.clock ?? realClock;
  const started = clock.now();
  const owned = await reader.listOwned(userId);
  const ordered = [...owned].sort(newestFirst);
  recordIfObserved(opts, ordered.length, started, clock.now());
  return { saved_routes: ordered };
}

/** Record the redacted observation; duration is the injected clock's span. */
function recordIfObserved(opts: ListSavedRoutesOptions, count: number, started: number, finished: number): void {
  opts.observer?.record({
    outcome: count === 0 ? "empty" : "loaded",
    count,
    duration_ms: Math.max(0, finished - started),
  });
}

const realClock: ListSavedRoutesClock = { now: () => Date.now() };

import type { ListSavedRoutesResult, SavedRoute } from "@animichi/contract";

/** The one outbound read capability ListSavedRoutes needs from the Neon store. */
export interface SavedRouteReader {
  /** Every saved route the caller owns, row-normalized, newest update first;
   * equal update times fall back to the newest id. The store sorts, so the
   * order is the database's and the same on every read; there is no page size. */
  listOwned: (userId: string) => Promise<SavedRoute[]>;
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

/** List the caller's owned saved routes in the order the reader promises
 * (newest update first). The action adds the observation, not an ordering. */
export async function listSavedRoutes(
  reader: SavedRouteReader,
  userId: string,
  opts: ListSavedRoutesOptions = {},
): Promise<ListSavedRoutesResult> {
  return { saved_routes: await readOwnedObserved(reader, userId, opts) };
}

/** The timed read body: read through the port, then observe. */
async function readOwnedObserved(
  reader: SavedRouteReader,
  userId: string,
  opts: ListSavedRoutesOptions,
): Promise<SavedRoute[]> {
  const clock = opts.clock ?? realClock;
  const started = clock.now();
  const owned = await reader.listOwned(userId);
  recordIfObserved(opts, owned.length, started, clock.now());
  return owned;
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

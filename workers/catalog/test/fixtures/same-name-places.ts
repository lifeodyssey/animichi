import type { GeocodeHit } from "../../src/domain/geocode/collapse";

/**
 * Six gazetteer places that all answer to one alias, 府中, for the two tests of the geocode route:
 * `geocode-route.worker.test.ts` answers the exact tier with them, and
 * `geocode-route.integration.test.ts` seeds them.
 *
 * An entry is a place with the priority of its alias row, which is the exact tier's row as its plan
 * projects it (`src/adapters/outbound/neon/gazetteer.ts`). The closest two are 93 km apart, far
 * beyond the 12 km collapse radius (`src/domain/geocode/collapse.ts`), so every place stays its own
 * candidate and an answer shorter than six can only come from the limit. The priorities are distinct
 * and listed out of order, so the order of an answer is the route's ranking, not the list's.
 */
export const SHARED_NAME = "府中";

export type SameNamePlace = Omit<GeocodeHit, "exact">;

export const SAME_NAME_PLACES: readonly SameNamePlace[] = [
  { id: "seed:fuchu-shizuoka", name: "府中", kind: "city", latitude: 34.9756, longitude: 138.3828, source: "seed", pref: "静岡県", priority: 20 },
  { id: "seed:fuchu-tokyo", name: "府中", kind: "city", latitude: 35.6689, longitude: 139.4776, source: "seed", pref: "東京都", priority: 60 },
  { id: "seed:fuchu-tokushima", name: "府中", kind: "city", latitude: 34.07, longitude: 134.48, source: "seed", pref: "徳島県", priority: 10 },
  { id: "seed:fuchu-hiroshima", name: "府中", kind: "city", latitude: 34.5683, longitude: 133.2366, source: "seed", pref: "広島県", priority: 50 },
  { id: "seed:fuchu-ibaraki", name: "府中", kind: "city", latitude: 36.19, longitude: 140.29, source: "seed", pref: "茨城県", priority: 30 },
  { id: "seed:fuchu-kyoto", name: "府中", kind: "city", latitude: 35.583, longitude: 135.195, source: "seed", pref: "京都府", priority: 40 },
];

/** The six ids best-ranked first: priority 60 down to 10. */
export const BEST_RANKED_IDS = [
  "seed:fuchu-tokyo",
  "seed:fuchu-hiroshima",
  "seed:fuchu-kyoto",
  "seed:fuchu-ibaraki",
  "seed:fuchu-shizuoka",
  "seed:fuchu-tokushima",
] as const;

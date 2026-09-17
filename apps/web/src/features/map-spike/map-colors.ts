/**
 * The map spike's ground colours, as literals.
 *
 * MapLibre's style spec takes no CSS variables, so these are strings in a
 * module of their own: `map-style.ts` paints with them, and the map-spike E2E
 * fixture (`e2e/fixtures/map-spike.ts`) compares canvas pixels against them.
 * They used to be copied into the fixture by hand, and the copy silently went
 * stale when #1642 retuned the flavour (#237, #1702) — a module with no imports
 * of its own is a seam the browser-side style and the Node-side test can share.
 */
export const MAP_SPIKE_BACKGROUND = "#f2eee2";
export const MAP_SPIKE_EARTH = "#ece7d6";

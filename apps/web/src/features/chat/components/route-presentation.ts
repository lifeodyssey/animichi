import type { ChatDataPart } from "@animichi/contract";
import { itineraryView } from "../lib/itinerary";
import type { ItineraryView } from "../lib/itinerary";
import { resultsOf, routeOf } from "./Cards";
import type { SpotRow } from "./Cards";

/** Route order belongs to the plan; search results only enrich its stops. */
function orderedRows(part: ChatDataPart): readonly SpotRow[] {
  const results = resultsOf(part)?.rows ?? [];
  const points = routeOf(part)?.ordered_points;
  if (!points?.length) return results;
  return points.flatMap((point) => {
    const row = typeof point === "string" ? results.find((result) => result.id === point) : point;
    return row ? [row] : [];
  });
}

function untimedView(rows: readonly SpotRow[]): ItineraryView {
  return {
    stations: rows.map((row, index) => ({ id: row.id ?? `stop-${String(index)}`, name: row.name ?? "", highlighted: false })),
    legs: [],
  };
}

/** Prefer a populated result still, then the route's own still, by stable id. */
function sceneRow(station: ItineraryView["stations"][number], rows: readonly SpotRow[]): SpotRow {
  const matching = rows.filter((row) => row.id === station.id);
  const row = matching.find((candidate) => Boolean(candidate.screenshot_url)) ?? matching[0];
  return { ...row, id: station.id, name: station.name };
}

export function routePresentation(part: ChatDataPart) {
  const rows = orderedRows(part).map((row, index) => ({ ...row, id: row.id ?? `stop-${String(index)}` }));
  const timed = routeOf(part)?.timed_itinerary;
  const view = timed?.stops.length ? itineraryView(timed) : untimedView(rows);
  const sources = [...(resultsOf(part)?.rows ?? []), ...rows];
  return { view, scenes: view.stations.map((station) => sceneRow(station, sources)) };
}

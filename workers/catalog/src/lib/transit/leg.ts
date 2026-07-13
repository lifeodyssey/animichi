import type { TransitLeg } from "../../types";
import { haversine } from "../geo";
import { isTransitCandidate } from "./constants";
import { estimateTransitLeg } from "./estimate";
import { formatTransitSummary } from "./format";
import type { TransitIndex } from "./graph";

export interface TransitLegPoint { lat: number; lng: number; id: string }

function attributionsOf(index: TransitIndex): string[] {
  return index.sources.filter((source) => source.attribution_required).map((source) => source.attribution_text ?? source.name);
}

function toLeg(from: TransitLegPoint, to: TransitLegPoint, estimate: NonNullable<ReturnType<typeof estimateTransitLeg>>, attribution: string[]): TransitLeg {
  const leg = { from_id: from.id, to_id: to.id, mode: "transit" as const, duration_minutes: estimate.total_minutes, distance_m: estimate.distance_m, line_names: estimate.line_names, transfers: estimate.transfers, board_station: estimate.board_station_name, alight_station: estimate.alight_station_name, summary: formatTransitSummary(estimate) };
  return attribution.length ? { ...leg, attribution } : leg;
}

export function maybeTransitLeg(from: TransitLegPoint, to: TransitLegPoint, index: TransitIndex): TransitLeg | null {
  const distance = haversine(from.lat, from.lng, to.lat, to.lng);
  if (!isTransitCandidate(distance)) return null;
  const estimate = estimateTransitLeg(from, to, index);
  return estimate ? toLeg(from, to, estimate, attributionsOf(index)) : null;
}

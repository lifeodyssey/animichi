import { haversine } from "../../geo";
import { NEAREST_STATION_MAX_M } from "../constants";
import type { TopologyStation } from "../model";

export interface CoverageSpot { lat: number; lng: number }
export interface StationCoverage { covered: number; total: number; rate: number }

function isCovered(spot: CoverageSpot, stations: readonly TopologyStation[]): boolean {
  return stations.some((station) => haversine(spot.lat, spot.lng, station.lat, station.lng) <= NEAREST_STATION_MAX_M);
}

export function stationCoverage(spots: readonly CoverageSpot[], stations: readonly TopologyStation[]): StationCoverage {
  const covered = spots.filter((spot) => isCovered(spot, stations)).length;
  return { covered, total: spots.length, rate: spots.length ? covered / spots.length : 1 };
}

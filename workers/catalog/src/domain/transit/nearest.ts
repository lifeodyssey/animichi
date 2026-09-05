import { haversine } from "../geo";
import { NEAREST_STATION_MAX_M } from "./constants";
import type { TopologyStation } from "./model";

export interface NearestStation { station: TopologyStation; distance_m: number }

function nearer(current: NearestStation | null, candidate: NearestStation): NearestStation {
  if (!current || candidate.distance_m < current.distance_m) return candidate;
  if (candidate.distance_m === current.distance_m && candidate.station.station_id < current.station.station_id) return candidate;
  return current;
}

export function nearestStation(lat: number, lng: number, stations: Iterable<TopologyStation>): NearestStation | null {
  let nearest: NearestStation | null = null;
  for (const station of stations) nearest = nearer(nearest, { station, distance_m: haversine(lat, lng, station.lat, station.lng) });
  return nearest && nearest.distance_m <= NEAREST_STATION_MAX_M ? nearest : null;
}
